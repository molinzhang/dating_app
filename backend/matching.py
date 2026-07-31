"""Weekly match generation.

Each person answers 24 spectrum questions (1-7). A person may mark 3-5
question topics as personally most important; those get extra weight when
we compute how good a candidate is *for them* specifically (my priorities
aren't your priorities, so this is directional, not symmetric).

Pairing uses the classic Gale-Shapley stable-marriage algorithm: everyone
proposes to their most-preferred remaining candidate, receivers hold the
best proposal they've seen and reject the rest, rejected proposers move
down their own list. This guarantees the result is stable — no two
unpaired people would both rather have each other than who they ended up
with — and, as a side effect, that no one is assigned to more than one
partner.

Gale-Shapley's stability proof requires a two-sided market (classically
"men propose, women receive"). Every user has a `gender` ("男"/"女"),
assumed heterosexual by default, so `_split_into_groups` splits the
eligible pool along that real line: 男 propose, 女 receive.
"""
from datetime import datetime, timedelta, timezone

from questionnaire_config import VALUE_DIMENSIONS, ALL_QUESTION_IDS, SPECTRUM_MIN, SPECTRUM_MAX

IMPORTANT_QUESTION_WEIGHT = 3.0
WEEK_IN_DAYS = 7

CLOSE_THRESHOLD = 1.0
DISCUSS_THRESHOLD = 2.5


def _closeness(a_val, b_val):
    """1.0 = identical answer, 0.0 = maximally opposite (1 vs 7)."""
    span = SPECTRUM_MAX - SPECTRUM_MIN
    return 1 - abs(a_val - b_val) / span


def _directional_score(viewer_answers, viewer_important_ids, other_answers):
    """How good `other` looks to `viewer`, weighting viewer's self-declared
    important questions higher."""
    total_weight = 0.0
    weighted_sum = 0.0
    for qid in ALL_QUESTION_IDS:
        if qid not in viewer_answers or qid not in other_answers:
            continue
        weight = IMPORTANT_QUESTION_WEIGHT if qid in viewer_important_ids else 1.0
        weighted_sum += weight * _closeness(viewer_answers[qid], other_answers[qid])
        total_weight += weight
    if total_weight == 0:
        return 0.0
    return weighted_sum / total_weight


def pair_score(user_a, user_b):
    """Symmetric compatibility score for the pair — not used by the
    matching algorithm itself (Gale-Shapley only needs each side's own
    directional preference order), but used afterwards to compute a single
    display score for a locked-in pair."""
    score_a_view = _directional_score(user_a["answers"], user_a["important_question_ids"], user_b["answers"])
    score_b_view = _directional_score(user_b["answers"], user_b["important_question_ids"], user_a["answers"])
    return (score_a_view + score_b_view) / 2


def _split_into_groups(eligible_users):
    proposers = [u for u in eligible_users if u["gender"] == "男"]
    receivers = [u for u in eligible_users if u["gender"] == "女"]
    return proposers, receivers


def build_exclusions(dislike_pairs):
    """Turn directional (blocker, blocked) rows into a symmetric adjacency map.

    A dislike is stored one-way but enforced BOTH ways: if A blocked B, B also
    stops being shown A. Otherwise B keeps getting recommended someone who will
    never respond.
    """
    exclusions = {}
    for blocker_id, blocked_id in dislike_pairs:
        exclusions.setdefault(blocker_id, set()).add(blocked_id)
        exclusions.setdefault(blocked_id, set()).add(blocker_id)
    return exclusions


NEUTRAL_ANSWER = 4


def _side(value):
    """Which end of the spectrum an answer sits on. Direction only, not degree."""
    if value is None:
        return None
    if value < NEUTRAL_ANSWER:
        return "left"
    if value > NEUTRAL_ANSWER:
        return "right"
    return "neutral"


def accepts(viewer_answers, viewer_preferences, other_answers):
    """Whether every explicit per-question preference of the viewer's is
    satisfied by the other person.

    A preference is a hard filter, not a weight: "same" requires the other
    person to sit on the viewer's side of that question, "different" the
    opposite side. A neutral (4) answer is on neither side, so it satisfies
    neither — but a viewer who is themselves neutral imposes no constraint,
    since "same side as neutral" has no meaning.
    """
    for qid, preference in (viewer_preferences or {}).items():
        if preference not in ("same", "different"):
            continue
        viewer_side = _side(viewer_answers.get(qid))
        if viewer_side in (None, "neutral"):
            continue
        other_side = _side(other_answers.get(qid))
        if other_side in (None, "neutral"):
            return False
        if preference == "same" and other_side != viewer_side:
            return False
        if preference == "different" and other_side == viewer_side:
            return False
    return True


def mutually_acceptable(user_a, user_b):
    """Both sides' hard filters must pass — a pair survives only if each
    accepts the other."""
    return (
        accepts(user_a["answers"], user_a.get("match_preferences"), user_b["answers"])
        and accepts(user_b["answers"], user_b.get("match_preferences"), user_a["answers"])
    )


def _preference_order(viewer, candidates, exclusions):
    """Rank candidates for viewer, most-preferred first, dropping anyone either
    side has permanently excluded or whose per-question hard filters fail.

    Dropping candidates makes these "incomplete preference lists". Gale-Shapley
    still terminates (the proposal budget only shrinks) and the result is still
    stable under the standard adjusted definition: a blocking pair requires both
    people to find each other *acceptable*, and excluded pairs are by definition
    unacceptable, so they can never block. The per-question filter is applied
    symmetrically via mutually_acceptable, so both sides' lists agree on who is
    acceptable — a one-sided filter would break that guarantee.
    """
    blocked = exclusions.get(viewer["id"], frozenset())
    scored = [
        (_directional_score(viewer["answers"], viewer["important_question_ids"], c["answers"]), c["id"])
        for c in candidates
        if c["id"] not in blocked and mutually_acceptable(viewer, c)
    ]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [uid for _, uid in scored]


def gale_shapley_matching(eligible_users, exclusions=None):
    """eligible_users: list of dicts with 'id', 'answers', 'important_question_ids'.
    exclusions: optional {user_id: set(user_id)} of mutually-excluded pairs,
    as built by build_exclusions().

    Returns list of (proposer_id, receiver_id, score) for everyone who ended
    up matched. Runs the classic propose-reject loop between the two groups
    produced by _split_into_groups; leaves people unmatched if the two
    groups end up different sizes, if either group is empty, or if everyone
    they could have matched with is excluded."""
    exclusions = exclusions or {}
    proposers, receivers = _split_into_groups(eligible_users)
    if not proposers or not receivers:
        return []

    by_id = {u["id"]: u for u in eligible_users}
    proposer_prefs = {p["id"]: _preference_order(p, receivers, exclusions) for p in proposers}
    receiver_rank = {
        r["id"]: {pid: rank for rank, pid in enumerate(_preference_order(r, proposers, exclusions))}
        for r in receivers
    }

    free_proposers = [p["id"] for p in proposers]
    next_index = {pid: 0 for pid in free_proposers}
    engaged = {}  # receiver_id -> proposer_id

    while free_proposers:
        pid = free_proposers.pop()
        prefs = proposer_prefs[pid]
        idx = next_index[pid]
        if idx >= len(prefs):
            continue  # exhausted their list — stays unmatched
        rid = prefs[idx]
        next_index[pid] = idx + 1

        current = engaged.get(rid)
        if current is None:
            engaged[rid] = pid
        elif receiver_rank[rid][pid] < receiver_rank[rid][current]:
            engaged[rid] = pid
            free_proposers.append(current)
        else:
            free_proposers.append(pid)

    return [(pid, rid, pair_score(by_id[pid], by_id[rid])) for rid, pid in engaged.items()]


def dimension_comparisons(user_a_answers, user_b_answers):
    """Per-dimension breakdown for the match detail UI, mirroring the
    frontend's VALUE_DIMENSIONS grouping exactly."""
    comparisons = []
    for dim in VALUE_DIMENSIONS:
        a_vals = [user_a_answers[qid] for qid in dim["questionIds"] if qid in user_a_answers]
        b_vals = [user_b_answers[qid] for qid in dim["questionIds"] if qid in user_b_answers]
        if not a_vals or not b_vals:
            continue
        a_score = sum(a_vals) / len(a_vals)
        b_score = sum(b_vals) / len(b_vals)
        diff = abs(a_score - b_score)
        if diff <= CLOSE_THRESHOLD:
            category = "close"
        elif diff >= DISCUSS_THRESHOLD:
            category = "discuss"
        else:
            category = "complementary"
        comparisons.append({
            "dimension": dim["name"],
            "userScore": round(a_score, 2),
            "matchScore": round(b_score, 2),
            "category": category,
        })
    return comparisons


def compatibility_summary(comparisons):
    close_count = sum(1 for c in comparisons if c["category"] == "close")
    if close_count == 0:
        return "你们在核心维度上各有侧重，是很好的深聊话题"
    return f"你们在{close_count}个核心维度上高度接近"


def build_match_payload(user_a_answers, user_b_answers):
    comparisons = dimension_comparisons(user_a_answers, user_b_answers)
    return comparisons, compatibility_summary(comparisons)


def next_refresh_from(now):
    return now + timedelta(days=WEEK_IN_DAYS)
