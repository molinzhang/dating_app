import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor, execute_values


def _load_env_file():
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file()
DATABASE_URL = os.environ["DATABASE_URL"]

# The DB is remote (Supabase), so a fresh TCP+TLS handshake costs ~250ms.
# Opening one per query made a single login take ~8s; reuse them instead.
_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        # Sized for concurrent requests each running ~13 queries; 8 was tight
        # enough to exhaust under a burst.
        _pool = pg_pool.ThreadedConnectionPool(
            1, 16, DATABASE_URL, cursor_factory=RealDictCursor
        )
    return _pool


@contextmanager
def _cursor(commit=False):
    """Borrow a pooled connection in autocommit mode and yield a cursor.

    Autocommit matters for latency: with an implicit transaction open, psycopg2
    needs a second round trip (COMMIT/ROLLBACK) to release the connection, which
    tripled per-query cost against a remote DB (102ms -> 34ms without it). Every
    statement here is individually atomic, so no explicit transaction is needed;
    the multi-statement case uses _transaction() instead.

    `commit` is accepted for call-site readability but is a no-op under
    autocommit — each statement commits itself.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            yield cur
    finally:
        pool.putconn(conn)


@contextmanager
def _transaction():
    """Borrow a pooled connection with a real transaction, for multi-statement
    writes that must land atomically."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = True
        pool.putconn(conn)


# Arbitrary constant identifying the pairing lock; any fixed value works as
# long as nothing else in this database uses the same key.
PAIRING_LOCK_KEY = 918273645


@contextmanager
def try_pairing_lock():
    """Serialize pairing runs. Yields True if this caller holds the lock.

    Pairing is read-decide-write with no isolation, so concurrent requests all
    passed the "needs refresh?" check and each wrote a full set of rows —
    6 simultaneous requests produced 5 cycles and 5x the match rows. Callers
    that don't get the lock should skip: another request is already doing it,
    and queueing would only redo identical work.
    """
    # Deliberately NOT a pooled connection: the lock is held for the whole
    # pairing run, and the work inside needs pooled connections of its own.
    # Borrowing one here starved the pool and raised "connection pool
    # exhausted" under concurrent load.
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    acquired = False
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s) AS ok", (PAIRING_LOCK_KEY,))
            acquired = bool(cur.fetchone()["ok"])
        yield acquired
    finally:
        conn.close()  # closing releases the advisory lock with the session


def get_connection():
    """Standalone (unpooled) connection, for one-off scripts like seeding."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def init_db():
    with _cursor(commit=True) as cur:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            display_name TEXT NOT NULL,
            gender TEXT NOT NULL DEFAULT '女',
            wechat TEXT,
            instagram TEXT,
            xiaohongshu TEXT,
            linkedin TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            bio TEXT,
            match_preference TEXT,
            -- Stored as a date rather than an age so the number cannot go
            -- stale. 'straight' default keeps every pre-existing account in the
            -- opposite-gender pool it was already matched in.
            birth_date TEXT,
            orientation TEXT NOT NULL DEFAULT 'straight',
            seeking_gender TEXT,
            preferred_age_min INTEGER,
            preferred_age_max INTEGER,
            -- Set whenever a field that affects pool assignment or eligibility
            -- changes, so the pairing run can detect it the same way it detects
            -- a questionnaire retake.
            matching_profile_updated_at TEXT,
            photo_path TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS questionnaire_responses (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            version INTEGER NOT NULL,
            answers TEXT NOT NULL,
            match_preferences TEXT NOT NULL DEFAULT '{}',
            important_question_ids TEXT NOT NULL DEFAULT '[]',
            current_section INTEGER NOT NULL DEFAULT 1,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            status TEXT NOT NULL DEFAULT 'draft'
        );

        CREATE TABLE IF NOT EXISTS weekly_matches (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            matched_user_id INTEGER NOT NULL REFERENCES users(id),
            compatibility_summary TEXT NOT NULL,
            dimension_comparisons TEXT NOT NULL,
            recommendation_date TEXT NOT NULL,
            next_refresh_date TEXT NOT NULL,
            response_status TEXT NOT NULL DEFAULT 'unseen',
            -- Which pairing run produced this row. Without it, a user who was
            -- matched last run and left out of this one keeps being served the
            -- superseded row, because "latest row for this user" is not the same
            -- question as "this user's row in the current cycle".
            cycle_id INTEGER REFERENCES match_cycles(id),
            -- Words shared between this user's stated expectations and the
            -- match's bio. Frozen at pairing time because the scores are
            -- relative to the pool that was paired: recomputing later, against
            -- a different pool, would silently change what a past
            -- recommendation claimed.
            shared_interests TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dislikes (
            id SERIAL PRIMARY KEY,
            blocker_id INTEGER NOT NULL REFERENCES users(id),
            blocked_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            UNIQUE (blocker_id, blocked_id)
        );

        -- One row per pairing run. Needed because users who end up unmatched
        -- never get a weekly_matches row; without this the "does anyone need a
        -- refresh?" check stayed true forever and re-paired the whole pool on
        -- every request.
        CREATE TABLE IF NOT EXISTS match_cycles (
            id SERIAL PRIMARY KEY,
            generated_at TEXT NOT NULL,
            next_refresh_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS match_cycle_participants (
            cycle_id INTEGER NOT NULL REFERENCES match_cycles(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            PRIMARY KEY (cycle_id, user_id)
        );

        -- Photos live in the DB rather than on local disk: hosting platforms
        -- give containers an ephemeral filesystem, so uploads would silently
        -- disappear on every deploy or restart.
        CREATE TABLE IF NOT EXISTS user_photos (
            user_id INTEGER PRIMARY KEY REFERENCES users(id),
            content_type TEXT NOT NULL,
            data BYTEA NOT NULL,
            updated_at TEXT NOT NULL
        );

        ALTER TABLE questionnaire_responses
            ADD COLUMN IF NOT EXISTS match_preferences TEXT NOT NULL DEFAULT '{}';

        ALTER TABLE weekly_matches
            ADD COLUMN IF NOT EXISTS shared_interests TEXT NOT NULL DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS cycle_id INTEGER REFERENCES match_cycles(id);

        CREATE INDEX IF NOT EXISTS idx_matches_user_cycle
            ON weekly_matches(user_id, cycle_id);

        -- Backfill cycle_id for rows written before the column existed.
        -- record_match_cycle used the same timestamp for the cycle and its rows,
        -- so generated_at identifies them exactly. Without this every existing
        -- recommendation would stop being served the moment this deploys, since
        -- serving is now scoped to the current cycle.
        UPDATE weekly_matches w
           SET cycle_id = c.id
          FROM match_cycles c
         WHERE w.cycle_id IS NULL
           AND w.recommendation_date = c.generated_at;

        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS birth_date TEXT,
            ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'straight',
            ADD COLUMN IF NOT EXISTS seeking_gender TEXT,
            ADD COLUMN IF NOT EXISTS preferred_age_min INTEGER,
            ADD COLUMN IF NOT EXISTS preferred_age_max INTEGER,
            ADD COLUMN IF NOT EXISTS matching_profile_updated_at TEXT;

        CREATE INDEX IF NOT EXISTS idx_responses_user_status
            ON questionnaire_responses(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_matches_user
            ON weekly_matches(user_id, id DESC);
    """)


# ---------------------------------------------------------------- users ----

def create_user(email, password_hash, password_salt, display_name, gender, contacts, profile=None):
    """profile carries the optional matching fields (birth_date, orientation,
    seeking_gender, preferred_age_min/max). Omitting it leaves the column
    defaults, which put the account in the opposite-gender pool with no age
    preference — exactly how accounts behaved before these fields existed."""
    profile = profile or {}
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO users (email, password_hash, password_salt, display_name, gender,
                                   wechat, instagram, xiaohongshu, linkedin, status,
                                   birth_date, orientation, seeking_gender,
                                   preferred_age_min, preferred_age_max, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'active',
                       %s, COALESCE(%s, 'straight'), %s, %s, %s, %s)
               RETURNING id""",
            (
                email, password_hash, password_salt, display_name, gender,
                contacts.get("wechat"), contacts.get("instagram"),
                contacts.get("xiaohongshu"), contacts.get("linkedin"),
                profile.get("birth_date"), profile.get("orientation"),
                profile.get("seeking_gender"), profile.get("preferred_age_min"),
                profile.get("preferred_age_max"),
                now_iso(),
            ),
        )
        return cur.fetchone()["id"]


def get_user_by_email(email):
    with _cursor() as cur:
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id):
    with _cursor() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def update_user(user_id, fields):
    if not fields:
        return
    columns = ", ".join(f"{k} = %s" for k in fields)
    with _cursor(commit=True) as cur:
        cur.execute(f"UPDATE users SET {columns} WHERE id = %s", (*fields.values(), user_id))


def list_users_by_status(status):
    with _cursor() as cur:
        cur.execute("SELECT * FROM users WHERE status = %s", (status,))
        rows = cur.fetchall()
    return [dict(row) for row in rows]


# --------------------------------------------------- questionnaire_responses ----

def _row_to_questionnaire(row):
    if row is None:
        return None
    d = dict(row)
    d["answers"] = {int(k): v for k, v in json.loads(d["answers"]).items()}
    d["match_preferences"] = {int(k): v for k, v in json.loads(d.get("match_preferences") or "{}").items()}
    d["important_question_ids"] = json.loads(d["important_question_ids"])
    return d


def get_draft_response(user_id):
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM questionnaire_responses WHERE user_id = %s AND status = 'draft' ORDER BY id DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    return _row_to_questionnaire(row)


def get_current_response(user_id):
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM questionnaire_responses WHERE user_id = %s AND status = 'current' ORDER BY id DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    return _row_to_questionnaire(row)


def get_current_responses_for(user_ids):
    """Batched get_current_response — one query instead of one per user."""
    if not user_ids:
        return {}
    with _cursor() as cur:
        cur.execute(
            """SELECT DISTINCT ON (user_id) * FROM questionnaire_responses
               WHERE user_id = ANY(%s) AND status = 'current'
               ORDER BY user_id, id DESC""",
            (list(user_ids),),
        )
        rows = cur.fetchall()
    return {r["user_id"]: _row_to_questionnaire(r) for r in rows}


def get_archived_responses(user_id):
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM questionnaire_responses WHERE user_id = %s AND status = 'archived' ORDER BY completed_at DESC",
            (user_id,),
        )
        rows = cur.fetchall()
    return [_row_to_questionnaire(r) for r in rows]


def create_draft(user_id, version, answers=None, current_section=1, match_preferences=None):
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO questionnaire_responses (user_id, version, answers, match_preferences,
                                                      important_question_ids, current_section, started_at, status)
               VALUES (%s, %s, %s, %s, '[]', %s, %s, 'draft')
               RETURNING id""",
            (user_id, version, json.dumps(answers or {}),
             json.dumps({str(k): v for k, v in (match_preferences or {}).items()}),
             current_section, now_iso()),
        )
        draft_id = cur.fetchone()["id"]
    return get_response_by_id(draft_id)


def get_response_by_id(response_id):
    with _cursor() as cur:
        cur.execute("SELECT * FROM questionnaire_responses WHERE id = %s", (response_id,))
        row = cur.fetchone()
    return _row_to_questionnaire(row)


def save_draft_answers(response_id, answers, current_section, match_preferences=None):
    """Merge the incoming answers and per-question preferences into what's stored.

    Done as a single jsonb merge rather than read-modify-write in Python: one
    round trip instead of two, and no lost update if two autosaves overlap.
    """
    with _cursor(commit=True) as cur:
        cur.execute(
            """UPDATE questionnaire_responses
               SET answers = (answers::jsonb || %s::jsonb)::text,
                   match_preferences = (match_preferences::jsonb || %s::jsonb)::text,
                   current_section = %s
               WHERE id = %s""",
            (json.dumps({str(k): v for k, v in answers.items()}),
             json.dumps({str(k): v for k, v in (match_preferences or {}).items()}),
             current_section, response_id),
        )


def submit_response(response_id, important_question_ids, match_preferences=None):
    """Submit replaces match_preferences outright (rather than merging) so the
    final payload wins over a debounced autosave that may still be in flight."""
    with _cursor(commit=True) as cur:
        cur.execute(
            """UPDATE questionnaire_responses
               SET status = 'current', important_question_ids = %s,
                   match_preferences = %s, completed_at = %s
               WHERE id = %s""",
            (json.dumps(important_question_ids),
             json.dumps({str(k): v for k, v in (match_preferences or {}).items()}),
             now_iso(), response_id),
        )


def archive_response(response_id):
    with _cursor(commit=True) as cur:
        cur.execute("UPDATE questionnaire_responses SET status = 'archived' WHERE id = %s", (response_id,))


def get_questionnaire_status(user_id):
    """Single query for both 'current' and 'draft' — status derives from which exists."""
    with _cursor() as cur:
        cur.execute(
            """SELECT status FROM questionnaire_responses
               WHERE user_id = %s AND status IN ('current', 'draft')""",
            (user_id,),
        )
        statuses = {r["status"] for r in cur.fetchall()}
    if "current" in statuses:
        return "completed"
    if "draft" in statuses:
        return "in_progress"
    return "not_started"


# --------------------------------------------------------- weekly_matches ----

def get_latest_match(user_id, cycle_id=None):
    """This user's match row, optionally restricted to one pairing run.

    Pass cycle_id whenever the row is going to be shown to someone: without it
    this returns the newest row ever written for the user, which is a *different*
    pairing run's answer once a newer run left them unmatched.
    """
    with _cursor() as cur:
        if cycle_id is None:
            cur.execute(
                "SELECT * FROM weekly_matches WHERE user_id = %s ORDER BY id DESC LIMIT 1",
                (user_id,),
            )
        else:
            cur.execute(
                """SELECT * FROM weekly_matches WHERE user_id = %s AND cycle_id = %s
                   ORDER BY id DESC LIMIT 1""",
                (user_id, cycle_id),
            )
        row = cur.fetchone()
    return dict(row) if row else None


def get_latest_matches_for(user_ids, cycle_id=None):
    """Batched get_latest_match — one query instead of one per user."""
    if not user_ids:
        return {}
    with _cursor() as cur:
        if cycle_id is None:
            cur.execute(
                """SELECT DISTINCT ON (user_id) * FROM weekly_matches
                   WHERE user_id = ANY(%s)
                   ORDER BY user_id, id DESC""",
                (list(user_ids),),
            )
        else:
            cur.execute(
                """SELECT DISTINCT ON (user_id) * FROM weekly_matches
                   WHERE user_id = ANY(%s) AND cycle_id = %s
                   ORDER BY user_id, id DESC""",
                (list(user_ids), cycle_id),
            )
        rows = cur.fetchall()
    return {r["user_id"]: dict(r) for r in rows}


def create_weekly_match(user_id, matched_user_id, compatibility_summary, dimension_comparisons,
                         recommendation_date, next_refresh_date):
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO weekly_matches (user_id, matched_user_id, compatibility_summary,
                                            dimension_comparisons, recommendation_date, next_refresh_date, response_status)
               VALUES (%s, %s, %s, %s, %s, %s, 'unseen')""",
            (user_id, matched_user_id, compatibility_summary, json.dumps(dimension_comparisons),
             recommendation_date, next_refresh_date),
        )


def update_match_response_status(match_row_id, status):
    with _cursor(commit=True) as cur:
        cur.execute("UPDATE weekly_matches SET response_status = %s WHERE id = %s", (status, match_row_id))


# ------------------------------------------------------------ user photos ----

def save_user_photo(user_id, content_type, data):
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO user_photos (user_id, content_type, data, updated_at)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (user_id) DO UPDATE
                 SET content_type = EXCLUDED.content_type,
                     data = EXCLUDED.data,
                     updated_at = EXCLUDED.updated_at""",
            (user_id, content_type, psycopg2.Binary(data), now_iso()),
        )


def get_user_photo(user_id):
    with _cursor() as cur:
        cur.execute("SELECT content_type, data, updated_at FROM user_photos WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_photo_versions_for(user_ids):
    """updated_at per user, used to build cache-busting photo URLs."""
    if not user_ids:
        return {}
    with _cursor() as cur:
        cur.execute("SELECT user_id, updated_at FROM user_photos WHERE user_id = ANY(%s)", (list(user_ids),))
        return {r["user_id"]: r["updated_at"] for r in cur.fetchall()}


# ----------------------------------------------------------- match cycles ----

def get_active_cycle(now_iso_str):
    """The most recent pairing run that hasn't expired yet, if any."""
    with _cursor() as cur:
        cur.execute(
            """SELECT * FROM match_cycles
               WHERE next_refresh_date > %s
               ORDER BY id DESC LIMIT 1""",
            (now_iso_str,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_cycle_participants(cycle_id):
    with _cursor() as cur:
        cur.execute("SELECT user_id FROM match_cycle_participants WHERE cycle_id = %s", (cycle_id,))
        return {r["user_id"] for r in cur.fetchall()}


def get_partner_response_status(user_id, partner_id):
    """The partner's own status toward this user, for their side of the pair."""
    with _cursor() as cur:
        cur.execute(
            """SELECT response_status FROM weekly_matches
               WHERE user_id = %s AND matched_user_id = %s
               ORDER BY id DESC LIMIT 1""",
            (partner_id, user_id),
        )
        row = cur.fetchone()
    return row["response_status"] if row else None


def get_current_response_statuses():
    """Latest response_status per (user, matched_user), so a re-pair can carry
    over what someone already did with an unchanged recommendation."""
    with _cursor() as cur:
        cur.execute(
            """SELECT DISTINCT ON (user_id, matched_user_id)
                      user_id, matched_user_id, response_status
               FROM weekly_matches
               ORDER BY user_id, matched_user_id, id DESC"""
        )
        return {(r["user_id"], r["matched_user_id"]): r["response_status"] for r in cur.fetchall()}


def record_match_cycle(generated_at, next_refresh_date, participant_ids, match_rows):
    """Persist a whole pairing run atomically: the cycle, everyone who took
    part (matched or not), and the resulting match rows.

    match_rows carry their own response_status so a mid-cycle re-pair doesn't
    resurrect a recommendation the user already skipped."""
    with _transaction() as cur:
        cur.execute(
            "INSERT INTO match_cycles (generated_at, next_refresh_date) VALUES (%s, %s) RETURNING id",
            (generated_at, next_refresh_date),
        )
        cycle_id = cur.fetchone()["id"]
        if participant_ids:
            execute_values(
                cur,
                "INSERT INTO match_cycle_participants (cycle_id, user_id) VALUES %s",
                [(cycle_id, uid) for uid in participant_ids],
            )
        rows = list(match_rows)
        if rows:
            execute_values(
                cur,
                """INSERT INTO weekly_matches (user_id, matched_user_id, compatibility_summary,
                                                dimension_comparisons, recommendation_date, next_refresh_date,
                                                response_status, shared_interests, cycle_id)
                   VALUES %s""",
                [(u, m, summary, json.dumps(c), rd, nrd, st,
                  json.dumps(si, ensure_ascii=False), cycle_id)
                 for u, m, summary, c, rd, nrd, st, si in rows],
            )
        return cycle_id


def mark_match_viewed_if_unseen(match_row_id):
    with _cursor(commit=True) as cur:
        cur.execute(
            "UPDATE weekly_matches SET response_status = 'viewed' WHERE id = %s AND response_status = 'unseen'",
            (match_row_id,),
        )


# --------------------------------------------------------------- sessions ----

def create_session(token, user_id):
    with _cursor(commit=True) as cur:
        cur.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (%s, %s, %s)",
                    (token, user_id, now_iso()))


def get_session_user_id(token):
    with _cursor() as cur:
        cur.execute("SELECT user_id FROM sessions WHERE token = %s", (token,))
        row = cur.fetchone()
    return row["user_id"] if row else None


def delete_session(token):
    with _cursor(commit=True) as cur:
        cur.execute("DELETE FROM sessions WHERE token = %s", (token,))


# --------------------------------------------------------------- dislikes ----

def create_dislike(blocker_id, blocked_id):
    """Record that blocker_id never wants to see blocked_id again. Stored
    directionally (who initiated matters for safety/reporting), but read back
    symmetrically by get_dislike_pairs — see matching.build_exclusions."""
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO dislikes (blocker_id, blocked_id, created_at)
               VALUES (%s, %s, %s)
               ON CONFLICT (blocker_id, blocked_id) DO NOTHING""",
            (blocker_id, blocked_id, now_iso()),
        )


def get_dislike_pairs():
    """All (blocker_id, blocked_id) pairs, for building the exclusion map."""
    with _cursor() as cur:
        cur.execute("SELECT blocker_id, blocked_id FROM dislikes")
        rows = cur.fetchall()
    return [(r["blocker_id"], r["blocked_id"]) for r in rows]


def is_dislike_blocked(user_a_id, user_b_id):
    """True if either direction has blocked the other."""
    with _cursor() as cur:
        cur.execute(
            """SELECT 1 FROM dislikes
               WHERE (blocker_id = %s AND blocked_id = %s)
                  OR (blocker_id = %s AND blocked_id = %s)
               LIMIT 1""",
            (user_a_id, user_b_id, user_b_id, user_a_id),
        )
        row = cur.fetchone()
    return row is not None
