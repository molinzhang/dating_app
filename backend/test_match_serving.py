"""Tests for serving a match only from the current pairing run.

The bug these pin down: `weekly_matches` had no cycle_id, and the row was fetched
as "the newest row for this user". Once a later run left someone unmatched it
wrote no row for them, so the query kept returning the previous run's answer —
including, in the case that surfaced this, a partner who violated the age range
the user had since set.

These use a fake db module rather than Postgres, so they run anywhere.

Run: ./venv/bin/python test_match_serving.py
"""
import sys
import types
from datetime import datetime, timedelta, timezone

NOW = datetime(2026, 8, 17, 12, 0, tzinfo=timezone.utc)
LATER = (NOW + timedelta(days=6)).isoformat()

# --- a stand-in for db, installed before main imports it -------------------

fake_db = types.ModuleType("db")
STATE = {}


def _reset(**over):
    STATE.clear()
    STATE.update({
        "current_response": {1: {"id": 9}},
        "active_cycle": {"id": 2, "generated_at": NOW.isoformat(), "next_refresh_date": LATER},
        # cycle_id -> row
        "matches": {},
        "users": {
            1: {"id": 1, "status": "active", "gender": "男", "seeking_gender": "女"},
            7: {"id": 7, "status": "active", "gender": "女", "seeking_gender": "男"},
        },
        "dislike_blocked": False,
    })
    STATE.update(over)


fake_db.init_db = lambda: None
fake_db.get_current_response = lambda uid: STATE["current_response"].get(uid)
fake_db.get_active_cycle = lambda now_str: STATE["active_cycle"]
fake_db.get_user_by_id = lambda uid: STATE["users"].get(uid)
fake_db.is_dislike_blocked = lambda a, b: STATE["dislike_blocked"]
fake_db.get_cycle_participants = lambda cid: {1, 7}
fake_db.get_partner_response_status = lambda a, b: "unseen"
fake_db.get_user_photo = lambda uid: None
fake_db.get_questionnaire_status = lambda uid: "completed"
fake_db.get_dislike_pairs = lambda: []
fake_db.list_users_by_status = lambda s: []
fake_db.get_current_responses_for = lambda ids: {}
fake_db.get_current_response_statuses = lambda: {}
fake_db.get_draft_response = lambda uid: None
fake_db.get_archived_responses = lambda uid: []
fake_db.record_match_cycle = lambda *a, **k: 3
fake_db.try_pairing_lock = lambda: iter(())


def _get_latest_match(user_id, cycle_id=None):
    rows = [r for r in STATE["matches"].values() if r["user_id"] == user_id]
    if cycle_id is not None:
        rows = [r for r in rows if r["cycle_id"] == cycle_id]
    return max(rows, key=lambda r: r["id"], default=None)


fake_db.get_latest_match = _get_latest_match
sys.modules["db"] = fake_db

import main  # noqa: E402


def row(row_id, cycle_id, user_id=1, partner_id=7, status="unseen", refresh=LATER):
    return {
        "id": row_id, "cycle_id": cycle_id, "user_id": user_id,
        "matched_user_id": partner_id, "response_status": status,
        "compatibility_summary": "s", "dimension_comparisons": "[]",
        "recommendation_date": NOW.isoformat(), "next_refresh_date": refresh,
        "shared_interests": "[]",
    }


# ------------------------------------------------------------------ tests ----

def test_serves_the_current_cycles_match():
    _reset()
    STATE["matches"] = {1: row(1, cycle_id=2)}
    assert main.get_fresh_match_for(1)["id"] == 1


def test_does_not_serve_a_previous_cycles_match():
    # The reported bug: paired in cycle 1, left unmatched by cycle 2, and still
    # shown cycle 1's partner.
    _reset()
    STATE["matches"] = {1: row(1, cycle_id=1)}
    assert main.get_fresh_match_for(1) is None


def test_prefers_the_current_cycle_when_both_exist():
    _reset()
    STATE["matches"] = {1: row(1, cycle_id=1, partner_id=7), 2: row(2, cycle_id=2, partner_id=7)}
    assert main.get_fresh_match_for(1)["id"] == 2


def test_no_active_cycle_means_no_match():
    _reset(active_cycle=None)
    STATE["matches"] = {1: row(1, cycle_id=1)}
    assert main.get_fresh_match_for(1) is None


def test_expired_row_is_still_filtered():
    _reset()
    past = (NOW - timedelta(days=1)).isoformat()
    STATE["matches"] = {1: row(1, cycle_id=2, refresh=past)}
    assert main.get_fresh_match_for(1) is None


def test_missing_questionnaire_means_no_match():
    _reset(current_response={})
    STATE["matches"] = {1: row(1, cycle_id=2)}
    assert main.get_fresh_match_for(1) is None


def test_dislike_still_filtered():
    _reset(dislike_blocked=True)
    STATE["matches"] = {1: row(1, cycle_id=2)}
    assert main.get_fresh_match_for(1) is None


def test_paused_partner_still_filtered():
    _reset()
    STATE["users"][7]["status"] = "inactive"
    STATE["matches"] = {1: row(1, cycle_id=2)}
    assert main.get_fresh_match_for(1) is None


def test_cross_pool_partner_still_filtered():
    # Partner now seeks their own gender, so the pair crosses a pool boundary.
    _reset()
    STATE["users"][7]["seeking_gender"] = "女"
    STATE["matches"] = {1: row(1, cycle_id=2)}
    assert main.get_fresh_match_for(1) is None


def test_serving_a_match_never_pairs():
    # Pairing on the request path is what let a profile edit reshuffle everyone
    # mid-week; nothing in the read path may trigger it.
    _reset()
    STATE["matches"] = {1: row(1, cycle_id=2)}
    called = []
    original = main.run_pairing
    main.run_pairing = lambda *a, **k: called.append(1)
    try:
        main.get_fresh_match_for(1)
        main.get_match_state(1)
    finally:
        main.run_pairing = original
    assert called == []


def test_api_module_has_no_automatic_pairing_left():
    import inspect
    source = inspect.getsource(main)
    # run_pairing must appear only as its definition and in the admin endpoint.
    calls = [line.strip() for line in source.splitlines()
             if "run_pairing(" in line and "def run_pairing" not in line]
    assert calls == ["return run_pairing(force=force)"], calls


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
