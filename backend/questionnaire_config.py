"""Static config mirrored from the frontend (Website Creation (1)/src/app/App.tsx):
QUESTIONS, SECTIONS, VALUE_DIMENSIONS. Kept as a duplicate, hand-synced copy
rather than a shared package — small and static enough that duplicating it
is simpler than wiring up a shared module for a hackathon prototype.
"""

NUM_QUESTIONS = 24
SPECTRUM_MIN = 1
SPECTRUM_MAX = 7

SECTIONS = [
    {"id": 1, "name": "生活方式", "questionIds": [1, 2, 3, 4, 5, 6]},
    {"id": 2, "name": "人生方向", "questionIds": [7, 8, 9, 10, 11, 12]},
    {"id": 3, "name": "社会与世界", "questionIds": [13, 14, 15, 16, 17, 18]},
    {"id": 4, "name": "情感与沟通", "questionIds": [19, 20, 21, 22]},
    {"id": 5, "name": "亲密关系", "questionIds": [23, 24]},
]

VALUE_DIMENSIONS = [
    {"name": "探索开放 ↔ 稳定守序", "questionIds": [1, 2, 3], "color": "#E85D26"},
    {"name": "独立空间 ↔ 社交联结", "questionIds": [4, 5, 6], "color": "#2B5CE6"},
    {"name": "成就驱动 ↔ 生活从容", "questionIds": [7, 8], "color": "#7C3AED"},
    {"name": "储蓄保障 ↔ 当下体验", "questionIds": [9, 10], "color": "#059669"},
    {"name": "竞争贡献 ↔ 平等合作", "questionIds": [11, 12], "color": "#DC2626"},
    {"name": "原则传统 ↔ 情境更新", "questionIds": [14, 15], "color": "#D97706"},
    {"name": "直接表达 ↔ 关系照顾", "questionIds": [20, 21, 22], "color": "#EC4899"},
]

ALL_QUESTION_IDS = list(range(1, NUM_QUESTIONS + 1))
