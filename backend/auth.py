import hashlib
import secrets

PBKDF2_ITERATIONS = 200_000


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return digest.hex(), salt


def verify_password(password, salt, expected_hash):
    digest, _ = hash_password(password, salt)
    return secrets.compare_digest(digest, expected_hash)


def new_session_token():
    return secrets.token_urlsafe(32)
