"""Tests for releasing contact details only on mutual interest.

The rule: a recommendation's email/wechat/instagram are sent only when BOTH
people said they were interested. One person's interest is not consent to hand
over the other person's wechat, so the fields are omitted from the payload
rather than hidden by the UI — a client cannot reveal what it never received.

Run: ./venv/bin/python test_contact_reveal.py
"""
import sys
import types

# --- stand-in for db, installed before main imports it ---------------------

fake_db = types.ModuleType("db")
STATE = {"partner_status": "unseen"}

USERS = {
    1: {"id": 1, "display_name": "我", "email": "me@example.com", "status": "active",
        "gender": "男", "seeking_gender": "女"},
    7: {"id": 7, "display_name": "对方", "email": "them@example.com", "wechat": "wx_them",
        "instagram": "@them", "status": "active", "gender": "女", "seeking_gender": "男"},
}

fake_db.init_db = lambda: None
fake_db.get_user_by_id = lambda uid: USERS.get(uid)
fake_db.get_user_photo = lambda uid: None
fake_db.get_partner_response_status = lambda a, b: STATE["partner_status"]
fake_db.get_questionnaire_status = lambda uid: "completed"
fake_db.get_current_response = lambda uid: {"id": 1}
fake_db.get_active_cycle = lambda now: {"id": 1, "generated_at": "x", "next_refresh_date": "z"}
fake_db.get_latest_match = lambda uid, cid=None: None
fake_db.get_cycle_participants = lambda cid: set()
fake_db.is_dislike_blocked = lambda a, b: False
fake_db.get_dislike_pairs = lambda: []
fake_db.list_users_by_status = lambda s: []
fake_db.get_current_responses_for = lambda ids: {}
fake_db.get_current_response_statuses = lambda: {}
fake_db.get_draft_response = lambda uid: None
fake_db.get_archived_responses = lambda uid: []
fake_db.record_match_cycle = lambda *a, **k: 1
fake_db.try_pairing_lock = lambda: iter(())
sys.modules["db"] = fake_db

import main  # noqa: E402

CONTACT_FIELDS = ("email", "wechat", "instagram")


def payload(my_status, partner_status):
    STATE["partner_status"] = partner_status
    return main.serialize_weekly_match({
        "id": 1, "cycle_id": 1, "user_id": 1, "matched_user_id": 7,
        "response_status": my_status,
        "compatibility_summary": "s", "dimension_comparisons": "[]",
        "recommendation_date": "2026-08-18T00:00:00+00:00",
        "next_refresh_date": "2026-08-23T00:00:00+00:00",
        "shared_interests": '["\\u722c\\u5c71"]',
    })


def has_contacts(out):
    return any(field in out["matchedUser"] for field in CONTACT_FIELDS)


# ------------------------------------------------------------------ tests ----

def test_both_interested_reveals_contacts():
    out = payload("interested", "interested")
    assert out["contactsRevealed"] is True
    assert out["matchedUser"]["email"] == "them@example.com"
    assert out["matchedUser"]["wechat"] == "wx_them"
    assert out["matchedUser"]["instagram"] == "@them"


def test_only_i_am_interested_hides_contacts():
    out = payload("interested", "unseen")
    assert out["contactsRevealed"] is False
    assert not has_contacts(out)


def test_only_they_are_interested_hides_contacts():
    out = payload("unseen", "interested")
    assert out["contactsRevealed"] is False
    assert not has_contacts(out)


def test_neither_interested_hides_contacts():
    for mine in ("unseen", "viewed"):
        for theirs in ("unseen", "viewed"):
            out = payload(mine, theirs)
            assert out["contactsRevealed"] is False, (mine, theirs)
            assert not has_contacts(out), (mine, theirs)


def test_i_skipped_hides_contacts_even_if_they_are_interested():
    # Skipping is a dismissal; it must not be rewarded with their details.
    out = payload("skipped", "interested")
    assert out["contactsRevealed"] is False
    assert not has_contacts(out)


def test_their_skip_is_still_not_disclosed():
    # A skip surfaces as "seen", never as a rejection — and it withholds
    # contacts without saying why.
    out = payload("interested", "skipped")
    assert out["partnerSignal"] == "seen"
    assert out["contactsRevealed"] is False
    assert not has_contacts(out)


def test_name_and_photo_are_always_present():
    # The gate is on contact details, not on the recommendation itself.
    for mine in ("unseen", "viewed", "interested"):
        out = payload(mine, "unseen")
        assert out["matchedUser"]["displayName"] == "对方"
        assert "photoUrl" in out["matchedUser"]


def test_shared_interests_survive_without_mutual_interest():
    # Shared words are derived from text both people chose to publish, so they
    # are not gated; only contact details are.
    out = payload("viewed", "unseen")
    assert out["sharedInterests"] == ["爬山"]


def test_skipping_still_hides_shared_interests():
    out = payload("skipped", "unseen")
    assert out["sharedInterests"] == []


def test_a_partner_without_optional_contacts_still_reveals_email():
    saved = USERS[7].copy()
    USERS[7].pop("wechat"), USERS[7].pop("instagram")
    try:
        out = payload("interested", "interested")
        assert out["contactsRevealed"] is True
        assert out["matchedUser"]["email"] == "them@example.com"
        assert out["matchedUser"]["wechat"] is None
    finally:
        USERS[7] = saved


if __name__ == "__main__":
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
