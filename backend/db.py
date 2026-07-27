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
        _pool = pg_pool.ThreadedConnectionPool(
            1, 8, DATABASE_URL, cursor_factory=RealDictCursor
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
            photo_path TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS questionnaire_responses (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            version INTEGER NOT NULL,
            answers TEXT NOT NULL,
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
            response_status TEXT NOT NULL DEFAULT 'unseen'
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

        CREATE INDEX IF NOT EXISTS idx_responses_user_status
            ON questionnaire_responses(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_matches_user
            ON weekly_matches(user_id, id DESC);
    """)


# ---------------------------------------------------------------- users ----

def create_user(email, password_hash, password_salt, display_name, gender, contacts):
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO users (email, password_hash, password_salt, display_name, gender,
                                   wechat, instagram, xiaohongshu, linkedin, status, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'active', %s)
               RETURNING id""",
            (
                email, password_hash, password_salt, display_name, gender,
                contacts.get("wechat"), contacts.get("instagram"),
                contacts.get("xiaohongshu"), contacts.get("linkedin"),
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


def create_draft(user_id, version, answers=None, current_section=1):
    with _cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO questionnaire_responses (user_id, version, answers, important_question_ids,
                                                      current_section, started_at, status)
               VALUES (%s, %s, %s, '[]', %s, %s, 'draft')
               RETURNING id""",
            (user_id, version, json.dumps(answers or {}), current_section, now_iso()),
        )
        draft_id = cur.fetchone()["id"]
    return get_response_by_id(draft_id)


def get_response_by_id(response_id):
    with _cursor() as cur:
        cur.execute("SELECT * FROM questionnaire_responses WHERE id = %s", (response_id,))
        row = cur.fetchone()
    return _row_to_questionnaire(row)


def save_draft_answers(response_id, answers, current_section):
    """Merge the incoming answers into whatever is already stored.

    Done as a single jsonb merge rather than read-modify-write in Python: one
    round trip instead of two, and no lost update if two autosaves overlap.
    """
    with _cursor(commit=True) as cur:
        cur.execute(
            """UPDATE questionnaire_responses
               SET answers = (answers::jsonb || %s::jsonb)::text,
                   current_section = %s
               WHERE id = %s""",
            (json.dumps({str(k): v for k, v in answers.items()}), current_section, response_id),
        )


def submit_response(response_id, important_question_ids):
    with _cursor(commit=True) as cur:
        cur.execute(
            """UPDATE questionnaire_responses
               SET status = 'current', important_question_ids = %s, completed_at = %s
               WHERE id = %s""",
            (json.dumps(important_question_ids), now_iso(), response_id),
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

def get_latest_match(user_id):
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM weekly_matches WHERE user_id = %s ORDER BY id DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_latest_matches_for(user_ids):
    """Batched get_latest_match — one query instead of one per user."""
    if not user_ids:
        return {}
    with _cursor() as cur:
        cur.execute(
            """SELECT DISTINCT ON (user_id) * FROM weekly_matches
               WHERE user_id = ANY(%s)
               ORDER BY user_id, id DESC""",
            (list(user_ids),),
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


def record_match_cycle(generated_at, next_refresh_date, participant_ids, match_rows):
    """Persist a whole pairing run atomically: the cycle, everyone who took
    part (matched or not), and the resulting match rows."""
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
                                                dimension_comparisons, recommendation_date, next_refresh_date, response_status)
                   VALUES %s""",
                [(u, m, s, json.dumps(c), rd, nrd, "unseen") for u, m, s, c, rd, nrd in rows],
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
