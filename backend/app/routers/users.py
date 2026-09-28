"""Company settings, users and worker profiles."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from ..audit import audit
from ..db import get_db
from ..schemas import DEFAULT_SETTINGS, CompanyUpdate, UserIn, UserPatch
from ..security import ADMIN, SUPERVISOR, WORKER, admin_only, anyone, has, staff
from ..utils import new_id, next_number, now, out
from .ledger import worker_summary

router = APIRouter(tags=["users"])

PROFILE_FIELDS = ("skill_work_type_ids", "payment_mode", "upi_id", "bank_name", "ifsc", "account_last4",
                  "joining_date", "notes")


# ---------- company ----------
@router.get("/company")
async def get_company(user: dict = Depends(anyone)):
    c = await get_db().companies.find_one({"_id": user["company_id"]})
    c["settings"] = {**DEFAULT_SETTINGS, **(c.get("settings") or {})}
    return out(c)


@router.get("/company/contacts")
async def contacts(user: dict = Depends(anyone)):
    """Supervisors/admins a worker can call from the Help button."""
    res = []
    async for u in get_db().users.find({"company_id": user["company_id"], "is_active": True,
                                        "roles": {"$in": [SUPERVISOR, ADMIN]}}, {"name": 1, "mobile": 1, "roles": 1}):
        res.append({"id": u["_id"], "name": u["name"], "mobile": u["mobile"], "roles": u["roles"]})
    res.sort(key=lambda u: 0 if SUPERVISOR in u["roles"] else 1)
    return res


@router.patch("/company")
async def update_company(body: CompanyUpdate, user: dict = Depends(admin_only)):
    db = get_db()
    old = await db.companies.find_one({"_id": user["company_id"]})
    upd = body.model_dump(exclude_none=True)
    if "settings" in upd:
        unknown = set(upd["settings"]) - set(DEFAULT_SETTINGS)
        if unknown:
            raise HTTPException(400, f"Unknown settings: {', '.join(sorted(unknown))}")
        upd["settings"] = {**DEFAULT_SETTINGS, **(old.get("settings") or {}), **upd["settings"]}
    await db.companies.update_one({"_id": user["company_id"]}, {"$set": upd})
    await audit(db, user, "company", user["company_id"], "UPDATE",
                old={k: old.get(k) for k in upd}, new=upd)
    return await get_company(user)


# ---------- users ----------
async def _user_out(db, u: dict, with_summary: bool = False) -> dict:
    d = out(u)
    d.pop("session_version", None)
    p = await db.worker_profiles.find_one({"user_id": u["_id"]})
    d["profile"] = out(p)
    if with_summary and WORKER in u["roles"]:
        d["summary"] = await worker_summary(db, u["company_id"], u["_id"])
    return d


@router.get("/users")
async def list_users(role: str | None = None, q: str | None = None, include_inactive: bool = False,
                     with_summary: bool = False, user: dict = Depends(staff)):
    db = get_db()
    f: dict = {"company_id": user["company_id"]}
    if role:
        f["roles"] = role
    if not include_inactive:
        f["is_active"] = True
    if q:
        f["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"name_local": {"$regex": q}}, {"mobile": {"$regex": q}}]
    users = [u async for u in db.users.find(f).sort("name", 1)]
    return [await _user_out(db, u, with_summary) for u in users]


@router.post("/users")
async def create_user(body: UserIn, user: dict = Depends(staff)):
    db = get_db()
    # Supervisors may only add workers.
    if not has(user, ADMIN) and set(body.roles) - {WORKER}:
        raise HTTPException(403, "Only admin can add supervisors or admins")
    uid = new_id()
    doc = {
        "_id": uid, "company_id": user["company_id"], "name": body.name.strip(), "name_local": body.name_local.strip(),
        "mobile": body.mobile, "roles": body.roles, "preferred_language": body.preferred_language,
        "photo_url": body.photo_url, "is_active": True, "session_version": 0,
        "pending_mobile": body.mobile is None, "created_at": now(), "created_by": user["_id"],
    }
    if body.mobile is None:
        doc["mobile"] = f"pending-{uid[:10]}"  # keeps the unique index happy until a number is added
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "This mobile number is already registered")
    if WORKER in body.roles:
        code = await next_number(db, user["company_id"], "worker")
        prof = {"_id": new_id(), "company_id": user["company_id"], "user_id": uid, "worker_code": f"W{code:03d}",
                **{k: getattr(body, k) for k in PROFILE_FIELDS}}
        if prof.get("joining_date"):
            prof["joining_date"] = str(prof["joining_date"])
        await db.worker_profiles.insert_one(prof)
    await audit(db, user, "user", uid, "CREATE", new={"name": body.name, "roles": body.roles, "mobile": body.mobile})
    return await _user_out(db, doc)


@router.get("/users/{uid}")
async def get_user(uid: str, user: dict = Depends(anyone)):
    db = get_db()
    if uid != user["_id"] and not has(user, SUPERVISOR, ADMIN):
        raise HTTPException(403, "Not allowed")
    u = await db.users.find_one({"_id": uid, "company_id": user["company_id"]})
    if not u:
        raise HTTPException(404, "User not found")
    d = await _user_out(db, u, with_summary=True)
    if WORKER in u["roles"]:
        d["open_jobs"] = await db.jobs.count_documents(
            {"company_id": user["company_id"], "worker_id": uid, "status": {"$in": ["ASSIGNED", "STARTED"]}})
        d["done_jobs"] = await db.jobs.count_documents(
            {"company_id": user["company_id"], "worker_id": uid, "status": {"$in": ["DONE", "CHECKED", "APPROVED", "PAID"]}})
        d["rejections"] = await db.jobs.count_documents(
            {"company_id": user["company_id"], "worker_id": uid, "reject_count": {"$gt": 0}})
    return d


@router.patch("/users/{uid}")
async def update_user(uid: str, body: UserPatch, user: dict = Depends(staff)):
    db = get_db()
    u = await db.users.find_one({"_id": uid, "company_id": user["company_id"]})
    if not u:
        raise HTTPException(404, "User not found")
    is_admin = has(user, ADMIN)
    if not is_admin and (set(u["roles"]) - {WORKER} or body.roles is not None):
        raise HTTPException(403, "Only admin can change supervisors/admins or roles")
    upd = body.model_dump(exclude_none=True)
    upd.pop("expo_push_token", None)
    prof_upd = {k: upd.pop(k) for k in list(upd) if k in PROFILE_FIELDS}
    if prof_upd.get("account_last4"):
        prof_upd["account_last4"] = prof_upd["account_last4"][-4:]
    inc = {}
    if "mobile" in upd and upd["mobile"] != u["mobile"]:
        upd["pending_mobile"] = False
        inc["session_version"] = 1  # kill old sessions when the number changes
    if upd.get("is_active") is False:
        if uid == user["_id"]:
            raise HTTPException(400, "You cannot deactivate yourself")
        inc["session_version"] = 1
    if upd.get("roles") is not None and uid == user["_id"] and ADMIN not in upd["roles"]:
        raise HTTPException(400, "You cannot remove your own admin role")
    try:
        if upd or inc:
            await db.users.update_one({"_id": uid}, {"$set": upd, **({"$inc": inc} if inc else {})})
    except DuplicateKeyError:
        raise HTTPException(409, "This mobile number is already registered")
    if prof_upd:
        await db.worker_profiles.update_one({"user_id": uid}, {"$set": prof_upd})
    new_roles = upd.get("roles") or u["roles"]
    if WORKER in new_roles and not await db.worker_profiles.find_one({"user_id": uid}):
        code = await next_number(db, user["company_id"], "worker")
        await db.worker_profiles.insert_one({"_id": new_id(), "company_id": user["company_id"], "user_id": uid,
                                             "worker_code": f"W{code:03d}", "payment_mode": "CASH",
                                             "skill_work_type_ids": []})
    await audit(db, user, "user", uid, "UPDATE", old={k: u.get(k) for k in upd}, new={**upd, **prof_upd})
    return await _user_out(db, await db.users.find_one({"_id": uid}))


@router.get("/workers/tiles")
async def worker_tiles(q: str | None = None, skill: str | None = None, user: dict = Depends(staff)):
    """Lightweight list for the Assign screen: photo, names, open job count."""
    db = get_db()
    f: dict = {"company_id": user["company_id"], "roles": WORKER, "is_active": True}
    if q:
        f["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"name_local": {"$regex": q}}]
    workers = [u async for u in db.users.find(f).sort("name", 1)]
    counts = {}
    async for r in db.jobs.aggregate([
        {"$match": {"company_id": user["company_id"], "status": {"$in": ["ASSIGNED", "STARTED"]}}},
        {"$group": {"_id": "$worker_id", "n": {"$sum": 1}}}]):
        counts[r["_id"]] = r["n"]
    profiles = {p["user_id"]: p async for p in db.worker_profiles.find({"company_id": user["company_id"]})}
    res = []
    for w in workers:
        p = profiles.get(w["_id"], {})
        if skill and skill not in (p.get("skill_work_type_ids") or []):
            continue
        res.append({"id": w["_id"], "name": w["name"], "name_local": w.get("name_local", ""),
                    "photo_url": w.get("photo_url"), "worker_code": p.get("worker_code"),
                    "open_jobs": counts.get(w["_id"], 0), "pending_mobile": w.get("pending_mobile", False)})
    return res
