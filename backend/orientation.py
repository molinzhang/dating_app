"""Orientation, matching pools, and age filtering.

Gale-Shapley's stability proof needs a two-sided market, so the pool has to be
split before it can run. A person is described by two things: their own gender
and the gender they want (`seeking`). That gives exactly three disjoint pools:

    男 seeking 女  +  女 seeking 男   -> one bipartite pool, Gale-Shapley
    男 seeking 男                     -> same-gender pool, general graph
    女 seeking 女                     -> same-gender pool, general graph

The pools are disjoint by construction, which is what makes "同性喜欢的自己构成
一个独立的池子" work: a 女 seeking 女 is never offered to a 男 seeking 女,
because the woman does not want men. Same-gender pools cannot use Gale-Shapley
at all — see gale_shapley_matching's counterpart in matching.py — because with
everyone on one side there is no proposer/receiver split.

`orientation` is the tag the user sets; `seeking` is what the matcher acts on.
Both are stored because they answer different questions: orientation is
identity and is shown/validated, seeking is the current pool assignment. A
bisexual person has one orientation but picks one `seeking` per cycle, so they
sit in exactly one pool at a time rather than being matched twice.
"""
from datetime import date

GENDERS = ("男", "女")

# Mirrors website/src/features/v2/orientation.ts, which the frontend already
# validates against. Kept in the backend's 男/女 vocabulary rather than V2's
# male/female so it matches the existing users.gender column.
STRAIGHT = "straight"
GAY = "gay"
BISEXUAL = "bisexual"
ORIENTATIONS = (STRAIGHT, GAY, BISEXUAL)

MIN_AGE = 18
MAX_AGE = 99


def opposite_gender(gender):
    return "女" if gender == "男" else "男"


def seeking_of(user):
    """The gender this person wants.

    Defaults to the opposite gender so that every account created before
    orientation existed keeps behaving exactly as it did.
    """
    seeking = user.get("seeking_gender")
    if seeking in GENDERS:
        return seeking
    return opposite_gender(user["gender"])


def orientation_of(user):
    orientation = user.get("orientation")
    return orientation if orientation in ORIENTATIONS else STRAIGHT


def orientation_allows(orientation, gender, seeking):
    """Whether an (orientation, gender, seeking) triple is self-consistent.

    Bisexual allows either. Straight and gay each pin `seeking` relative to the
    person's own gender, so a "straight 男 seeking 男" row is a data error
    rather than a preference we should silently honour.
    """
    if orientation == BISEXUAL:
        return seeking in GENDERS
    if orientation == GAY:
        return seeking == gender
    return seeking == opposite_gender(gender)


def pool_key(user):
    """Which pool this person belongs to.

    Same-gender seekers key on their own gender; opposite-gender seekers all
    share the one bipartite pool regardless of which side they are on.
    """
    gender = user["gender"]
    seeking = seeking_of(user)
    if seeking == gender:
        return ("same", gender)
    return ("opposite", None)


def split_into_pools(eligible_users):
    """Group the eligible pool into independent matching pools.

    Returns {pool_key: [users]}. Each pool is matched separately and nobody
    appears in two, so a person can only ever receive one recommendation.
    """
    pools = {}
    for user in eligible_users:
        pools.setdefault(pool_key(user), []).append(user)
    return pools


def mutually_interested(user_a, user_b):
    """Whether each wants the other's gender.

    Redundant inside a single pool, which is already homogeneous, but it is the
    check that keeps a bug in pool assignment from quietly producing a pairing
    nobody asked for.
    """
    return (
        seeking_of(user_a) == user_b["gender"]
        and seeking_of(user_b) == user_a["gender"]
    )


# ------------------------------------------------------------------- age ----

def age_from_birth_date(birth_date, today=None):
    """Age in whole years from an ISO 'YYYY-MM-DD' string, or None.

    Stores the birth date rather than an age so the number does not silently go
    stale, and counts whole years rather than subtracting years so someone
    whose birthday has not arrived yet is not aged up early.
    """
    if not birth_date:
        return None
    try:
        year, month, day = (int(part) for part in str(birth_date)[:10].split("-"))
        born = date(year, month, day)
    except (ValueError, TypeError):
        return None
    today = today or date.today()
    if born > today:
        return None
    had_birthday = (today.month, today.day) >= (born.month, born.day)
    return today.year - born.year - (0 if had_birthday else 1)


def age_of(user, today=None):
    if user.get("age") is not None:
        return user["age"]
    return age_from_birth_date(user.get("birth_date"), today)


def age_range_of(user):
    """The viewer's requested (min, max), or None when they set no preference.

    A one-sided bound is honoured: someone who only set a minimum gets an open
    upper end rather than having the whole preference ignored.
    """
    low = user.get("preferred_age_min")
    high = user.get("preferred_age_max")
    if low is None and high is None:
        return None
    return (low if low is not None else MIN_AGE, high if high is not None else MAX_AGE)


def accepts_age(viewer, other, today=None):
    """Whether `other` falls inside the age range `viewer` asked for.

    An unstated preference accepts anyone. A stated preference against an
    unknown age fails, matching how the per-question hard filters treat a
    missing answer: an explicit requirement is not quietly waived just because
    the other person left their profile incomplete.
    """
    wanted = age_range_of(viewer)
    if wanted is None:
        return True
    age = age_of(other, today)
    if age is None:
        return False
    return wanted[0] <= age <= wanted[1]


def valid_age_range(low, high):
    if low is None and high is None:
        return True
    low = MIN_AGE if low is None else low
    high = MAX_AGE if high is None else high
    return MIN_AGE <= low <= high <= MAX_AGE
