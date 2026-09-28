"""Jobs: assign, start, done, check, approve, reject, cancel, reassign, edit, bulk. Plus the double-claim guard."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from ..audit import audit, notify, users_with_role
from ..db import get_db
from ..payout import ALL, PayoutError, expand_colours, job_amount, lot_colour_map, normalise_colours, pieces_for
from ..schemas import DEFAULT_SETTINGS, AssignIn, BulkAction, JobAction, JobEdit, ReassignIn, SelfClaimIn
from ..security import ADMIN, SUPERVISOR, WORKER, admin_only, anyone, has, require, staff
from ..utils import as_dt, ist_day_bounds, money, new_id, next_number, now, out

router = APIRouter(prefix="/jobs", tags=["jobs"])
bulk_router = APIRouter(prefix="/jobs-bulk", tags=["jobs"])

OPEN = ["ASSIGNED", "STARTED"]
ACTIVE = ["ASSIGNED", "STARTED", "DONE", "CHECKED"]
REJECT_REASONS = ["QUALITY", "WRONG_LOT", "NOT_COMPLETED", "DUPLICATE", "OTHER"]
UNDO_MINUTES = 10


async def company_settings(db, company_id: str) -> dict:
    c = await db.companies.find_one({"_id": company_id})
    return {**DEFAULT_SETTINGS, **((c or {}).get("settings") or {})}


# ---------------- coverage (anti double-claim) ----------------
async def claim_coverage(db, job: dict, lot: dict) -> None:
    """Reserve every (lot, work type, colour) cell for this job. Unique index makes it race-safe."""
    cid, lot_id, wt = job["company_id"], job["lot_id"], job["work_type_id"]
    cells = expand_colours(job["colour_codes"], lot)
    holders = []
    if job.get("split_pieces"):
        colour = cells[0]
        full = await db.job_coverage.find_one({"company_id": cid, "lot_id": lot_id, "work_type_id": wt,
                                               "colour_code": colour, "slot": "FULL"})
        if full:
            holders.append(full)
        else:
            used = 0.0
            async for c in db.job_coverage.find({"company_id": cid, "lot_id": lot_id, "work_type_id": wt,
                                                 "colour_code": colour, "slot": {"$ne": "FULL"}}):
                used += c.get("pieces", 0)
            qty = lot_colour_map(lot).get(colour, 0)
            if used + job["split_pieces"] > qty + 1e-9:
                raise HTTPException(409, f"Only {qty - used:g} pcs of colour {colour} are left to split")
            await db.job_coverage.insert_one({"_id": new_id(), "company_id": cid, "lot_id": lot_id, "work_type_id": wt,
                                              "colour_code": colour, "slot": f"S-{job['_id']}",
                                              "job_id": job["_id"], "worker_id": job["worker_id"],
                                              "pieces": job["split_pieces"]})
            return
    else:
        async for c in db.job_coverage.find({"company_id": cid, "lot_id": lot_id, "work_type_id": wt,
                                             "colour_code": {"$in": cells}}):
            holders.append(c)
        if not holders:
            inserted = []
            try:
                for colour in cells:
                    _id = new_id()
                    await db.job_coverage.insert_one({"_id": _id, "company_id": cid, "lot_id": lot_id,
                                                      "work_type_id": wt, "colour_code": colour, "slot": "FULL",
                                                      "job_id": job["_id"], "worker_id": job["worker_id"]})
                    inserted.append(_id)
                return
            except DuplicateKeyError:
                await db.job_coverage.delete_many({"_id": {"$in": inserted}})
                holders = [c async for c in db.job_coverage.find({"company_id": cid, "lot_id": lot_id,
                                                                  "work_type_id": wt, "colour_code": {"$in": cells}})]
    # conflict -> tell exactly who holds it
    names = {}
    for h in holders:
        if h["worker_id"] not in names:
            u = await db.users.find_one({"_id": h["worker_id"]}, {"name": 1})
            names[h["worker_id"]] = (u or {}).get("name", "?")
    held = sorted({f"{h['colour_code']} ({names[h['worker_id']]})" for h in holders})
    raise HTTPException(409, {"message": "Already assigned: " + ", ".join(held),
                              "taken": [{"colour": h["colour_code"], "job_id": h["job_id"],
                                         "worker_id": h["worker_id"], "worker_name": names[h["worker_id"]]}
                                        for h in holders]})


async def release_coverage(db, job_id: str) -> None:
    await db.job_coverage.delete_many({"job_id": job_id})


# ---------------- helpers ----------------
async def enrich(db, company_id: str, jobs: list[dict]) -> list[dict]:
    lot_ids = {j["lot_id"] for j in jobs}
    wt_ids = {j["work_type_id"] for j in jobs}
    user_ids = {j["worker_id"] for j in jobs}
    lots = {l["_id"]: l async for l in db.lots.find({"_id": {"$in": list(lot_ids)}}, {"lot_no": 1, "item_name": 1})}
    wts = {w["_id"]: w async for w in db.work_types.find({"_id": {"$in": list(wt_ids)}})}
    users = {u["_id"]: u async for u in db.users.find({"_id": {"$in": list(user_ids)}},
                                                      {"name": 1, "name_local": 1, "photo_url": 1})}
    res = []
    for j in jobs:
        d = out(j)
        l, w, u = lots.get(j["lot_id"], {}), wts.get(j["work_type_id"], {}), users.get(j["worker_id"], {})
        d.update(lot_no=l.get("lot_no"), item_name=l.get("item_name"), work_type_code=w.get("code"),
                 work_type_name_en=w.get("name_en"), work_type_name_hi=w.get("name_hi"),
                 work_type_name_gu=w.get("name_gu"), work_type_icon=w.get("icon"),
                 worker_name=u.get("name"), worker_name_local=u.get("name_local"), worker_photo=u.get("photo_url"))
        res.append(d)
    return res


async def get_job(db, user: dict, job_id: str) -> dict:
    job = await db.jobs.find_one({"_id": job_id, "company_id": user["company_id"]})
    if not job:
        raise HTTPException(404, "Job not found")
    if not has(user, SUPERVISOR, ADMIN) and job["worker_id"] != user["_id"]:
        raise HTTPException(404, "Job not found")
    return job


async def transition(db, user: dict, job: dict, new_status: str, note: str = "", extra: dict | None = None,
                     allowed_from: list[str] | None = None) -> dict:
    if allowed_from and job["status"] not in allowed_from:
        raise HTTPException(409, f"Job {job['job_no']} is {job['status']}; can't move to {new_status}")
    t = now()
    upd = {"status": new_status, "updated_at": t, **(extra or {})}
    hist = {"status": new_status, "by": user["_id"], "by_name": user["name"], "at": t, "note": note}
    # optimistic concurrency: only update if nobody moved it meanwhile (important for offline sync)
    res = await db.jobs.update_one({"_id": job["_id"], "status": job["status"]},
                                   {"$set": upd, "$push": {"status_history": hist}})
    if not res.modified_count:
        raise HTTPException(409, f"Job {job['job_no']} was changed by someone else. Refresh and try again.")
    await audit(db, user, "job", job["_id"], new_status, old={"status": job["status"]}, new={**upd, "note": note})
    return {**job, **upd}


async def _job_line(db, job: dict) -> str:
    lot = await db.lots.find_one({"_id": job["lot_id"]}, {"lot_no": 1})
    wt = await db.work_types.find_one({"_id": job["work_type_id"]}, {"code": 1})
    return f"Lot {lot['lot_no']} {wt['code']} {','.join(job['colour_codes'])} - {job['pieces']:g} pcs"


async def _create_jobs(db, user: dict, worker_id: str, lot_id: str, work_type_ids: list[str], colour_codes: list[str],
                       status: str, split_pieces: float | None = None, note: str = "", client_ref: str | None = None,
                       photo_url: str | None = None) -> dict:
    cid = user["company_id"]
    if client_ref:
        existing = [j async for j in db.jobs.find({"company_id": cid, "client_ref": client_ref})]
        if existing:
            return {"jobs": await enrich(db, cid, existing), "warnings": [], "duplicate_request": True}
    worker = await db.users.find_one({"_id": worker_id, "company_id": cid, "is_active": True})
    if not worker or WORKER not in worker["roles"]:
        raise HTTPException(400, "Worker not found or inactive")
    lot = await db.lots.find_one({"_id": lot_id, "company_id": cid})
    if not lot:
        raise HTTPException(404, "Lot not found")
    if lot["status"] == "CLOSED":
        raise HTTPException(400, f"Lot {lot['lot_no']} is closed")
    if not work_type_ids:
        raise HTTPException(400, "Pick at least one work type")
    try:
        codes = normalise_colours(colour_codes, lot)
    except PayoutError as e:
        raise HTTPException(400, str(e))
    if split_pieces is not None and (len(codes) != 1 or codes == [ALL] or len(work_type_ids) != 1):
        raise HTTPException(400, "Split by pieces works with one colour and one work type")
    settings = await company_settings(db, cid)
    rates = {r["work_type_id"]: r async for r in db.lot_rates.find({"company_id": cid, "lot_id": lot_id,
                                                                    "work_type_id": {"$in": work_type_ids}})}
    wts = {w["_id"]: w async for w in db.work_types.find({"company_id": cid, "_id": {"$in": work_type_ids}})}
    missing = [wts.get(w, {}).get("code", w) for w in work_type_ids if w not in rates]
    if missing:
        raise HTTPException(400, f"Rate not set for this lot and work type: {', '.join(missing)}")
    if not expand_colours(codes, lot):
        raise HTTPException(400, f"Lot {lot['lot_no']} has no colour quantities yet")
    pcs = pieces_for(lot, codes, split_pieces)
    if split_pieces is not None and split_pieces > lot_colour_map(lot)[codes[0]]:
        raise HTTPException(400, "Split pieces are more than the colour quantity")
    created = []
    t = now()
    for wt in work_type_ids:
        n = await next_number(db, cid, "job")
        rate = rates[wt]["rate"]
        job = {"_id": new_id(), "company_id": cid, "job_no": f"J-{n:06d}", "lot_id": lot_id, "work_type_id": wt,
               "worker_id": worker_id, "colour_codes": codes, "split_pieces": split_pieces, "pieces": pcs,
               "rate_snapshot": rate, "amount": job_amount(pcs, rate, settings["rounding"]), "status": status,
               "assigned_by": user["_id"], "assigned_at": t, "reject_count": 0, "client_ref": client_ref,
               "source": "self_claim" if status == "DONE" else "assigned", "created_at": t,
               "status_history": [{"status": status, "by": user["_id"], "by_name": user["name"], "at": t, "note": note}]}
        if status == "DONE":
            job.update(done_at=t, done_by=user["_id"], done_photo_url=photo_url, done_note=note)
        try:
            await claim_coverage(db, job, lot)
        except HTTPException as e:
            for j in created:  # all-or-nothing
                await release_coverage(db, j["_id"])
                await db.jobs.delete_one({"_id": j["_id"]})
            if e.status_code == 409:
                await audit(db, user, "job", "-", "DUPLICATE_BLOCKED",
                            new={"worker_id": worker_id, "lot_id": lot_id, "work_type_id": wt,
                                 "colour_codes": codes, "detail": e.detail})
            raise
        await db.jobs.insert_one(job)
        await audit(db, user, "job", job["_id"], "CREATE", new={k: job[k] for k in
                    ("job_no", "worker_id", "lot_id", "work_type_id", "colour_codes", "pieces", "amount", "status")})
        created.append(job)
    if lot["status"] == "OPEN":
        await db.lots.update_one({"_id": lot_id}, {"$set": {"status": "IN_PRODUCTION"}})
    warnings = []
    start, end = ist_day_bounds()
    today_n = await db.jobs.count_documents({"company_id": cid, "worker_id": worker_id,
                                             "created_at": {"$gte": start, "$lt": end}})
    if today_n > settings["jobs_per_day_warning"]:
        warnings.append(f"{worker['name']} has {today_n} jobs today (limit {settings['jobs_per_day_warning']})")
    total = money(sum(j["amount"] for j in created))
    if status == "ASSIGNED":
        await notify(db, cid, [worker_id], "JOB_ASSIGNED", "Naya kaam / New job",
                     f"Lot {lot['lot_no']}: {len(created)} kaam, {pcs:g} pcs", {"job_ids": [j["_id"] for j in created]})
    else:
        await notify(db, cid, await users_with_role(db, cid, SUPERVISOR), "JOB_DONE", "Job done (self-claimed)",
                     f"{worker['name']} claimed Lot {lot['lot_no']} - {len(created)} job(s)", {})
    return {"jobs": await enrich(db, cid, created), "warnings": warnings, "total_amount": total}


# ---------------- create ----------------
@router.post("/assign")
async def assign(body: AssignIn, user: dict = Depends(staff)):
    db = get_db()
    return await _create_jobs(db, user, body.worker_id, body.lot_id, body.work_type_ids, body.colour_codes, "ASSIGNED",
                              body.split_pieces, body.note, body.client_ref)


@router.post("/self-claim")
async def self_claim(body: SelfClaimIn, user: dict = Depends(require(WORKER))):
    db = get_db()
    s = await company_settings(db, user["company_id"])
    if not s["allow_worker_self_claim"]:
        raise HTTPException(403, "Self-claim is switched off. Ask your supervisor.")
    if s["photo_required_on_done"] and not body.photo_url:
        raise HTTPException(400, "Photo is required")
    return await _create_jobs(db, user, user["_id"], body.lot_id, body.work_type_ids, body.colour_codes, "DONE",
                              client_ref=body.client_ref, photo_url=body.photo_url)


@router.get("/availability")
async def availability(lot_id: str, work_type_id: str, user: dict = Depends(anyone)):
    """Which colours are taken for a lot x work type (greys out chips in the app)."""
    db = get_db()
    lot = await db.lots.find_one({"_id": lot_id, "company_id": user["company_id"]})
    if not lot:
        raise HTTPException(404, "Lot not found")
    taken = {}
    async for c in db.job_coverage.find({"company_id": user["company_id"], "lot_id": lot_id,
                                         "work_type_id": work_type_id}):
        u = await db.users.find_one({"_id": c["worker_id"]}, {"name": 1})
        taken.setdefault(c["colour_code"], []).append({"worker_name": (u or {}).get("name"),
                                                       "split": c["slot"] != "FULL", "pieces": c.get("pieces")})
    return [{"code": c["code"], "qty": c["qty"], "taken_by": taken.get(c["code"], [])} for c in lot.get("colours", [])]


# ---------------- read ----------------
@router.get("")
async def list_jobs(status: list[str] | None = Query(None), worker_id: str | None = None, lot_id: str | None = None,
                    work_type_id: str | None = None, date_from: str | None = None, date_to: str | None = None,
                    date_field: str = "created_at", limit: int = Query(200, le=2000), skip: int = 0,
                    user: dict = Depends(anyone)):
    db = get_db()
    f: dict = {"company_id": user["company_id"]}
    if not has(user, SUPERVISOR, ADMIN):
        f["worker_id"] = user["_id"]  # workers only ever see their own
    elif worker_id:
        f["worker_id"] = worker_id
    if status:
        f["status"] = {"$in": status}
    if lot_id:
        f["lot_id"] = lot_id
    if work_type_id:
        f["work_type_id"] = work_type_id
    if date_field not in ("created_at", "done_at", "checked_at", "approved_at", "paid_at"):
        raise HTTPException(400, "Bad date_field")
    if date_from or date_to:
        from datetime import date as _d
        rng = {}
        if date_from:
            rng["$gte"] = as_dt(_d.fromisoformat(date_from))
        if date_to:
            rng["$lt"] = as_dt(_d.fromisoformat(date_to)) + timedelta(days=1)
        f[date_field] = rng
    jobs = [j async for j in db.jobs.find(f).sort([("assigned_at", 1)]).skip(skip).limit(limit)]
    res = await enrich(db, user["company_id"], jobs)
    settings = await company_settings(db, user["company_id"])
    if not has(user, SUPERVISOR, ADMIN) and not settings["show_amount_to_worker"]:
        for j in res:
            j.pop("amount", None)
            j.pop("rate_snapshot", None)
    return res


@router.get("/{job_id}")
async def job_detail(job_id: str, user: dict = Depends(anyone)):
    db = get_db()
    job = await get_job(db, user, job_id)
    return (await enrich(db, user["company_id"], [job]))[0]


# ---------------- worker actions ----------------
@router.post("/{job_id}/start")
async def start(job_id: str, body: JobAction = JobAction(), user: dict = Depends(anyone)):
    db = get_db()
    job = await get_job(db, user, job_id)
    if job["worker_id"] != user["_id"] and not has(user, SUPERVISOR, ADMIN):
        raise HTTPException(403, "Not your job")
    j = await transition(db, user, job, "STARTED", body.note, {"started_at": now()}, ["ASSIGNED"])
    return (await enrich(db, user["company_id"], [j]))[0]


async def _mark_done(db, user: dict, job: dict, body: JobAction, settings: dict) -> dict:
    on_behalf = job["worker_id"] != user["_id"]
    if on_behalf and not has(user, SUPERVISOR, ADMIN):
        raise HTTPException(403, "Not your job")
    if not on_behalf and settings["photo_required_on_done"] and not body.photo_url:
        raise HTTPException(400, "Photo is required")
    extra = {"done_at": now(), "done_by": user["_id"], "done_on_behalf": on_behalf,
             "done_photo_url": body.photo_url, "done_note": body.note}
    return await transition(db, user, job, "DONE", body.note or ("marked by supervisor" if on_behalf else ""),
                            extra, ["ASSIGNED", "STARTED"])


@router.post("/{job_id}/done")
async def done(job_id: str, body: JobAction = JobAction(), user: dict = Depends(anyone)):
    db = get_db()
    job = await get_job(db, user, job_id)
    settings = await company_settings(db, user["company_id"])
    j = await _mark_done(db, user, job, body, settings)
    return (await enrich(db, user["company_id"], [j]))[0]


@router.post("/{job_id}/undo-done")
async def undo_done(job_id: str, user: dict = Depends(anyone)):
    """Worker tapped Done by mistake: allowed for 10 minutes and only before the supervisor checks."""
    db = get_db()
    job = await get_job(db, user, job_id)
    if job["status"] != "DONE":
        raise HTTPException(409, "Only a DONE job can be undone")
    if not has(user, SUPERVISOR, ADMIN):
        if job["worker_id"] != user["_id"] or job.get("source") == "self_claim":
            raise HTTPException(403, "Not allowed")
        if now() - job["done_at"] > timedelta(minutes=UNDO_MINUTES):
            raise HTTPException(409, f"Undo is allowed only within {UNDO_MINUTES} minutes")
    j = await transition(db, user, job, "ASSIGNED", "undo done", {"done_at": None}, ["DONE"])
    return (await enrich(db, user["company_id"], [j]))[0]


# ---------------- supervisor / admin actions ----------------
@router.post("/{job_id}/check")
async def check(job_id: str, body: JobAction = JobAction(), user: dict = Depends(staff)):
    db = get_db()
    job = await get_job(db, user, job_id)
    j = await transition(db, user, job, "CHECKED", body.note, {"checked_by": user["_id"], "checked_at": now()}, ["DONE"])
    return (await enrich(db, user["company_id"], [j]))[0]


async def _reject(db, user: dict, job: dict, reason: str | None, note: str) -> dict:
    if reason not in REJECT_REASONS:
        raise HTTPException(400, f"Reason must be one of {', '.join(REJECT_REASONS)}")
    allowed = ["DONE", "CHECKED"] if has(user, ADMIN) else ["DONE"]
    t = now()
    j = await transition(db, user, job, "ASSIGNED", f"REJECTED: {reason} {note}".strip(),
                         {"rejected_reason": reason, "rejected_note": note, "rejected_at": t, "rejected_by": user["_id"],
                          "done_at": None, "checked_at": None, "checked_by": None,
                          "reject_count": job.get("reject_count", 0) + 1}, allowed)
    line = await _job_line(db, job)
    await notify(db, user["company_id"], [job["worker_id"]], "JOB_REJECTED", "Kaam wapas aaya / Job returned",
                 f"{line}: {reason} {note}".strip(), {"job_id": job["_id"]})
    if has(user, ADMIN) and job["status"] == "CHECKED" and job.get("checked_by"):
        await notify(db, user["company_id"], [job["checked_by"]], "JOB_REJECTED_BY_ADMIN", "Admin rejected a job",
                     f"{line}: {reason}", {"job_id": job["_id"]})
    return j


@router.post("/{job_id}/reject")
async def reject(job_id: str, body: JobAction, user: dict = Depends(staff)):
    db = get_db()
    job = await get_job(db, user, job_id)
    j = await _reject(db, user, job, body.reason, body.note)
    return (await enrich(db, user["company_id"], [j]))[0]


async def _approve(db, user: dict, job: dict, settings: dict) -> dict:
    allowed = ["CHECKED"] if settings["supervisor_check_required"] else ["DONE", "CHECKED"]
    if job["status"] not in allowed:
        raise HTTPException(409, f"Job {job['job_no']} is {job['status']}; needs "
                                 f"{' or '.join(allowed)} before approval")
    # Re-read pieces & rate one last time, then freeze them on the job.
    pieces, rate = job["pieces"], job["rate_snapshot"]
    if not job.get("manual_override"):
        lot = await db.lots.find_one({"_id": job["lot_id"]})
        r = await db.lot_rates.find_one({"company_id": job["company_id"], "lot_id": job["lot_id"],
                                         "work_type_id": job["work_type_id"]})
        pieces = pieces_for(lot, job["colour_codes"], job.get("split_pieces"))
        rate = r["rate"] if r else rate
    amount = job_amount(pieces, rate, settings["rounding"])
    return await transition(db, user, job, "APPROVED", "",
                            {"pieces": pieces, "rate_snapshot": rate, "amount": amount,
                             "approved_by": user["_id"], "approved_at": now()}, allowed)


@router.post("/{job_id}/approve")
async def approve(job_id: str, user: dict = Depends(admin_only)):
    db = get_db()
    job = await get_job(db, user, job_id)
    j = await _approve(db, user, job, await company_settings(db, user["company_id"]))
    await notify(db, user["company_id"], [j["worker_id"]], "JOB_APPROVED", "Approved ✅",
                 f"{await _job_line(db, j)} = ₹{j['amount']:.2f}", {"job_id": j["_id"]})
    return (await enrich(db, user["company_id"], [j]))[0]


@router.post("/{job_id}/edit")
async def edit_before_approval(job_id: str, body: JobEdit, user: dict = Depends(admin_only)):
    db = get_db()
    job = await get_job(db, user, job_id)
    if job["status"] not in ACTIVE:
        raise HTTPException(409, "Only jobs not yet approved can be edited")
    settings = await company_settings(db, user["company_id"])
    pieces = body.pieces if body.pieces is not None else job["pieces"]
    rate = body.rate if body.rate is not None else job["rate_snapshot"]
    upd = {"pieces": pieces, "rate_snapshot": rate, "amount": job_amount(pieces, rate, settings["rounding"]),
           "manual_override": True, "override_reason": body.reason}
    await db.jobs.update_one({"_id": job_id}, {"$set": upd})
    await audit(db, user, "job", job_id, "EDIT", old={"pieces": job["pieces"], "rate": job["rate_snapshot"],
                                                      "amount": job["amount"]}, new={**upd})
    return (await enrich(db, user["company_id"], [await db.jobs.find_one({"_id": job_id})]))[0]


@router.post("/{job_id}/cancel")
async def cancel(job_id: str, body: JobAction = JobAction(), user: dict = Depends(staff)):
    db = get_db()
    job = await get_job(db, user, job_id)
    allowed = ACTIVE if has(user, ADMIN) else ["ASSIGNED", "STARTED", "DONE"]
    j = await transition(db, user, job, "CANCELLED", body.note or body.reason or "", {"cancelled_at": now()}, allowed)
    await release_coverage(db, job_id)
    return (await enrich(db, user["company_id"], [j]))[0]


@router.post("/{job_id}/reassign")
async def reassign(job_id: str, body: ReassignIn, user: dict = Depends(staff)):
    db = get_db()
    job = await get_job(db, user, job_id)
    if job["status"] not in OPEN:
        raise HTTPException(409, "Only ASSIGNED or STARTED jobs can be reassigned")
    w = await db.users.find_one({"_id": body.worker_id, "company_id": user["company_id"], "is_active": True})
    if not w or WORKER not in w["roles"]:
        raise HTTPException(400, "Worker not found or inactive")
    res = await db.jobs.update_one({"_id": job_id, "status": job["status"]},
                                   {"$set": {"worker_id": body.worker_id, "status": "ASSIGNED"},
                                    "$push": {"status_history": {"status": "ASSIGNED", "by": user["_id"],
                                                                 "by_name": user["name"], "at": now(),
                                                                 "note": f"reassigned: {body.reason}"}}})
    if not res.modified_count:
        raise HTTPException(409, "Job changed meanwhile, refresh")
    await db.job_coverage.update_many({"job_id": job_id}, {"$set": {"worker_id": body.worker_id}})
    await audit(db, user, "job", job_id, "REASSIGN", old={"worker_id": job["worker_id"]},
                new={"worker_id": body.worker_id, "reason": body.reason})
    await notify(db, user["company_id"], [body.worker_id], "JOB_ASSIGNED", "Naya kaam / New job",
                 await _job_line(db, job), {"job_id": job_id})
    return (await enrich(db, user["company_id"], [await db.jobs.find_one({"_id": job_id})]))[0]


# ---------------- bulk ----------------
@bulk_router.post("/{action}")
async def bulk(action: str, body: BulkAction, user: dict = Depends(anyone)):
    """action = done | check | approve | reject. Processes each job, returns per-job result (no all-or-nothing)."""
    db = get_db()
    if action in ("check", "reject") and not has(user, SUPERVISOR, ADMIN):
        raise HTTPException(403, "Not allowed")
    if action == "approve" and not has(user, ADMIN):
        raise HTTPException(403, "Only admin can approve")
    if action not in ("done", "check", "approve", "reject"):
        raise HTTPException(400, "Unknown action")
    settings = await company_settings(db, user["company_id"])
    ok, failed, total = [], [], 0.0
    approved_by_worker: dict[str, list] = {}
    for jid in body.job_ids:
        try:
            job = await get_job(db, user, jid)
            if action == "done":
                j = await _mark_done(db, user, job, JobAction(note=body.note), settings)
            elif action == "check":
                j = await transition(db, user, job, "CHECKED", body.note,
                                     {"checked_by": user["_id"], "checked_at": now()}, ["DONE"])
            elif action == "approve":
                j = await _approve(db, user, job, settings)
                total += j["amount"]
                approved_by_worker.setdefault(j["worker_id"], []).append(j["amount"])
            else:
                j = await _reject(db, user, job, body.reason, body.note)
            ok.append(jid)
        except HTTPException as e:
            failed.append({"job_id": jid, "error": e.detail})
    for wid, amts in approved_by_worker.items():
        await notify(db, user["company_id"], [wid], "JOB_APPROVED", "Approved ✅",
                     f"{len(amts)} kaam approved = ₹{sum(amts):.2f}", {})
    if action == "done" and ok:
        await notify(db, user["company_id"], await users_with_role(db, user["company_id"], SUPERVISOR),
                     "JOB_DONE", "Jobs done", f"{user['name']} marked {len(ok)} job(s) done", {})
    return {"ok": ok, "failed": failed, "total_amount": money(total)}
