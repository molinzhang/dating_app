"""Top up the demo pool so live visitors actually get matched.

Gale-Shapley pairs min(男, 女) people, so whichever side is in the majority
gets left unmatched. When strangers register during a demo we don't know which
gender they'll pick, so keep several spare users of BOTH genders sitting in the
pool with completed questionnaires.

Idempotent: re-running only creates what's missing.

Run: python3 seed_demo_pool.py [spare_per_gender]
"""
import random
import re
import sys

import auth
import db
import orientation
from questionnaire_config import ALL_QUESTION_IDS
from seed_fake_data import ARCHETYPES, IMPORTANT_IDS_BY_ARCHETYPE, INTEREST_PROFILES, jitter

random.seed(11)

SPARE_NAMES = {
    "男": ["沈亦舟", "顾南辰", "程屿", "秦砚", "谢予怀", "许知远", "陆时衍", "江砚白",
           "裴让", "宋照野", "闻朝", "霍屿川", "梁越", "周知行", "傅深", "邵珩",
           "唐斯言", "卫朗", "冯彻", "元也"],
    "女": ["苏晚意", "温言", "叶知秋", "白露", "沈清欢", "夏栀", "宋雨薇", "柳依依",
           "林知夏", "许清和", "陆昭昭", "阮眠", "祝清欢", "闻笙", "南枝", "顾未晚",
           "简溪", "岑晚", "初禾", "俞棠"],
}


# Only accounts whose email matches this exactly are treated as seeded demo
# data that the script may rewrite. Real users' free text is theirs.
DEMO_EMAIL = re.compile(r"^demo_[mf]\d+@example\.com$")


# Birth years spread across the range people actually register in, so an age
# filter has something to bite on. Cycled by slot rather than randomised so
# re-running the seeder never reshuffles anyone's age.
BIRTH_YEARS = (1986, 1989, 1991, 1993, 1994, 1996, 1997, 1999, 2000, 2002)

# Every Nth demo slot seeks its own gender, which is what populates the two
# same-gender pools. Without this they are empty and the feature cannot be
# demonstrated at all — a pool of one never pairs.
SAME_GENDER_EVERY = 3


def _birth_date_for(slot):
    return f"{BIRTH_YEARS[slot % len(BIRTH_YEARS)]}-06-15"


def _orientation_for(slot, gender):
    """(orientation, seeking) for a demo slot.

    Demo accounts deliberately get no age *preference*: a range on both sides
    compounds, and the point of the spare pool is that a real visitor can
    always find someone.
    """
    if slot % SAME_GENDER_EVERY == 0:
        return orientation.GAY, gender
    return orientation.STRAIGHT, orientation.opposite_gender(gender)


def _profile_for(slot, gender):
    """Deterministic bio/expectation for a demo slot.

    Offsetting 女 by half the list keeps the two sides from lining up
    index-for-index, which would hand every proposer a perfect text twin and
    make the pairing look better than the algorithm actually is.
    """
    offset = 0 if gender == "男" else len(INTEREST_PROFILES) // 2
    return INTEREST_PROFILES[(slot + offset) % len(INTEREST_PROFILES)]


def ensure_user(email, name, gender, archetype, slot):
    existing = db.get_user_by_email(email)
    if existing:
        return existing["id"], False
    password_hash, salt = auth.hash_password("password123")
    user_id = db.create_user(email, password_hash, salt, name, gender, {})
    bio, expectation = _profile_for(slot, gender)
    chosen, seeking = _orientation_for(slot, gender)
    db.update_user(user_id, {
        "bio": bio, "match_preference": expectation,
        "birth_date": _birth_date_for(slot),
        "orientation": chosen, "seeking_gender": seeking,
    })
    answers = dict(zip(ALL_QUESTION_IDS, jitter(ARCHETYPES[archetype])))
    draft = db.create_draft(user_id, version=1, answers=answers, current_section=5)
    db.submit_response(draft["id"], IMPORTANT_IDS_BY_ARCHETYPE[archetype])
    return user_id, True


def backfill_demo_profiles():
    """Bring already-seeded demo accounts up to date with the current fields.

    Earlier runs wrote one shared sentence per archetype, no expectation, no
    birth date and no orientation — which left the text matcher with three
    distinct documents to compare, and left both same-gender pools empty and
    every age filter matching nobody. Rewrites demo accounts only, and only
    ever these matching fields."""
    with db._cursor() as cur:
        cur.execute("""SELECT id, email, gender, bio, match_preference, birth_date,
                              orientation, seeking_gender FROM users ORDER BY id""")
        rows = [dict(r) for r in cur.fetchall()]

    updated = 0
    for row in rows:
        if not DEMO_EMAIL.match(row["email"] or ""):
            continue
        slot = int(re.search(r"\d+", row["email"]).group())
        bio, expectation = _profile_for(slot, row["gender"])
        chosen, seeking = _orientation_for(slot, row["gender"])
        wanted = {
            "bio": bio,
            "match_preference": expectation,
            "birth_date": _birth_date_for(slot),
            "orientation": chosen,
            "seeking_gender": seeking,
        }
        if all(row.get(key) == value for key, value in wanted.items()):
            continue
        db.update_user(row["id"], wanted)
        updated += 1
    return updated


def matchable_counts():
    with db._cursor() as cur:
        cur.execute(
            """SELECT u.gender, COUNT(*) AS n
               FROM users u
               JOIN questionnaire_responses q ON q.user_id = u.id AND q.status = 'current'
               WHERE u.status = 'active'
               GROUP BY u.gender"""
        )
        counts = {r["gender"]: r["n"] for r in cur.fetchall()}
    return counts.get("男", 0), counts.get("女", 0)


def main(spare_per_gender=4):
    db.init_db()
    men, women = matchable_counts()
    print(f"当前可匹配：男 {men} / 女 {women}")

    # Level both sides up to the same size, then add the spare buffer on top,
    # so a guest of either gender still finds a partner.
    target = max(men, women) + spare_per_gender
    archetypes = list(ARCHETYPES)
    created = 0

    for gender, have in (("男", men), ("女", women)):
        need = target - have
        if need <= 0:
            continue
        names = SPARE_NAMES[gender]
        prefix = "m" if gender == "男" else "f"
        made_here = 0
        # Scan for free slots rather than indexing by loop position: earlier
        # runs already claimed demo_m0.., so restarting at 0 would just find
        # existing accounts and create nothing.
        for slot in range(len(names)):
            if made_here >= need:
                break
            email = f"demo_{prefix}{slot}@example.com"
            if db.get_user_by_email(email):
                continue
            ensure_user(email, names[slot], gender, archetypes[slot % len(archetypes)], slot)
            created += 1
            made_here += 1
            print(f"  + {names[slot]} ({gender}) {email}")
        if made_here < need:
            print(f"  ⚠️  {gender} 备用名字不够，还差 {need - made_here} 个（请在 SPARE_NAMES 里加名字）")

    refreshed = backfill_demo_profiles()
    if refreshed:
        print(f"  ↻ 为 {refreshed} 个 demo 账号补写了介绍/期待/出生日期/性取向（真实用户不动）")

    men, women = matchable_counts()
    print(f"\n新增 {created} 人，现在可匹配：男 {men} / 女 {women}")
    print("所有 demo 账号密码均为 password123")
    if men == women:
        print("两侧人数持平：任一性别的访客注册后都能配到人。")
    else:
        short = "男" if men < women else "女"
        print(f"⚠️  两侧相差 {abs(men - women)} 人；注册为「{'女' if short == '男' else '男'}」的访客可能配不到。")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
