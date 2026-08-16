"""Tests for how free text feeds into pairing.

The invariants that matter: text may reorder candidates, but it must never
exclude anyone, never outvote the questionnaire, and never break the guarantees
the hard filters and dislike exclusions already provide.

Run: ./venv/bin/python test_matching_text.py
"""
import matching
from questionnaire_config import ALL_QUESTION_IDS


def user(uid, gender, answer=4, bio="", expectation="", important=(), prefs=None):
    return {
        "id": uid,
        "gender": gender,
        "answers": {qid: answer for qid in ALL_QUESTION_IDS},
        "important_question_ids": list(important),
        "match_preferences": prefs or {},
        "bio": bio,
        "match_preference": expectation,
    }


def test_text_breaks_a_questionnaire_tie():
    # Both candidates answer identically, so the questionnaire cannot separate
    # them; only the bios differ.
    viewer = user(1, "男", expectation="我想找一个喜欢爬山和露营的人")
    hiker = user(2, "女", bio="周末喜欢爬山和露营")
    gamer = user(3, "女", bio="喜欢在家打游戏看番")
    index = matching.build_text_index([viewer, hiker, gamer])
    order = matching._preference_order(viewer, [gamer, hiker], {}, index)
    assert order == [2, 3], order


def test_text_cannot_exclude_anyone():
    # A candidate whose bio shares nothing with the expectation still has to
    # appear in the ranking, just lower down.
    viewer = user(1, "男", expectation="我想找一个喜欢爬山的人")
    unrelated = user(2, "女", bio="我喜欢做甜点")
    index = matching.build_text_index([viewer, unrelated])
    assert matching._preference_order(viewer, [unrelated], {}, index) == [2]


def test_blank_text_is_not_penalised():
    # Someone who wrote nothing must rank exactly where the questionnaire puts
    # them, not below a worse-matching candidate who happened to write a bio.
    viewer = user(1, "男", expectation="我想找一个喜欢爬山的人")
    silent_good_answers = user(2, "女", answer=4, bio="")
    chatty_bad_answers = user(3, "女", answer=7, bio="我超级喜欢爬山")
    index = matching.build_text_index([viewer, silent_good_answers, chatty_bad_answers])
    order = matching._preference_order(viewer, [chatty_bad_answers, silent_good_answers], {}, index)
    assert order[0] == 2, order


def test_text_cannot_outvote_the_questionnaire():
    # A perfect text match with badly mismatched answers must still lose to a
    # questionnaire-aligned candidate with no text at all.
    viewer = user(1, "男", answer=1, expectation="喜欢爬山")
    aligned = user(2, "女", answer=1, bio="")
    text_twin = user(3, "女", answer=7, bio="喜欢爬山")
    index = matching.build_text_index([viewer, aligned, text_twin])
    order = matching._preference_order(viewer, [text_twin, aligned], {}, index)
    assert order[0] == 2, order


def test_hard_filters_still_win_over_a_perfect_text_match():
    # Question 1: viewer is on the left and demands the same side; the text twin
    # is on the right. No amount of text overlap may resurrect them.
    viewer = user(1, "男", answer=2, expectation="喜欢爬山", prefs={ALL_QUESTION_IDS[0]: "same"})
    wrong_side = user(2, "女", answer=6, bio="喜欢爬山")
    index = matching.build_text_index([viewer, wrong_side])
    assert matching._preference_order(viewer, [wrong_side], {}, index) == []


def test_dislikes_still_win_over_a_perfect_text_match():
    viewer = user(1, "男", expectation="喜欢爬山")
    blocked = user(2, "女", bio="喜欢爬山")
    exclusions = matching.build_exclusions([(1, 2)])
    index = matching.build_text_index([viewer, blocked])
    assert matching._preference_order(viewer, [blocked], exclusions, index) == []


def test_pair_score_is_symmetric():
    a = user(1, "男", bio="我喜欢看书", expectation="我想找喜欢爬山的人")
    b = user(2, "女", bio="我喜欢爬山", expectation="我想找喜欢看书的人")
    index = matching.build_text_index([a, b])
    assert matching.pair_score(a, b, index) == matching.pair_score(b, a, index)


def test_pair_score_stays_in_range():
    a = user(1, "男", answer=1, bio="喜欢爬山", expectation="喜欢爬山")
    b = user(2, "女", answer=7, bio="喜欢看书", expectation="喜欢看书")
    for pair in ((a, b), (a, a), (b, b)):
        index = matching.build_text_index(list(pair))
        assert 0.0 <= matching.pair_score(pair[0], pair[1], index) <= 1.0


def test_matching_runs_without_any_text():
    # Nobody has filled in a bio yet — the whole feature has to be a no-op
    # rather than an error or an empty result.
    pool = [user(1, "男"), user(2, "女")]
    assert len(matching.gale_shapley_matching(pool)) == 1


def test_matching_builds_its_own_index_when_not_given_one():
    pool = [
        user(1, "男", bio="喜欢看书", expectation="喜欢爬山"),
        user(2, "女", bio="喜欢爬山", expectation="喜欢看书"),
    ]
    assert len(matching.gale_shapley_matching(pool)) == 1


def test_text_changes_who_gets_matched():
    # Two men, two women, identical answers throughout, so the questionnaire is
    # a four-way tie and text is the only signal. Each man should get the woman
    # whose bio answers his expectation.
    pool = [
        user(1, "男", bio="我是程序员", expectation="想找喜欢爬山露营的人"),
        user(2, "男", bio="我是老师", expectation="想找喜欢烘焙做菜的人"),
        user(3, "女", bio="周末爬山露营", expectation=""),
        user(4, "女", bio="平时烘焙做菜", expectation=""),
    ]
    result = {p: r for p, r, _ in matching.gale_shapley_matching(pool)}
    assert result == {1: 3, 2: 4}, result


def test_everyone_matched_at_most_once_with_text_in_play():
    pool = [user(i, "男" if i % 2 else "女", answer=(i % 7) + 1,
                 bio=f"我喜欢活动{i}", expectation=f"想找喜欢活动{i % 3}的人")
            for i in range(1, 21)]
    assignments = matching.gale_shapley_matching(pool)
    paired = [uid for pair in assignments for uid in pair[:2]]
    assert len(paired) == len(set(paired))


def test_shared_interest_terms_reports_the_overlap():
    viewer = user(1, "男", expectation="我想找一个喜欢爬山的人")
    other = user(2, "女", bio="我很喜欢爬山")
    index = matching.build_text_index([viewer, other, user(3, "女", bio="我喜欢做饭")])
    assert "爬山" in matching.shared_interest_terms(viewer, other, index)


def test_shared_interest_terms_is_empty_without_text():
    viewer = user(1, "男")
    other = user(2, "女")
    index = matching.build_text_index([viewer, other])
    assert matching.shared_interest_terms(viewer, other, index) == []
    assert matching.shared_interest_terms(viewer, other, None) == []


def test_shared_interest_terms_is_directional():
    # A's expectation vs B's bio is a different set of words from the reverse.
    a = user(1, "男", bio="我喜欢看书", expectation="想找喜欢爬山的人")
    b = user(2, "女", bio="我喜欢爬山", expectation="想找喜欢做饭的人")
    index = matching.build_text_index([a, b])
    assert matching.shared_interest_terms(a, b, index) != matching.shared_interest_terms(b, a, index)


def test_missing_text_keys_do_not_crash():
    # Users assembled without the free-text keys at all (older callers, or a
    # row where both columns are NULL).
    bare = [
        {"id": 1, "gender": "男", "answers": {}, "important_question_ids": [], "match_preferences": {}},
        {"id": 2, "gender": "女", "answers": {}, "important_question_ids": [], "match_preferences": {}},
    ]
    index = matching.build_text_index(bare)
    assert matching.text_fit(bare[0], bare[1], index) is None
    assert len(matching.gale_shapley_matching(bare)) == 1


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
