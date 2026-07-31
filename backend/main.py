from datetime import datetime, timezone
import json
import os
from typing import Optional, Literal
from urllib.parse import quote

from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

import auth
import db
import matching
from questionnaire_config import ALL_QUESTION_IDS

ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024
_UNSET = object()

db.init_db()

app = FastAPI(title="Common Ground API")

# Browsers block credentialed cross-origin requests to "*", and once this is
# deployed the frontend sits on a different domain than the API. Set
# CORS_ORIGINS to a comma-separated list of frontend URLs in production;
# defaults to the local Vite dev server.
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Liveness probe for the hosting platform."""
    return {"ok": True}


# ============================================================ serializers ==

def _photo_url(user_id, version):
    """Version the URL so a replaced photo isn't masked by a cached old one."""
    if not version:
        return None
    return f"/api/photos/{user_id}?v={quote(version)}"


def serialize_user(user_row, photo_version=_UNSET):
    user_id = user_row["id"]
    if photo_version is _UNSET:
        photo = db.get_user_photo(user_id)
        photo_version = photo["updated_at"] if photo else None
    return {
        "id": str(user_id),
        "displayName": user_row["display_name"],
        "email": user_row["email"],
        "gender": user_row["gender"],
        "wechat": user_row.get("wechat"),
        "instagram": user_row.get("instagram"),
        "xiaohongshu": user_row.get("xiaohongshu"),
        "linkedin": user_row.get("linkedin"),
        "status": user_row["status"],
        "questionnaireStatus": db.get_questionnaire_status(user_id),
        "createdAt": user_row["created_at"],
        "photoUrl": _photo_url(user_id, photo_version),
        "bio": user_row.get("bio"),
        "matchPreference": user_row.get("match_preference"),
    }


def serialize_questionnaire(q):
    if q is None:
        return None
    return {
        "id": str(q["id"]),
        "version": q["version"],
        "answers": q["answers"],
        "matchPreferences": q["match_preferences"],
        "importantQuestionIds": q["important_question_ids"],
        "startedAt": q["started_at"],
        "completedAt": q["completed_at"],
        "status": q["status"],
        "currentSection": q["current_section"],
    }


def serialize_weekly_match(match_row):
    matched_id = match_row["matched_user_id"]
    matched_user = db.get_user_by_id(matched_id)
    photo = db.get_user_photo(matched_id)
    # A skipped match stays visible so the dashboard can say who was skipped,
    # but the contact details go away — the user dismissed this person, and
    # contacts are only meant to be exposed for an active recommendation.
    skipped = match_row["response_status"] == "skipped"
    matched = {
        "displayName": matched_user["display_name"],
        "photoUrl": _photo_url(matched_id, photo["updated_at"] if photo else None),
    }
    if not skipped:
        matched.update({
            "email": matched_user["email"],
            "wechat": matched_user.get("wechat"),
            "instagram": matched_user.get("instagram"),
        })
    return {
        "id": str(match_row["id"]),
        "matchedUser": matched,
        "compatibilitySummary": match_row["compatibility_summary"],
        "dimensionComparisons": json.loads(match_row["dimension_comparisons"]),
        "recommendationDate": match_row["recommendation_date"][:10],
        "nextRefreshDate": match_row["next_refresh_date"][:10],
        "responseStatus": match_row["response_status"],
    }


# ================================================================ auth dep ==

def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.removeprefix("Bearer ")
    user_id = db.get_session_user_id(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    user = db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


# ===================================================== weekly match cycle ==

def maybe_regenerate_weekly_matches():
    """Lazy weekly refresh: when the current pairing cycle has expired (or a
    newly-eligible user isn't part of it), re-run matching for the WHOLE
    eligible pool at once and open a new cycle. The pool therefore converges
    onto one shared weekly cadence rather than per-user 7-day timers.

    Runs on nearly every request, so reads are batched — doing them per-user
    turned a single login into ~29 round trips to a remote DB.
    """
    now = datetime.now(timezone.utc)
    now_str = now.isoformat()

    active_users = db.list_users_by_status("active")
    responses = db.get_current_responses_for([u["id"] for u in active_users])
    eligible = []
    for u in active_users:
        q = responses.get(u["id"])
        if q:
            eligible.append({
                "id": u["id"],
                "gender": u["gender"],
                "answers": q["answers"],
                "match_preferences": q["match_preferences"],
                "important_question_ids": q["important_question_ids"],
            })
    if len(eligible) < 2:
        return

    # Track cycles explicitly rather than inferring from weekly_matches rows:
    # unmatched users never get a row, so "is anyone missing a match?" was
    # always true and re-paired the entire pool on every single request.
    eligible_ids = {u["id"] for u in eligible}
    cycle = db.get_active_cycle(now_str)
    if cycle is not None and eligible_ids <= db.get_cycle_participants(cycle["id"]):
        return

    assignments = matching.gale_shapley_matching(eligible, matching.build_exclusions(db.get_dislike_pairs()))
    next_refresh_date = matching.next_refresh_from(now).isoformat()
    answers_by_id = {u["id"]: u["answers"] for u in eligible}

    rows = []
    for a_id, b_id, _score in assignments:
        comparisons_a, summary_a = matching.build_match_payload(answers_by_id[a_id], answers_by_id[b_id])
        rows.append((a_id, b_id, summary_a, comparisons_a, now_str, next_refresh_date))
        comparisons_b, summary_b = matching.build_match_payload(answers_by_id[b_id], answers_by_id[a_id])
        rows.append((b_id, a_id, summary_b, comparisons_b, now_str, next_refresh_date))
    db.record_match_cycle(now_str, next_refresh_date, eligible_ids, rows)


def get_fresh_match_for(user_id):
    if not db.get_current_response(user_id):
        # No completed questionnaire right now (e.g. mid-retake) — any
        # leftover weekly_matches row from before is stale, ignore it.
        return None
    maybe_regenerate_weekly_matches()
    match_row = db.get_latest_match(user_id)
    if match_row is None:
        return None
    now = datetime.now(timezone.utc)
    if datetime.fromisoformat(match_row["next_refresh_date"]) <= now:
        return None
    # A dislike recorded *after* this week's pairing was generated leaves the
    # old row in place, so filter here too — not just at generation time.
    if db.is_dislike_blocked(user_id, match_row["matched_user_id"]):
        return None
    # Same for someone pausing after being paired: we promise a paused user
    # won't appear in anyone's recommendations, and this row exposes their
    # contact details, so it has to stop being served.
    partner = db.get_user_by_id(match_row["matched_user_id"])
    if partner is None or partner["status"] != "active":
        return None
    return match_row


# =================================================================== auth ==

class ContactFields(BaseModel):
    wechat: Optional[str] = None
    instagram: Optional[str] = None
    xiaohongshu: Optional[str] = None
    linkedin: Optional[str] = None


class RegisterBody(ContactFields):
    email: EmailStr
    password: str
    gender: Literal["男", "女"]


class LoginBody(BaseModel):
    email: EmailStr
    password: str


def get_match_state(user_id):
    """Why the user has no match, so the UI can say something true.

    'unmatched' means this week's pairing ran and left them out (the pool is
    lopsided, so min(男,女) pairs leaves the larger side over) — different from
    'pending', where no pairing has covered them yet.
    """
    now = datetime.now(timezone.utc)
    cycle = db.get_active_cycle(now.isoformat())
    if cycle is None:
        return {"state": "pending", "nextRefreshDate": None}
    if user_id not in db.get_cycle_participants(cycle["id"]):
        return {"state": "pending", "nextRefreshDate": cycle["next_refresh_date"][:10]}
    return {"state": "unmatched", "nextRefreshDate": cycle["next_refresh_date"][:10]}


def _bootstrap_payload(user_row):
    user_id = user_row["id"]
    questionnaire = db.get_current_response(user_id) or db.get_draft_response(user_id)
    archived = db.get_archived_responses(user_id)
    match_row = get_fresh_match_for(user_id) if user_row["status"] == "active" else None
    payload = {
        "user": serialize_user(user_row),
        "questionnaire": serialize_questionnaire(questionnaire),
        "archivedQuestionnaires": [serialize_questionnaire(q) for q in archived],
        "weeklyMatch": serialize_weekly_match(match_row) if match_row else None,
    }
    if match_row is None and user_row["status"] == "active" and questionnaire and questionnaire["status"] == "current":
        payload["matchState"] = get_match_state(user_id)
    return payload


@app.post("/api/register")
def register(body: RegisterBody):
    if db.get_user_by_email(body.email):
        raise HTTPException(status_code=400, detail="该邮箱已注册")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少需要8位")
    password_hash, salt = auth.hash_password(body.password)
    display_name = body.email.split("@")[0]
    user_id = db.create_user(body.email, password_hash, salt, display_name, body.gender, body.model_dump())
    token = auth.new_session_token()
    db.create_session(token, user_id)
    payload = _bootstrap_payload(db.get_user_by_id(user_id))
    return {"token": token, **payload}


@app.post("/api/login")
def login(body: LoginBody):
    user = db.get_user_by_email(body.email)
    if not user or not auth.verify_password(body.password, user["password_salt"], user["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    token = auth.new_session_token()
    db.create_session(token, user["id"])
    payload = _bootstrap_payload(user)
    return {"token": token, **payload}


@app.post("/api/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        db.delete_session(authorization.removeprefix("Bearer "))
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(get_current_user)):
    return _bootstrap_payload(user)


# =================================================================== user ==

class UpdateMeBody(BaseModel):
    status: Optional[str] = None
    bio: Optional[str] = None
    matchPreference: Optional[str] = None


@app.patch("/api/me")
def update_me(body: UpdateMeBody, user=Depends(get_current_user)):
    fields = {}
    if body.status is not None:
        if body.status not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="status 必须是 active 或 inactive")
        fields["status"] = body.status
    if body.bio is not None:
        fields["bio"] = body.bio
    if body.matchPreference is not None:
        fields["match_preference"] = body.matchPreference
    db.update_user(user["id"], fields)
    if fields.get("status") == "active":
        maybe_regenerate_weekly_matches()
    return serialize_user(db.get_user_by_id(user["id"]))


@app.post("/api/me/photo")
def upload_photo(file: UploadFile = File(...), user=Depends(get_current_user)):
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="只支持 JPEG / PNG / WebP 图片")
    data = file.file.read(MAX_PHOTO_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="图片不能超过 5 MB")
    db.save_user_photo(user["id"], file.content_type, data)
    return serialize_user(db.get_user_by_id(user["id"]))


@app.get("/api/photos/{user_id}")
def get_photo(user_id: int):
    photo = db.get_user_photo(user_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="没有照片")
    return Response(
        content=bytes(photo["data"]),
        media_type=photo["content_type"],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ========================================================== questionnaire ==

MatchPreferenceValue = Literal["any", "same", "different"]


class SaveAnswersBody(BaseModel):
    answers: dict[int, int]
    matchPreferences: dict[int, MatchPreferenceValue] = {}
    currentSection: int


class SubmitBody(BaseModel):
    importantQuestionIds: list[int]
    matchPreferences: dict[int, MatchPreferenceValue] = {}


def normalize_match_preferences(preferences, answers):
    """Keep only meaningful constraints.

    A question the user answered neutrally (4) can't express "same side as me",
    so it's stored as "any" rather than being enforced later — this is also why
    the value is normalized on write instead of at match time, so what's stored
    is what actually gets applied. Unknown question ids are dropped.
    """
    normalized = {}
    for qid, preference in (preferences or {}).items():
        if qid not in ALL_QUESTION_IDS:
            continue
        answer = (answers or {}).get(qid)
        if preference in ("same", "different") and answer is not None and answer != matching.NEUTRAL_ANSWER:
            normalized[qid] = preference
        else:
            normalized[qid] = "any"
    return normalized


def _start_new_draft(user_id):
    """Archive any existing 'current' result and open a fresh draft. Matches
    the reference frontend's retakeQuestionnaire(), which archives the old
    result immediately when a retake starts — NOT deferred until the new one
    is submitted (that's what the design brief's prose says, but the actual
    shipped App.tsx code archives right away; we follow the code)."""
    current = db.get_current_response(user_id)
    if current:
        db.archive_response(current["id"])
    version = (current["version"] + 1) if current else 1
    return db.create_draft(user_id, version)


@app.put("/api/questionnaire")
def save_answers(body: SaveAnswersBody, user=Depends(get_current_user)):
    draft = db.get_draft_response(user["id"])
    if draft is None:
        draft = _start_new_draft(user["id"])
    merged_answers = {**draft["answers"], **body.answers}
    preferences = normalize_match_preferences(body.matchPreferences, merged_answers)
    db.save_draft_answers(draft["id"], body.answers, body.currentSection, preferences)
    return serialize_questionnaire(db.get_response_by_id(draft["id"]))


@app.post("/api/questionnaire/submit")
def submit_questionnaire(body: SubmitBody, user=Depends(get_current_user)):
    draft = db.get_draft_response(user["id"])
    if draft is None:
        raise HTTPException(status_code=400, detail="没有进行中的问卷草稿")
    unanswered = [qid for qid in ALL_QUESTION_IDS if qid not in draft["answers"]]
    if unanswered:
        raise HTTPException(status_code=400, detail=f"还有 {len(unanswered)} 题未完成")
    if not (3 <= len(body.importantQuestionIds) <= 5):
        raise HTTPException(status_code=400, detail="请选择 3-5 个最重要的维度")

    # Submit carries the authoritative preferences; fall back to the draft's
    # stored values if the client omitted them.
    preferences = normalize_match_preferences(
        body.matchPreferences or draft["match_preferences"], draft["answers"]
    )
    db.submit_response(draft["id"], body.importantQuestionIds, preferences)
    maybe_regenerate_weekly_matches()
    return serialize_questionnaire(db.get_response_by_id(draft["id"]))


@app.post("/api/questionnaire/retake")
def retake_questionnaire(user=Depends(get_current_user)):
    existing_draft = db.get_draft_response(user["id"])
    if existing_draft:
        return serialize_questionnaire(existing_draft)
    draft = _start_new_draft(user["id"])
    return serialize_questionnaire(draft)


@app.get("/api/questionnaire/archive")
def questionnaire_archive(user=Depends(get_current_user)):
    return [serialize_questionnaire(q) for q in db.get_archived_responses(user["id"])]


# =================================================================== match ==

class MatchResponseBody(BaseModel):
    status: str


@app.get("/api/match/current")
def match_current(user=Depends(get_current_user)):
    if user["status"] != "active":
        return None
    match_row = get_fresh_match_for(user["id"])
    if match_row is None:
        # Not just null: the UI needs to distinguish "left out of this week's
        # pairing" from "no pairing has run yet".
        if db.get_current_response(user["id"]):
            return {"match": None, **get_match_state(user["id"])}
        return None
    if match_row["response_status"] == "unseen":
        db.mark_match_viewed_if_unseen(match_row["id"])
        match_row["response_status"] = "viewed"
    return serialize_weekly_match(match_row)


@app.post("/api/match/response")
def match_response(body: MatchResponseBody, user=Depends(get_current_user)):
    if body.status not in ("interested", "skipped", "viewed", "unseen"):
        raise HTTPException(status_code=400, detail="非法的状态值")
    # Go through get_fresh_match_for so an expired/blocked/paused match can't be
    # acted on — serializing it back would leak the other person's contacts.
    match_row = get_fresh_match_for(user["id"])
    if match_row is None:
        raise HTTPException(status_code=404, detail="没有当前推荐")
    db.update_match_response_status(match_row["id"], body.status)
    match_row["response_status"] = body.status
    return serialize_weekly_match(match_row)


@app.post("/api/match/dislike")
def match_dislike(user=Depends(get_current_user)):
    """Permanently exclude the current recommendation from both users' pools.

    Distinct from response_status='skipped', which only means "not this week".
    """
    match_row = get_fresh_match_for(user["id"])
    if match_row is None:
        raise HTTPException(status_code=404, detail="没有当前推荐")
    db.create_dislike(user["id"], match_row["matched_user_id"])
    db.update_match_response_status(match_row["id"], "skipped")
    return {"ok": True}
