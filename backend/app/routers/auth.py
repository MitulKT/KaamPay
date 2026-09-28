"""Mobile + OTP login, company sign-up, refresh, me."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException

from ..audit import audit
from ..config import settings
from ..db import get_db
from ..otp import get_provider, hash_otp
from ..schemas import DEFAULT_SETTINGS, CompanySignup, OTPRequest, OTPVerify, RefreshIn, UserPatch
from ..security import ADMIN, SUPERVISOR, current_user, decode, load_user, make_token
from ..utils import new_id, now, out

router = APIRouter(prefix="/auth", tags=["auth"])


def public_user(u: dict) -> dict:
    d = out(u)
    d.pop("session_version", None)
    return d


def token_pair(user: dict, company: dict | None) -> dict:
    return {
        "access_token": make_token(user, "access"),
        "refresh_token": make_token(user, "refresh"),
        "user": public_user(user),
        "company": out(company),
    }


@router.post("/otp/request")
async def request_otp(body: OTPRequest):
    db = get_db()
    since = now() - timedelta(hours=1)
    recent = await db.otp_requests.count_documents({"mobile": body.mobile, "created_at": {"$gte": since}})
    if recent >= settings.otp_max_per_hour:
        raise HTTPException(429, "Too many OTP requests. Try again after some time.")
    provider = get_provider()
    code = provider.generate(body.mobile)
    await db.otp_requests.insert_one({
        "_id": new_id(), "mobile": body.mobile, "otp_hash": hash_otp(body.mobile, code),
        "expires_at": now() + timedelta(minutes=settings.otp_valid_minutes), "attempts": 0,
        "used": False, "created_at": now(),
    })
    await provider.send(body.mobile, code)
    registered = await db.users.count_documents({"mobile": body.mobile, "is_active": True}) > 0
    return {"sent": True, "registered": registered, "resend_after_seconds": 30}


async def check_otp(mobile: str, code: str) -> None:
    db = get_db()
    req = await db.otp_requests.find_one({"mobile": mobile, "used": False}, sort=[("created_at", -1)])
    if not req or req["expires_at"] < now():
        raise HTTPException(400, "OTP expired. Please request a new one.")
    if req["attempts"] >= settings.otp_max_attempts:
        raise HTTPException(429, "Too many wrong attempts. Request a new OTP.")
    if req["otp_hash"] != hash_otp(mobile, str(code).strip()):
        await db.otp_requests.update_one({"_id": req["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Wrong OTP")
    await db.otp_requests.update_one({"_id": req["_id"]}, {"$set": {"used": True}})


@router.post("/otp/verify")
async def verify_otp(body: OTPVerify):
    db = get_db()
    q = {"mobile": body.mobile, "is_active": True}
    if body.company_id:
        q["company_id"] = body.company_id
    users = [u async for u in db.users.find(q)]
    if not users:
        # still burn the OTP check so the endpoint can't be used to probe numbers cheaply
        await check_otp(body.mobile, body.code)
        raise HTTPException(404, "Number not registered. Contact your supervisor.")
    await check_otp(body.mobile, body.code)
    if len(users) > 1:
        companies = [out(c) async for c in db.companies.find({"_id": {"$in": [u["company_id"] for u in users]}})]
        # Re-issue a one-time OTP pass so the app can call verify again with company_id without a new SMS.
        provider_code = new_id()[:6]
        await db.otp_requests.insert_one({
            "_id": new_id(), "mobile": body.mobile, "otp_hash": hash_otp(body.mobile, provider_code),
            "expires_at": now() + timedelta(minutes=2), "attempts": 0, "used": False, "created_at": now(),
        })
        return {"choose_company": [{"id": c["id"], "name": c["name"]} for c in companies], "code": provider_code}
    user = users[0]
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now()}})
    company = await db.companies.find_one({"_id": user["company_id"]})
    return token_pair(user, company)


@router.post("/signup")
async def signup(body: CompanySignup):
    """Owner creates a company. Owner = ADMIN + SUPERVISOR."""
    db = get_db()
    await check_otp(body.mobile, body.code)
    cid = new_id()
    company = {"_id": cid, "name": body.company_name, "gstin": "", "address": "", "logo_url": None,
               "settings": dict(DEFAULT_SETTINGS), "created_at": now()}
    await db.companies.insert_one(company)
    user = {"_id": new_id(), "company_id": cid, "name": body.owner_name, "name_local": "", "mobile": body.mobile,
            "roles": [ADMIN, SUPERVISOR], "preferred_language": "en", "is_active": True, "session_version": 0,
            "created_at": now(), "last_login_at": now()}
    await db.users.insert_one(user)
    await audit(db, user, "company", cid, "CREATE", new={"name": body.company_name})
    return token_pair(user, company)


@router.post("/refresh")
async def refresh(body: RefreshIn):
    user = await load_user(decode(body.refresh_token, "refresh"))
    company = await get_db().companies.find_one({"_id": user["company_id"]})
    return token_pair(user, company)


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    db = get_db()
    company = await db.companies.find_one({"_id": user["company_id"]})
    profile = await db.worker_profiles.find_one({"user_id": user["_id"]})
    return {"user": public_user(user), "company": out(company), "worker_profile": out(profile)}


@router.patch("/me")
async def update_me(body: UserPatch, user: dict = Depends(current_user)):
    """Self-service: only language, photo and push token."""
    allowed = {k: v for k, v in body.model_dump(exclude_none=True).items()
               if k in ("preferred_language", "photo_url", "expo_push_token")}
    if allowed:
        await get_db().users.update_one({"_id": user["_id"]}, {"$set": allowed})
    return public_user(await get_db().users.find_one({"_id": user["_id"]}))
