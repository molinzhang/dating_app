import streamlit as st

from db import init_db, email_exists, create_user, fetch_all_users, fetch_user_by_id
from matching import rank_matches
from questions import QUESTIONS, SCALE_LABELS

st.set_page_config(page_title="校友交友 App", page_icon="💘")
init_db()

GENDERS = ["男生", "女生", "其他"]
INTERESTED_IN = ["男生", "女生", "都可以"]


def render_match_card(rank, score, user):
    with st.container(border=True):
        st.markdown(f"**#{rank}  {user['name']}**  ·  相似度 {score:.0%}")
        st.caption(f"{user['school']} · {user['age']}岁 · {user['gender']}")
        if user["bio"]:
            st.write(user["bio"])


def show_matches(target_user, all_users):
    matches = rank_matches(target_user, all_users)
    if not matches:
        st.info("暂时没有找到符合条件（同校 + 双向性别偏好）的匹配对象，等更多校友注册后再来看看吧。")
        return
    st.subheader(f"为 {target_user['name']} 找到的匹配排名")
    for rank, (score, user) in enumerate(matches, start=1):
        render_match_card(rank, score, user)


page = st.sidebar.radio("导航", ["注册 & 填问卷", "查看匹配", "所有注册用户"])

if page == "注册 & 填问卷":
    st.title("校友交友 App 注册")
    st.write("填写你的基本信息和一份 10 题小问卷，问卷答案会用来给你匹配相似的校友。")

    with st.form("registration_form"):
        st.subheader("基本信息")
        name = st.text_input("姓名")
        email = st.text_input("邮箱（作为唯一登录标识）")
        school = st.text_input("学校")
        age = st.number_input("年龄", min_value=18, max_value=100, value=22, step=1)
        gender = st.selectbox("性别", GENDERS)
        interested_in = st.selectbox("我想认识的对象", INTERESTED_IN)
        bio = st.text_area("一句话自我介绍（选填）")

        st.subheader("匹配问卷（10 题，1=非常不同意，5=非常同意）")
        answers = []
        for i, question in enumerate(QUESTIONS, start=1):
            answer = st.radio(
                f"{i}. {question}",
                options=[1, 2, 3, 4, 5],
                format_func=lambda v: SCALE_LABELS[v],
                horizontal=True,
                index=2,
                key=f"q{i}",
            )
            answers.append(answer)

        submitted = st.form_submit_button("注册并查看我的匹配")

    if submitted:
        if not name or not email or not school:
            st.error("姓名、邮箱、学校为必填项。")
        elif email_exists(email):
            st.error("这个邮箱已经注册过了，请换一个邮箱或去「查看匹配」页面查询。")
        else:
            profile = {
                "name": name,
                "email": email,
                "school": school,
                "age": int(age),
                "gender": gender,
                "interested_in": interested_in,
                "bio": bio,
            }
            new_user_id = create_user(profile, answers)
            st.success(f"注册成功！欢迎你，{name} 👋")

            new_user = fetch_user_by_id(new_user_id)
            all_users = fetch_all_users()
            show_matches(new_user, all_users)

elif page == "查看匹配":
    st.title("查看某位用户的匹配结果")
    all_users = fetch_all_users()
    if not all_users:
        st.info("数据库里还没有用户，先去注册页面添加几个吧。")
    else:
        options = {f"{u['name']} ({u['email']})": u["id"] for u in all_users}
        choice = st.selectbox("选择一位用户", list(options.keys()))
        target_user = fetch_user_by_id(options[choice])
        show_matches(target_user, all_users)

else:
    st.title("所有注册用户")
    all_users = fetch_all_users()
    if not all_users:
        st.info("数据库里还没有用户。")
    else:
        table_rows = [
            {
                "姓名": u["name"],
                "邮箱": u["email"],
                "学校": u["school"],
                "年龄": u["age"],
                "性别": u["gender"],
                "感兴趣对象": u["interested_in"],
            }
            for u in all_users
        ]
        st.dataframe(table_rows, use_container_width=True)
