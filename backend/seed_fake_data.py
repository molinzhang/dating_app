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

# Free-text profiles for the demo pool: a self-introduction and a "what I'm
# looking for", assigned round-robin so every seeded account gets a different
# pair.
#
# The text matcher (text_match.py) compares one person's expectation against
# another's bio, so a pool where everyone shares the same three archetype
# sentences gives it nothing to work with — every pair scores either 1.0 or
# 0.0. These are written with deliberately overlapping-but-not-identical
# interest vocabulary: some expectations are answered well by several bios,
# some by exactly one, and some by none, which is what makes the ranking
# observable at all. Real users' text is never overwritten by the seeders.
INTEREST_PROFILES = [
    ("周末基本都在山里，爬山露营是我的续命方式，也喜欢一个人开车去看星星。",
     "希望找一个愿意跟我一起爬山露营的人，体力不用很好，愿意出门就行。"),
    ("常驻独立书店，最近在读非虚构和一些社会学的书，也会写点东西。",
     "想找一个也喜欢看书的人，能一起逛书店，聊得下去比什么都重要。"),
    ("下厨是我最放松的时候，擅长家常菜和烘焙，朋友来我家我都亲自做饭。",
     "希望对方喜欢吃也喜欢做饭，能一起研究菜谱、逛菜市场。"),
    ("重度游戏玩家，主机和单机都玩，也追番，周末可以在家待一整天。",
     "想找一个能一起打游戏看动漫的人，不介意我偶尔沉迷。"),
    ("摄影爱好者，喜欢旅行和拍街头，去过十几个国家，胶片和数码都拍。",
     "希望找一个喜欢旅行摄影的人，可以一起说走就走。"),
    ("弹吉他很多年，经常去看 live，自己也偶尔写歌。",
     "想找一个喜欢音乐的人，能一起去看演出，听什么风格都可以。"),
    ("每天跑步，跑过两次马拉松，健身房常客，作息很规律。",
     "希望对方也喜欢运动跑步健身，能互相督促。"),
    ("咖啡重度依赖，会自己手冲，喜欢在城市里瞎逛探店。",
     "想找一个喜欢咖啡和 city walk 的人，慢慢逛一下午不觉得浪费。"),
    ("影迷，一年看一百多部，偏爱纪录片和欧洲电影，会写长评。",
     "希望找一个喜欢看电影的人，看完能聊两句，不一定要品味一样。"),
    ("家里有两只猫，铲屎官本色，周末喜欢在家陪猫看剧。",
     "想找一个喜欢猫或者狗的人，至少不怕小动物。"),
    ("常去博物馆和画展，学过一点油画，对艺术史很感兴趣。",
     "希望对方喜欢逛博物馆看画展，愿意陪我在一幅画前站很久。"),
    ("写代码为生，业余做开源项目，喜欢折腾各种技术和硬件。",
     "想找一个理解我为什么会为一个 bug 兴奋一整晚的人，做什么工作都行。"),
    ("桌游剧本杀爱好者，家里一柜子桌游，很爱组局。",
     "希望找一个喜欢桌游剧本杀的人，能一起玩也能一起攒局。"),
    ("每年冬天滑雪夏天潜水，考了潜水证，喜欢一切水下的东西。",
     "想找一个喜欢滑雪或者潜水的人，愿意学也算。"),
]


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
