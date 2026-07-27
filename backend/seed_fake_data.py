"""One-off script to seed common_ground.db with fake users for testing.

Run: ./venv/bin/python seed_fake_data.py
"""
import random

import db
import auth
from main import maybe_regenerate_weekly_matches
from questionnaire_config import ALL_QUESTION_IDS

random.seed(7)

# Three rough "value archetypes" across the 24 spectrum questions (1=left
# statement, 7=right statement), so matching has real clusters to find.
ARCHETYPES = {
    "稳定务实型": [2,2,2,3,3,3, 3,3,2,2,4,4, 4,3,3,4,4,4, 4,3,3,3, 3,4],
    "自由探索型": [6,6,6,5,5,6, 6,5,6,6,4,4, 4,5,6,4,4,4, 5,5,5,5, 4,4],
    "顾家和睦型": [3,3,3,6,6,6, 3,6,3,3,3,3, 3,3,3,3,3,3, 4,3,3,7, 3,3],
}

NAMES = [
    "陈思远", "林晓雨", "王梓涵", "张一诺", "李昊然",
    "赵雨桐", "刘思颖", "黄子轩", "周美琪",
]

# One 男 + two 女 per archetype trio, so Gale-Shapley (男 propose, 女 receive)
# has a real candidate to pair within each cluster, and a couple of
# same-archetype women who'll have to look elsewhere.
GENDERS = ["男", "女", "女", "女", "男", "女", "女", "男", "女"]

IMPORTANT_IDS_BY_ARCHETYPE = {
    "稳定务实型": [1, 9, 14],
    "自由探索型": [1, 3, 9, 20],
    "顾家和睦型": [4, 5, 16, 20, 21],
}

BIOS = {
    "稳定务实型": "喜欢按计划生活，重视安全感和长期积累。",
    "自由探索型": "热爱新鲜事物，愿意为更大的可能性冒险。",
    "顾家和睦型": "重视身边人的感受，家庭和关系是生活的中心。",
}


def jitter(vec, amount=1):
    return [max(1, min(7, v + random.randint(-amount, amount))) for v in vec]


def build_fake_users():
    users = []
    i = 0
    for archetype, base_vec in ARCHETYPES.items():
        for _ in range(3):
            name = NAMES[i]
            answers = {qid: val for qid, val in zip(ALL_QUESTION_IDS, jitter(base_vec))}
            users.append({
                "name": name,
                "email": f"user{i}@example.com",
                "gender": GENDERS[i],
                "archetype": archetype,
                "answers": answers,
                "important_ids": IMPORTANT_IDS_BY_ARCHETYPE[archetype],
                "bio": f"[{archetype}] {BIOS[archetype]}",
            })
            i += 1
    return users


if __name__ == "__main__":
    db.init_db()
    created = []
    for u in build_fake_users():
        existing = db.get_user_by_email(u["email"])
        if existing:
            print(f"跳过 {u['name']} ({u['email']}): 已存在")
            created.append(existing["id"])
            continue
        password_hash, salt = auth.hash_password("password123")
        user_id = db.create_user(u["email"], password_hash, salt, u["name"], u["gender"], {})
        db.update_user(user_id, {"bio": u["bio"]})
        draft = db.create_draft(user_id, version=1, answers=u["answers"], current_section=5)
        db.submit_response(draft["id"], u["important_ids"])
        created.append(user_id)
        print(f"创建 {u['name']} ({u['gender']}生) ({u['email']}) - {u['archetype']}")

    maybe_regenerate_weekly_matches()

    print(f"\n已创建/复用 {len(created)} 个用户，密码均为 password123\n")
    print("=== 本周匹配结果 ===")
    for user_id in created:
        user = db.get_user_by_id(user_id)
        match = db.get_latest_match(user_id)
        if match:
            partner = db.get_user_by_id(match["matched_user_id"])
            print(f"{user['display_name']} <-> {partner['display_name']}  ({match['compatibility_summary']})")
        else:
            print(f"{user['display_name']}  -- 本轮未匹配到任何人")
