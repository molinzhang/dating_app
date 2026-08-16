"""Tests for the free-text n-gram matcher.

Run: ./venv/bin/python -m pytest test_text_match.py -q
     (or ./venv/bin/python test_text_match.py for a dependency-free run)
"""
import text_match as tm


def test_tokens_are_char_ngrams_of_both_orders():
    assert tm.tokens("看书") == ["看", "书", "看书"]


def test_tokens_never_span_punctuation():
    # "书画" would be a bogus bigram spanning the comma.
    assert "书画" not in tm.tokens("看书，画画")


def test_tokens_keep_single_char_runs():
    # A one-character run is shorter than the bigram window; it must still
    # survive at unigram order rather than vanishing.
    assert tm.tokens("我，好") == ["我", "好"]


def test_non_cjk_is_ignored():
    assert tm.tokens("hello 123 !@#") == []
    assert tm.tokens("") == []
    assert tm.tokens(None) == []


def test_identical_text_scores_one():
    # Normalized vectors, so self-similarity is 1.0 only up to float rounding.
    idf = tm.build_idf(["喜欢看书和爬山", "喜欢打游戏"])
    score = tm.cosine(tm.vector("喜欢看书", idf), tm.vector("喜欢看书", idf))
    assert abs(score - 1.0) < 1e-9


def test_disjoint_text_scores_zero():
    idf = tm.build_idf(["喜欢看书", "喜欢打游戏"])
    assert tm.cosine(tm.vector("看书", idf), tm.vector("游泳", idf)) == 0.0


def test_related_text_outscores_unrelated():
    corpus = [
        "我喜欢看书和爬山，周末喜欢安静地待在家里",
        "我想找一个喜欢看书、生活安静的人",
        "我是夜店常客，每周都要出去玩到天亮",
    ]
    idf = tm.build_idf(corpus)
    related = tm.cosine(tm.vector(corpus[1], idf), tm.vector(corpus[0], idf))
    unrelated = tm.cosine(tm.vector(corpus[1], idf), tm.vector(corpus[2], idf))
    assert related > unrelated


def test_score_is_bounded():
    corpus = ["喜欢看书", "喜欢爬山", "喜欢做饭"]
    idf = tm.build_idf(corpus)
    for a in corpus:
        for b in corpus:
            score = tm.cosine(tm.vector(a, idf), tm.vector(b, idf))
            assert 0.0 <= score <= 1.0 + 1e-9


def test_rare_words_count_for_more_than_common_ones():
    # "喜欢" appears in every document, so it should carry almost no weight,
    # while "潜水" appears in one. Two people who share only the boilerplate
    # must score below two who share the distinctive interest.
    corpus = ["喜欢看书", "喜欢爬山", "喜欢做饭", "喜欢潜水", "喜欢摄影"]
    idf = tm.build_idf(corpus)
    boilerplate_only = tm.cosine(tm.vector("喜欢看书", idf), tm.vector("喜欢爬山", idf))
    shared_rare = tm.cosine(tm.vector("喜欢潜水", idf), tm.vector("潜水", idf))
    assert shared_rare > boilerplate_only


def test_unseen_terms_do_not_crash_or_dominate():
    idf = tm.build_idf(["喜欢看书"])
    # "蹦极" was never in the corpus; it gets a fallback weight rather than a
    # KeyError, and a pair sharing it still scores above zero.
    score = tm.cosine(tm.vector("喜欢蹦极", idf), tm.vector("喜欢蹦极", idf))
    assert abs(score - 1.0) < 1e-9


def test_empty_vectors_are_safe():
    idf = tm.build_idf(["喜欢看书"])
    assert tm.cosine(tm.vector("", idf), tm.vector("喜欢看书", idf)) == 0.0
    assert tm.build_idf([]) == {}
    assert tm.build_idf(["", "   ", None]) == {}


def test_shared_terms_reports_the_overlap():
    idf = tm.build_idf(["喜欢看书爬山", "喜欢打游戏", "喜欢做饭"])
    terms = tm.shared_terms("我想找喜欢看书的人", "我喜欢看书", idf)
    assert "看书" in terms


def test_shared_terms_drops_subterms_of_longer_matches():
    idf = tm.build_idf(["看书", "爬山", "游泳"])
    terms = tm.shared_terms("看书", "看书", idf, limit=3)
    # "看" and "书" are both shared too, but they are inside "看书".
    assert terms == ["看书"]


def test_shared_terms_drops_ngram_fragments_that_straddle_words():
    # "桌游剧本杀" produces the bigrams 桌游 / 游剧 / 剧本 / 本杀; 游剧 and 本杀
    # are fragments spanning two words and must not be shown to a user.
    corpus = ["桌游剧本杀爱好者，家里一柜子桌游", "希望找一个喜欢桌游剧本杀的人"] + \
             [f"我喜欢活动{i}" for i in range(10)]
    idf = tm.build_idf(corpus)
    terms = tm.shared_terms(corpus[1], corpus[0], idf, limit=3)
    assert "游剧" not in terms and "本杀" not in terms, terms
    assert "桌游" in terms, terms


def test_shared_terms_still_reports_genuinely_distinct_interests():
    # 爬山 and 露营 share no characters, so both survive the overlap filter.
    corpus = ["周末都在爬山露营", "想找愿意一起爬山露营的人"] + \
             [f"我喜欢活动{i}" for i in range(10)]
    idf = tm.build_idf(corpus)
    terms = tm.shared_terms(corpus[1], corpus[0], idf, limit=3)
    assert "爬山" in terms and "露营" in terms, terms


def test_shared_terms_empty_when_nothing_overlaps():
    idf = tm.build_idf(["看书", "游泳"])
    assert tm.shared_terms("看书", "游泳", idf) == []


def test_directional_score_is_none_without_an_expectation():
    idf = tm.build_idf(["喜欢看书"])
    assert tm.directional_score("", "喜欢看书", idf) is None
    assert tm.directional_score(None, "喜欢看书", idf) is None
    assert tm.directional_score("   ", "喜欢看书", idf) is None


def test_directional_score_is_zero_when_only_the_bio_is_missing():
    # The viewer *did* state an expectation and this candidate answers none of
    # it — that is a real 0.0, not a missing signal.
    idf = tm.build_idf(["喜欢看书"])
    assert tm.directional_score("喜欢看书", "", idf) == 0.0


def test_the_two_directions_of_a_pair_can_disagree():
    # Cosine itself is symmetric; the asymmetry comes from which *fields* get
    # compared. A's expectation vs B's bio is a different question from B's
    # expectation vs A's bio, so one side can be satisfied while the other
    # isn't. Here A wants someone quiet and B is quiet, but B wants someone
    # outdoorsy and A never mentions it.
    a_bio, a_expectation = "我很安静，喜欢在家看书", "我想找一个安静的人"
    b_bio, b_expectation = "我很安静，不爱热闹", "我想找一个喜欢爬山露营的人"
    idx = tm.Index([a_bio, a_expectation, b_bio, b_expectation])
    assert idx.score(a_expectation, b_bio) > idx.score(b_expectation, a_bio)


def test_index_matches_the_plain_functions():
    corpus = ["我喜欢看书", "我想找喜欢看书的人", "我爱打游戏"]
    idx = tm.Index(corpus)
    assert idx.score(corpus[1], corpus[0]) == tm.directional_score(corpus[1], corpus[0], idx.idf)
    assert idx.shared(corpus[1], corpus[0]) == tm.shared_terms(corpus[1], corpus[0], idx.idf)
    assert idx.score("", corpus[0]) is None


def test_index_caches_by_text():
    idx = tm.Index(["我喜欢看书", "我爱打游戏"])
    idx.score("我喜欢看书", "我爱打游戏")
    idx.score("我喜欢看书", "我爱打游戏")
    # Both documents vectorized once each, not once per comparison.
    assert len(idx._vectors) == 2


def test_common_words_absent_from_the_corpus_do_not_dominate():
    # "我" is in neither corpus document, so it falls back to the unseen-term
    # weight. If that fallback is too large, two people who share only "我"
    # outscore two who share a real interest.
    idx = tm.Index(["喜欢看书爬山", "喜欢打游戏", "喜欢做饭"])
    stopword_only = idx.score("我", "我")
    real_overlap = idx.score("看书", "看书")
    assert real_overlap >= stopword_only
    assert "看书" in idx.shared("我想找喜欢看书的人", "我喜欢看书")


def test_ubiquitous_terms_are_dropped_as_stopwords():
    # "我喜欢" is in all 10 documents, so it must not contribute at all —
    # otherwise two people who share nothing else still look similar.
    corpus = [f"我喜欢活动{i}" for i in range(10)]
    idf = tm.build_idf(corpus)
    assert idf["喜欢"] == 0.0
    assert idf["我"] == 0.0
    assert tm.cosine(tm.vector("我喜欢跳伞", idf), tm.vector("我喜欢做饭", idf)) == 0.0


def test_stopword_filter_is_off_for_tiny_corpora():
    # With 3 documents, "in more than half of them" is noise, not evidence, so
    # a content word in every document still counts.
    idf = tm.build_idf(["爬山和看书", "爬山和做饭", "爬山和摄影"])
    assert idf["爬山"] > 0.0


def test_modal_verbs_are_filtered_as_whole_terms():
    # 可以/愿意 are pure scaffolding, but 可 and 意 individually appear in real
    # words (可爱, 创意), so they can only be filtered as complete terms.
    idf = tm.build_idf(["我可以陪你爬山", "我愿意学潜水"])
    assert idf["可以"] == 0.0
    assert idf["愿意"] == 0.0
    assert idf["爬山"] > 0.0
    assert idf["潜水"] > 0.0


def test_display_floor_hides_terms_that_are_common_in_the_pool():
    # Every document mentions 周末, so it is true but useless as an explanation
    # of why these two were paired; 潜水 appears twice and is the real signal.
    corpus = [f"周末喜欢活动{i}" for i in range(20)] + ["周末喜欢潜水", "周末想找人潜水"]
    idx = tm.Index(corpus)
    terms = idx.shared("周末想找人潜水", "周末喜欢潜水")
    assert "潜水" in terms
    assert "周末" not in terms


def test_display_floor_is_disabled_for_tiny_corpora():
    idx = tm.Index(["喜欢爬山", "喜欢看书"])
    assert idx.min_display_idf == 0.0
    assert "爬山" in idx.shared("喜欢爬山", "喜欢爬山")


def test_function_words_are_dropped_at_any_corpus_size():
    # The frequency ceiling cannot catch these in a small pool, but they never
    # carry information about what someone actually likes.
    idf = tm.build_idf(["我想找一个喜欢看书的人"])
    for term in ("的", "我", "一个", "的人", "想找", "喜欢", "找一"):
        assert idf.get(term) == 0.0, term
    assert idf["看书"] > 0.0


def test_content_words_survive_even_when_they_contain_a_function_char():
    # Only terms made *entirely* of function characters are dropped: 有 alone is
    # scaffolding, 有趣 is not.
    idf = tm.build_idf(["希望对方有趣、心地善良，喜欢下厨和爬山"])
    for term in ("有趣", "心地", "善良", "下厨", "爬山"):
        assert idf.get(term, 0.0) > 0.0, term


def test_two_texts_of_pure_scaffolding_do_not_match():
    # Both people wrote a sentence with no content in it at all. That has to
    # come out as no signal rather than a near-perfect score.
    idf = tm.build_idf(["我想找一个喜欢看书的人", "我很喜欢爬山", "希望对方喜欢做饭"])
    assert tm.cosine(tm.vector("我想找一个人", idf), tm.vector("我希望对方是一个人", idf)) == 0.0


def test_stopwords_are_dropped_not_treated_as_unseen():
    # The subtle failure mode: if an over-common term were simply left out of
    # the IDF map, `vector` would fall through to the unseen-term weight and it
    # would come back as the *strongest* signal instead of being ignored.
    corpus = [f"我喜欢活动{i}" for i in range(10)]
    idf = tm.build_idf(corpus)
    assert "我" not in tm.vector("我喜欢活动0", idf)


def test_shared_terms_never_reports_a_stopword():
    corpus = [f"我很喜欢活动{i}，这是我的自我介绍" for i in range(12)]
    idf = tm.build_idf(corpus)
    assert tm.shared_terms("我很喜欢潜水", "我很喜欢烘焙", idf) == []


def test_shared_terms_never_reports_single_characters():
    idf = tm.build_idf(["看书", "爬山", "游泳", "做饭", "摄影", "潜水", "滑雪", "烘焙"])
    # "书" alone would be ambiguous; only multi-character terms are shown.
    assert all(len(t) >= 2 for t in tm.shared_terms("看书", "看书", idf))


def test_shared_terms_still_finds_real_overlap_in_a_realistic_pool():
    corpus = [
        "周末基本都在山里，爬山露营是我的续命方式",
        "希望找一个愿意跟我一起爬山露营的人",
        "常驻独立书店，最近在读非虚构的书",
        "想找一个也喜欢看书的人，能一起逛书店",
        "下厨是我最放松的时候，擅长家常菜和烘焙",
        "希望对方喜欢吃也喜欢做饭，能一起研究菜谱",
        "重度游戏玩家，主机和单机都玩，也追番",
        "想找一个能一起打游戏看动漫的人",
        "每天跑步，跑过两次马拉松，健身房常客",
        "希望对方也喜欢运动跑步健身，能互相督促",
    ]
    idf = tm.build_idf(corpus)
    assert "爬山" in tm.shared_terms(corpus[1], corpus[0], idf)
    assert "跑步" in tm.shared_terms(corpus[9], corpus[8], idf)
    # And an unrelated pair yields nothing rather than function words.
    assert tm.shared_terms(corpus[1], corpus[8], idf) == []


def test_related_text_still_outscores_unrelated_after_stopword_removal():
    corpus = [
        "周末基本都在山里，爬山露营是我的续命方式",
        "希望找一个愿意跟我一起爬山露营的人",
        "每天跑步，跑过两次马拉松，健身房常客",
        "常驻独立书店，最近在读非虚构的书",
        "下厨是我最放松的时候，擅长家常菜和烘焙",
        "重度游戏玩家，主机和单机都玩，也追番",
        "咖啡重度依赖，会自己手冲，喜欢在城市里瞎逛",
        "影迷，一年看一百多部，偏爱纪录片",
        "家里有两只猫，周末喜欢在家陪猫看剧",
        "常去博物馆和画展，对艺术史很感兴趣",
    ]
    idf = tm.build_idf(corpus)
    related = tm.cosine(tm.vector(corpus[1], idf), tm.vector(corpus[0], idf))
    unrelated = tm.cosine(tm.vector(corpus[1], idf), tm.vector(corpus[7], idf))
    assert related > unrelated
    assert related > 0.1, related


def test_blend_ignores_a_missing_text_score():
    assert tm.blend(0.8, None) == 0.8


def test_blend_moves_toward_the_text_score():
    assert tm.blend(0.8, 1.0) > 0.8
    assert tm.blend(0.8, 0.0) < 0.8
    assert tm.blend(0.5, 0.5) == 0.5


def test_blend_stays_in_range():
    for q in (0.0, 0.5, 1.0):
        for t in (0.0, 0.5, 1.0):
            assert 0.0 <= tm.blend(q, t) <= 1.0


def test_text_weight_is_a_minority_share():
    # The questionnaire is 24 deliberate answers; free text must not be able to
    # outvote it.
    assert 0 < tm.TEXT_WEIGHT < 0.5


def test_text_weight_is_resolved_at_call_time():
    # Binding TEXT_WEIGHT as a default argument would freeze it at import, so
    # tuning the constant would silently do nothing.
    original = tm.TEXT_WEIGHT
    try:
        tm.TEXT_WEIGHT = 0.5
        assert tm.blend(0.0, 1.0) == 0.5
    finally:
        tm.TEXT_WEIGHT = original


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
