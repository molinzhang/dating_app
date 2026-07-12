import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "dating_app.db"
NUM_QUESTIONS = 10


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    survey_columns = ", ".join(f"q{i} INTEGER NOT NULL" for i in range(1, NUM_QUESTIONS + 1))
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            school TEXT NOT NULL,
            age INTEGER NOT NULL,
            gender TEXT NOT NULL,
            interested_in TEXT NOT NULL,
            bio TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS survey_responses (
            user_id INTEGER PRIMARY KEY REFERENCES users(id),
            {survey_columns}
        );
    """)
    conn.commit()
    conn.close()


def email_exists(email):
    conn = get_connection()
    row = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return row is not None


def create_user(profile, answers):
    conn = get_connection()
    cur = conn.execute(
        """INSERT INTO users (name, email, school, age, gender, interested_in, bio)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            profile["name"],
            profile["email"],
            profile["school"],
            profile["age"],
            profile["gender"],
            profile["interested_in"],
            profile["bio"],
        ),
    )
    user_id = cur.lastrowid
    cols = ", ".join(f"q{i}" for i in range(1, NUM_QUESTIONS + 1))
    placeholders = ", ".join("?" for _ in range(NUM_QUESTIONS))
    conn.execute(
        f"INSERT INTO survey_responses (user_id, {cols}) VALUES (?, {placeholders})",
        (user_id, *answers),
    )
    conn.commit()
    conn.close()
    return user_id


def fetch_all_users():
    conn = get_connection()
    rows = conn.execute(
        """SELECT u.*, s.* FROM users u
           JOIN survey_responses s ON s.user_id = u.id
           ORDER BY u.id"""
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def fetch_user_by_id(user_id):
    conn = get_connection()
    row = conn.execute(
        """SELECT u.*, s.* FROM users u
           JOIN survey_responses s ON s.user_id = u.id
           WHERE u.id = ?""",
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None
