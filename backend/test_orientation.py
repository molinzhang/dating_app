"""Tests for orientation pools and age filtering.

The invariants that matter: pools are disjoint so nobody is matched twice,
same-gender seekers never appear in the opposite-gender pool, an age preference
is a hard filter in both directions, and every account that predates these
fields keeps behaving exactly as before.

Run: ./venv/bin/python test_orientation.py
"""
from datetime import date

import matching
import orientation as o
from questionnaire_config import ALL_QUESTION_IDS


def user(uid, gender, seeking=None, orientation=None, birth_date=None,
         age_min=None, age_max=None, answer=4, prefs=None):
    return {
        "id": uid,
        "gender": gender,
        "seeking_gender": seeking,
        "orientation": orientation,
        "birth_date": birth_date,
        "preferred_age_min": age_min,
        "preferred_age_max": age_max,
        "answers": {qid: answer for qid in ALL_QUESTION_IDS},
        "important_question_ids": [],
        "match_preferences": prefs or {},
        "bio": "",
        "match_preference": "",
    }


TODAY = date(2026, 8, 16)


# ------------------------------------------------------------- seeking ----

def test_seeking_defaults_to_the_opposite_gender():
    # Every account created before orientation existed has to keep working.
    assert o.seeking_of(user(1, "男")) == "女"
    assert o.seeking_of(user(2, "女")) == "男"


def test_explicit_seeking_wins():
    assert o.seeking_of(user(1, "男", seeking="男")) == "男"


def test_garbage_seeking_falls_back_to_opposite():
    assert o.seeking_of(user(1, "男", seeking="whatever")) == "女"
    assert o.seeking_of(user(2, "男", seeking=None)) == "女"


def test_orientation_defaults_to_straight():
    assert o.orientation_of(user(1, "男")) == o.STRAIGHT
    assert o.orientation_of(user(2, "男", orientation="nonsense")) == o.STRAIGHT


def test_orientation_consistency_rules():
    assert o.orientation_allows(o.STRAIGHT, "男", "女")
    assert not o.orientation_allows(o.STRAIGHT, "男", "男")
    assert o.orientation_allows(o.GAY, "男", "男")
    assert not o.orientation_allows(o.GAY, "男", "女")
    # Bisexual may seek either, but only one at a time.
    assert o.orientation_allows(o.BISEXUAL, "男", "男")
    assert o.orientation_allows(o.BISEXUAL, "男", "女")
    assert not o.orientation_allows(o.BISEXUAL, "男", "both")


# --------------------------------------------------------------- pools ----

def test_pools_are_disjoint_and_correctly_keyed():
    pools = o.split_into_pools([
        user(1, "男"), user(2, "女"),
        user(3, "男", seeking="男"), user(4, "男", seeking="男"),
        user(5, "女", seeking="女"), user(6, "女", seeking="女"),
    ])
    assert {u["id"] for u in pools[("opposite", None)]} == {1, 2}
    assert {u["id"] for u in pools[("same", "男")]} == {3, 4}
    assert {u["id"] for u in pools[("same", "女")]} == {5, 6}
    everyone = [u["id"] for members in pools.values() for u in members]
    assert len(everyone) == len(set(everyone)) == 6


def test_same_gender_seeker_is_not_offered_to_the_opposite_pool():
    # The whole point of an independent pool: a 女 seeking 女 must never be
    # recommended to a 男 seeking 女, because she does not want men.
    straight_man = user(1, "男")
    lesbian = user(2, "女", seeking="女")
    assert not o.mutually_interested(straight_man, lesbian)
    assert not matching.mutually_acceptable(straight_man, lesbian)
    assert matching.generate_matches([straight_man, lesbian]) == []


def test_bisexual_sits_in_exactly_one_pool_per_cycle():
    bi = user(1, "男", seeking="女", orientation=o.BISEXUAL)
    pools = o.split_into_pools([bi, user(2, "女")])
    assert list(pools) == [("opposite", None)]
    # Same person, other pool assignment.
    bi["seeking_gender"] = "男"
    assert list(o.split_into_pools([bi])) == [("same", "男")]


# ----------------------------------------------------------------- age ----

def test_age_from_birth_date_counts_whole_years():
    assert o.age_from_birth_date("1996-08-16", TODAY) == 30
    # Birthday not yet reached this year.
    assert o.age_from_birth_date("1996-08-17", TODAY) == 29
    assert o.age_from_birth_date("1996-12-31", TODAY) == 29


def test_age_from_birth_date_handles_bad_input():
    for bad in (None, "", "not-a-date", "1996-13-45", 12345, "0000-00-00"):
        assert o.age_from_birth_date(bad, TODAY) is None
    # A future birth date is not a negative age.
    assert o.age_from_birth_date("2030-01-01", TODAY) is None


def test_no_age_preference_accepts_everyone():
    viewer = user(1, "男")
    assert o.accepts_age(viewer, user(2, "女", birth_date="1990-01-01"), TODAY)
    assert o.accepts_age(viewer, user(3, "女"), TODAY)  # unknown age too


def test_age_range_is_a_hard_filter():
    viewer = user(1, "男", age_min=28, age_max=34)
    assert o.accepts_age(viewer, user(2, "女", birth_date="1996-01-01"), TODAY)      # 30
    assert not o.accepts_age(viewer, user(3, "女", birth_date="2005-01-01"), TODAY)  # 21
    assert not o.accepts_age(viewer, user(4, "女", birth_date="1980-01-01"), TODAY)  # 46


def test_age_range_boundaries_are_inclusive():
    viewer = user(1, "男", age_min=30, age_max=30)
    assert o.accepts_age(viewer, user(2, "女", birth_date="1996-08-16", ), TODAY)  # exactly 30
    assert not o.accepts_age(viewer, user(3, "女", birth_date="1996-08-17"), TODAY)  # 29


def test_a_stated_range_rejects_an_unknown_age():
    # An explicit requirement is not waived because the other profile is
    # incomplete — same rule the per-question filters use for a missing answer.
    viewer = user(1, "男", age_min=28, age_max=34)
    assert not o.accepts_age(viewer, user(2, "女"), TODAY)


def test_one_sided_age_bounds_are_honoured():
    only_min = user(1, "男", age_min=30)
    assert o.accepts_age(only_min, user(2, "女", birth_date="1990-01-01"), TODAY)      # 36
    assert not o.accepts_age(only_min, user(3, "女", birth_date="2000-01-01"), TODAY)  # 26
    only_max = user(4, "男", age_max=30)
    assert o.accepts_age(only_max, user(5, "女", birth_date="2000-01-01"), TODAY)      # 26
    assert not o.accepts_age(only_max, user(6, "女", birth_date="1990-01-01"), TODAY)  # 36


def test_age_filter_is_mutual():
    # He accepts her age, she does not accept his: the pair must not survive.
    young = user(1, "男", birth_date="2004-01-01", age_min=18, age_max=60)   # 22
    older = user(2, "女", birth_date="1986-01-01", age_min=35, age_max=45)   # 40
    assert o.accepts_age(young, older, TODAY)
    assert not o.accepts_age(older, young, TODAY)
    assert not matching.mutually_acceptable(young, older, TODAY)


def test_age_filter_drops_the_candidate_from_the_ranking():
    viewer = user(1, "男", age_min=28, age_max=34)
    too_young = user(2, "女", birth_date="2006-01-01")
    ok = user(3, "女", birth_date="1996-01-01")
    order = matching._preference_order(viewer, [too_young, ok], {}, None, TODAY)
    assert order == [3]


def test_valid_age_range():
    assert o.valid_age_range(None, None)
    assert o.valid_age_range(28, 34)
    assert o.valid_age_range(28, 28)
    assert o.valid_age_range(30, None)
    assert o.valid_age_range(None, 30)
    assert not o.valid_age_range(34, 28)   # inverted
    assert not o.valid_age_range(17, 30)   # under 18
    assert not o.valid_age_range(30, 120)  # absurd


# -------------------------------------------------- same-gender pairing ----

def test_same_gender_pool_gets_paired():
    pool = [user(1, "男", seeking="男", orientation=o.GAY),
            user(2, "男", seeking="男", orientation=o.GAY)]
    assert len(matching.generate_matches(pool)) == 1


def test_same_gender_pairing_is_greedy_on_score():
    # 1 and 2 answer identically and must pair; 3 is the odd one out.
    pool = [user(1, "男", seeking="男", answer=4),
            user(2, "男", seeking="男", answer=4),
            user(3, "男", seeking="男", answer=7)]
    result = matching.generate_matches(pool)
    assert len(result) == 1
    assert {result[0][0], result[0][1]} == {1, 2}


def test_odd_sized_same_gender_pool_leaves_one_unmatched():
    pool = [user(i, "女", seeking="女") for i in range(1, 6)]
    result = matching.generate_matches(pool)
    assert len(result) == 2  # 5 people -> 2 pairs, 1 unmatched
    paired = [uid for pair in result for uid in pair[:2]]
    assert len(paired) == len(set(paired)) == 4


def test_same_gender_pairing_is_deterministic():
    pool = [user(i, "男", seeking="男", answer=(i % 7) + 1) for i in range(1, 11)]
    first = matching.generate_matches(pool)
    second = matching.generate_matches(list(reversed(pool)))
    assert sorted((min(a, b), max(a, b)) for a, b, _ in first) == \
           sorted((min(a, b), max(a, b)) for a, b, _ in second)


def test_same_gender_pool_respects_dislikes():
    pool = [user(1, "男", seeking="男"), user(2, "男", seeking="男")]
    exclusions = matching.build_exclusions([(1, 2)])
    assert matching.generate_matches(pool, exclusions) == []


def test_same_gender_pool_respects_hard_filters():
    q1 = ALL_QUESTION_IDS[0]
    a = user(1, "男", seeking="男", answer=2, prefs={q1: "same"})
    b = user(2, "男", seeking="男", answer=6)
    assert matching.generate_matches([a, b]) == []


def test_same_gender_pool_respects_age():
    a = user(1, "女", seeking="女", birth_date="1996-01-01", age_min=28, age_max=34)
    b = user(2, "女", seeking="女", birth_date="2006-01-01")
    assert matching.generate_matches([a, b], today=TODAY) == []


# ------------------------------------------------------ all pools together ----

def test_all_three_pools_match_in_one_run():
    pool = [
        user(1, "男"), user(2, "女"),                                    # opposite
        user(3, "男", seeking="男"), user(4, "男", seeking="男"),          # gay men
        user(5, "女", seeking="女"), user(6, "女", seeking="女"),          # gay women
    ]
    result = matching.generate_matches(pool)
    pairs = {frozenset((a, b)) for a, b, _ in result}
    assert pairs == {frozenset((1, 2)), frozenset((3, 4)), frozenset((5, 6))}


def test_nobody_is_matched_twice_across_pools():
    pool = ([user(i, "男") for i in range(1, 6)]
            + [user(i, "女") for i in range(6, 11)]
            + [user(i, "男", seeking="男") for i in range(11, 16)]
            + [user(i, "女", seeking="女") for i in range(16, 21)])
    result = matching.generate_matches(pool)
    paired = [uid for pair in result for uid in pair[:2]]
    assert len(paired) == len(set(paired))


def test_a_shortage_in_one_pool_does_not_starve_another():
    # Nine men and one woman in the opposite pool leaves eight unmatched, but
    # the same-gender pool must still pair up completely.
    pool = ([user(i, "男") for i in range(1, 10)] + [user(10, "女")]
            + [user(11, "女", seeking="女"), user(12, "女", seeking="女")])
    result = matching.generate_matches(pool)
    pairs = {frozenset((a, b)) for a, b, _ in result}
    assert frozenset((11, 12)) in pairs
    assert len(result) == 2


def test_a_pool_of_one_is_left_alone():
    assert matching.generate_matches([user(1, "男", seeking="男")]) == []
    assert matching.generate_matches([user(1, "男"), user(2, "男")]) == []


def test_legacy_users_without_the_new_fields_still_match():
    # Rows as they exist today: no orientation, seeking, or birth date at all.
    bare = [
        {"id": 1, "gender": "男", "answers": {}, "important_question_ids": [], "match_preferences": {}},
        {"id": 2, "gender": "女", "answers": {}, "important_question_ids": [], "match_preferences": {}},
    ]
    assert len(matching.generate_matches(bare)) == 1


if __name__ == "__main__":
    import sys
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  FAIL {name}: {exc}")
    print(f"\n{'FAILED' if failures else 'all passed'} ({failures} failure(s))")
    sys.exit(1 if failures else 0)
