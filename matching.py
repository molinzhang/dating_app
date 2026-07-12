import math

from db import NUM_QUESTIONS


def survey_vector(user_row):
    return [float(user_row[f"q{i}"]) for i in range(1, NUM_QUESTIONS + 1)]


def cosine_similarity(vec_a, vec_b):
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def is_gender_compatible(user_a, user_b):
    a_likes_b = user_a["interested_in"] in (user_b["gender"], "都可以")
    b_likes_a = user_b["interested_in"] in (user_a["gender"], "都可以")
    return a_likes_b and b_likes_a


def rank_matches(target_user, all_users, same_school_only=True, top_n=5):
    """Rank every other user in the database against target_user by survey cosine similarity.

    Candidates are restricted to the same school and mutual gender preference,
    since this app is scoped to school alumni looking to match with each other.
    """
    target_vec = survey_vector(target_user)
    candidates = []
    for other in all_users:
        if other["id"] == target_user["id"]:
            continue
        if same_school_only and other["school"] != target_user["school"]:
            continue
        if not is_gender_compatible(target_user, other):
            continue
        score = cosine_similarity(target_vec, survey_vector(other))
        candidates.append((score, other))

    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return candidates[:top_n]
