"""Free-text similarity between someone's stated expectations and a candidate's bio.

Character n-gram TF-IDF, stdlib only — no model download, no API key, no
dependency. Chinese has no spaces, so tokens are character n-grams rather than
whitespace-split words; most Chinese words are 1-2 characters, which is why the
default range is (1, 2).

Why (1, 2) and not more: measured on a hand-labelled set of related/unrelated
Chinese bios, separation (mean related minus mean unrelated) *falls* as higher
orders are added — 0.340 at (1,1), 0.244 at (1,2), 0.167 at (1,3), 0.129 at
(1,4). Longer n-grams almost never recur across two people writing about the
same thing in their own words, but they still count in the L2 norm, so they
dilute the terms that do match. (1,2) is preferred over the slightly better
(1,1) because single characters are ambiguous in Chinese ("生" appears in both
生活 and 生物) and bigrams alone miss too much: at (2,2) some genuinely related
pairs score exactly 0.

Known limitation: this is lexical, not semantic. "喜欢安静" and "不太爱社交"
mean the same thing and share no characters, so they score 0.0 at every n-gram
range. Only embeddings fix that. The compensating advantage is explainability —
`shared_terms` reports which words drove a score, which an embedding cannot.
"""
import math
import re
from collections import Counter

# Matched runs of CJK characters; punctuation and latin text are dropped, so
# n-grams never span a comma or a word boundary.
_CJK_RUN = re.compile(r"[一-鿿]+")

NGRAM_MIN = 1
NGRAM_MAX = 2

# How much the text signal counts relative to the questionnaire score. The
# questionnaire is 24 deliberate answers; free text is a couple of sentences
# someone dashed off, so it stays the minority share.
#
# Measured on the 45-person pool (mean text fit of realised pairs, against the
# 0.0138 a random pairing gives): 0.00 → 0.61x, 0.15 → 0.77x, 0.25 → 1.14x,
# 0.40 → 2.56x, 0.60 → 6.82x, 1.00 → 8.36x. Below ~0.25 the feature is
# invisible; 0.40 makes it act on roughly two thirds of pairings while the
# questionnaire still holds 60% of the weight.
#
# Must stay under 0.5: at exactly 0.5 a perfect text match ties with a perfect
# questionnaire match, and above it two sentences of free text can outvote all
# 24 answers. test_text_cannot_outvote_the_questionnaire pins this.
TEXT_WEIGHT = 0.4

# A term appearing in more than this fraction of documents is treated as a
# stopword and dropped. IDF alone does not handle Chinese function words at
# this corpus size: 的/我/喜欢 appear in most bios, and while IDF does discount
# them, it still leaves them as the *only* overlap between two people who share
# no actual interests — which both inflates their similarity and produces
# explanations like "你们都提到了：的". Deriving the list from document
# frequency rather than hand-curating one means it adapts to however this
# particular pool writes.
MAX_DOCUMENT_FRACTION = 0.5

# Below this many documents the fraction above is too noisy to mean anything
# (with 4 documents, a term in 3 of them may still be distinctive), so the
# stopword filter stays off.
MIN_DOCS_FOR_STOPWORDS = 8

# Single characters are too ambiguous to show a user as a shared interest —
# "生" could be 生活 or 生物 — even when they legitimately drive the score.
MIN_DISPLAY_LENGTH = 2

# Chinese function characters: particles, pronouns, measure words, and the
# verbs people use to frame a sentence rather than to say anything about
# themselves. A term is a stopword when *every* character in it comes from this
# set, which is why it is safe to include characters that also appear inside
# real words — 地 is function-only alone but 心地 survives, 有 alone goes but
# 有趣 stays.
#
# This is needed on top of the document-frequency ceiling because char n-grams
# manufacture terms that straddle a word boundary: measured on the real pool,
# 找一 (31% of documents), 个喜 (18%), 能一 (15%) and 望找 (12%) are all
# meaningless fragments of "想找一个喜欢…的人", and each sits below any
# frequency ceiling loose enough to keep genuinely popular interests.
_FUNCTION_CHARS = set(
    "的地得了着过之"          # particles and aspect markers
    "我你他她它们自己"        # pronouns
    "一二两个些"              # numbers and measure words
    "是有在会能要想找希望喜欢"  # framing verbs: 想找一个喜欢…
    "也都就还很太不没只又再更最"  # adverbs and negation
    "跟对给从向于把被让以为"    # prepositions
    "人方起和或与及者"        # scaffolding nouns and conjunctions
    "什么样这那哪每如果但而所因"  # determiners and connectives
)


# Function words whose individual characters are NOT safe to blanket-filter:
# 可 appears in 可爱, 意 in 创意, 得 in 心得. Listed as whole terms instead.
_FUNCTION_TERMS = frozenset({
    "愿意", "可以", "觉得", "应该", "比较", "特别", "非常", "一直", "已经",
    "或者", "因为", "所以", "但是", "然后", "而且", "其实", "反正", "偶尔",
    "平时", "经常", "主要", "目前", "现在", "以后", "之前", "有点", "稍微",
})

# A displayed term must appear in no more than this fraction of documents.
# Measured on the real pool, genuine interests (爬山, 看书, 做饭) sit at 3-5%
# while sentence scaffolding sits at 12-51%, so a distinctiveness floor
# separates them without needing every modal verb enumerated by hand. Applies
# to the explanation only — the score still uses every non-stopword term.
MAX_DISPLAY_DOCUMENT_FRACTION = 0.15


def _is_stopword(term):
    """Carries no information about what someone likes. Used for scoring."""
    return term in _FUNCTION_TERMS or all(char in _FUNCTION_CHARS for char in term)


def _is_display_term(term):
    """Fit to show a user as a shared interest — a stricter bar than scoring.

    Requires *no* function characters, not merely some content ones. A char
    n-gram that straddles a word boundary picks up one function character and
    one real one — 欢爬 out of "喜欢爬山", 也喜 out of "也喜欢" — which reads as
    gibberish and, worse, can outrank the real word 爬山 on an IDF tie and then
    suppress it via the overlap filter below.
    """
    return (
        len(term) >= MIN_DISPLAY_LENGTH
        and term not in _FUNCTION_TERMS
        and not any(char in _FUNCTION_CHARS for char in term)
    )


def tokens(text, nmin=NGRAM_MIN, nmax=NGRAM_MAX):
    out = []
    for run in _CJK_RUN.findall(text or ""):
        for n in range(nmin, nmax + 1):
            if len(run) < n:
                # A run shorter than the window still carries signal at the
                # smallest order — keep it once rather than dropping it.
                if n == nmin:
                    out.append(run)
                continue
            out.extend(run[i:i + n] for i in range(len(run) - n + 1))
    return out


def build_idf(documents):
    """Inverse document frequency over the current pool.

    Recomputed per pairing run rather than persisted: it depends on the whole
    corpus, so a new user's text changes every other user's weights, and with a
    few dozen short documents it costs microseconds.

    Terms common to more than MAX_DOCUMENT_FRACTION of documents get a weight of
    0.0 rather than being omitted — an omitted term would fall through to the
    unseen-term weight in `vector` and come back as the *strongest* signal
    instead of the weakest.
    """
    docs = [d for d in documents if (d or "").strip()]
    total = len(docs)
    if not total:
        return {}
    seen = Counter()
    for doc in docs:
        seen.update(set(tokens(doc)))
    ceiling = total * MAX_DOCUMENT_FRACTION if total >= MIN_DOCS_FOR_STOPWORDS else total + 1
    return {
        term: 0.0 if count > ceiling or _is_stopword(term)
        else math.log((total + 1) / (count + 1)) + 1
        for term, count in seen.items()
    }


def vector(text, idf):
    """L2-normalized weighted term vector, as a sparse dict."""
    terms = tokens(text)
    if not terms:
        return {}
    weighted = {}
    fallback = None
    for term, count in Counter(terms).items():
        if _is_stopword(term):
            continue
        weight = idf.get(term)
        if weight == 0.0:
            continue  # too common in this pool to mean anything
        if weight is None:
            # A term absent from the corpus is capped at the weight of the
            # rarest term we have actually seen. Deriving it from vocabulary
            # size instead would make unseen terms outweigh every real one and
            # let function words like 我 dominate a pair's score.
            if fallback is None:
                fallback = max(idf.values(), default=1.0)
            weight = fallback
        # Sublinear term frequency: a word repeated five times is more
        # relevant than one used once, but not five times more.
        weighted[term] = (1 + math.log(count)) * weight
    norm = math.sqrt(sum(w * w for w in weighted.values()))
    if not norm:
        return {}
    return {term: w / norm for term, w in weighted.items()}


def cosine(vec_a, vec_b):
    """Both vectors are already normalized, so the dot product is the cosine."""
    if not vec_a or not vec_b:
        return 0.0
    small, large = (vec_a, vec_b) if len(vec_a) < len(vec_b) else (vec_b, vec_a)
    return sum(weight * large.get(term, 0.0) for term, weight in small.items())


def shared_terms(text_a, text_b, idf, limit=3, min_idf=0.0):
    """The terms contributing most to the pair's score, strongest first.

    Used to explain a recommendation in words rather than as a bare number, so
    this is stricter than the scorer: single characters are dropped as too
    ambiguous to show, and a term must actually contribute (stopwords score 0).
    An honest empty list is better than "你们都提到了：的".

    Sub-terms of a longer shared term are dropped, so "看书" is reported without
    also listing "看" and "书" — hence the tie-break on length, since a word and
    its constituent characters usually carry identical IDF and the longer form
    is the one worth showing.
    """
    va, vb = vector(text_a, idf), vector(text_b, idf)
    overlapping = sorted(
        (
            (term, va[term] * vb[term])
            for term in va
            # A term absent from the corpus appears in zero documents, so it is
            # maximally distinctive and always clears the floor.
            if term in vb
            and _is_display_term(term)
            and idf.get(term, math.inf) >= min_idf
        ),
        key=lambda pair: (-pair[1], -len(pair[0])),
    )
    kept = []
    for term, weight in overlapping:
        # Drop anything sharing a character with a term already kept. Adjacent
        # char n-grams from the same phrase overlap by one character, so
        # "桌游剧本杀" yields the fragments 游剧 and 本杀 alongside the real words
        # 桌游 and 剧本; a plain substring check keeps the fragments because
        # "游剧" is not inside "桌游". Costs the occasional near-duplicate
        # (书店 after 看书), which is no loss in a three-item list.
        if weight <= 0 or any(set(term) & set(other) for other in kept):
            continue
        kept.append(term)
        if len(kept) >= limit:
            break
    return kept


def directional_score(viewer_expectation, other_bio, idf):
    """How well `other_bio` answers what `viewer_expectation` asked for.

    Asymmetric on purpose: this compares A's stated expectations against B's
    self-description, which is a different question from comparing the two
    bios. Returns None when the viewer wrote no expectation, so the caller can
    fall back to the questionnaire score instead of reading a 0.0 as "bad
    match".
    """
    if not (viewer_expectation or "").strip():
        return None
    return cosine(vector(viewer_expectation, idf), vector(other_bio, idf))


def blend(questionnaire_score, text_score, text_weight=None):
    """Fold the text signal into the questionnaire score.

    A missing text score leaves the questionnaire score untouched rather than
    penalising people who left the field blank.

    `text_weight` is resolved from the module constant at call time, not bound
    as a default argument — otherwise the value is frozen at import and tuning
    it (or overriding it in a test) silently does nothing.
    """
    if text_score is None:
        return questionnaire_score
    if text_weight is None:
        text_weight = TEXT_WEIGHT
    return (1 - text_weight) * questionnaire_score + text_weight * text_score


class Index:
    """IDF plus cached vectors for one pairing run.

    Pairing compares every proposer to every receiver, so a bio would otherwise
    be re-tokenized once per comparison — O(n^2) vectorizations instead of
    O(n). Caching by text also collapses duplicate documents, which matters
    while much of the pool still shares seeded boilerplate.
    """

    def __init__(self, documents):
        self.idf = build_idf(documents)
        self._vectors = {}
        count = len([d for d in documents if (d or "").strip()])
        # Below MIN_DOCS_FOR_STOPWORDS there aren't enough documents for "rare"
        # to mean anything, so the floor is disabled rather than guessed.
        self.min_display_idf = (
            math.log((count + 1) / (count * MAX_DISPLAY_DOCUMENT_FRACTION + 1)) + 1
            if count >= MIN_DOCS_FOR_STOPWORDS else 0.0
        )

    def vector(self, text):
        key = (text or "").strip()
        if key not in self._vectors:
            self._vectors[key] = vector(key, self.idf)
        return self._vectors[key]

    def score(self, viewer_expectation, other_bio):
        """None when the viewer stated no expectation — see directional_score."""
        if not (viewer_expectation or "").strip():
            return None
        return cosine(self.vector(viewer_expectation), self.vector(other_bio))

    def shared(self, viewer_expectation, other_bio, limit=3):
        return shared_terms(
            viewer_expectation, other_bio, self.idf, limit, self.min_display_idf
        )
