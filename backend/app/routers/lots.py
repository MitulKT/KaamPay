"""Lots, colour quantities, rate master, work grid, lot summary."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from ..audit import audit, notify, users_with_role
from ..db import get_db
from ..payout import job_amount, pieces_for
from ..schemas import CopyRatesIn, LotIn, LotPatch, RatesIn
from ..security import ADMIN, admin_only, anyone, has, staff
from ..utils import as_dt, money, new_id, now, out

router = APIRouter(prefix="/lots", tags=["lots"])

ACTIVE = ["ASSIGNED", "STARTED", "DONE", "CHECKED"]
FROZEN = ["APPROVED", "PAID"]
DONE_PLUS = ["DONE", "CHECKED", "APPROVED", "PAID"]


def _colours(body_colours) -> list[dict]:
    seen, res = set(), []
    for c in body_colours:
        code = c.code.strip().upper()
        if not code or code == "ALL":
            raise HTTPException(400, "Colour code can't be empty or ALL")
        if code in seen:
            raise HTTPException(400, f"Colour {code} is repeated")
        seen.add(code)
        res.append({"code": code, "name": c.name, "qty": float(c.qty)})
    return res


async def get_lot(db, company_id: str, lot_id: str) -> dict:
    lot = await db.lots.find_one({"_id": lot_id, "company_id": company_id})
    if not lot:
        raise HTTPException(404, "Lot not found")
    return lot


async def _rate_map(db, company_id, lot_id) -> dict[str, dict]:
    return {r["work_type_id"]: r async for r in db.lot_rates.find({"company_id": company_id, "lot_id": lot_id})}


async def lot_progress(db, lot: dict) -> dict:
    """Cells = (work types that have a rate on this lot) x colours. Done = cells covered by DONE+ jobs."""
    rates = await _rate_map(db, lot["company_id"], lot["_id"])
    codes = [c["code"] for c in lot.get("colours", [])]
    total_cells = len(rates) * len(codes)
    done_cells, assigned_cells = set(), set()
    async for j in db.jobs.find({"company_id": lot["company_id"], "lot_id": lot["_id"],
                                 "status": {"$nin": ["CANCELLED"]}}):
        cells = codes if j["colour_codes"] == ["ALL"] else j["colour_codes"]
        for c in cells:
            if j["work_type_id"] in rates:
                assigned_cells.add((j["work_type_id"], c))
                if j["status"] in DONE_PLUS and not j.get("split_pieces"):
                    done_cells.add((j["work_type_id"], c))
    pct = round(100 * len(done_cells) / total_cells, 1) if total_cells else 0.0
    return {"total_cells": total_cells, "assigned_cells": len(assigned_cells), "done_cells": len(done_cells),
            "percent_done": pct}


@router.get("")
async def list_lots(status: str | None = None, q: str | None = None, with_progress: bool = True,
                    user: dict = Depends(anyone)):
    db = get_db()
    f: dict = {"company_id": user["company_id"]}
    if status:
        f["status"] = status
    if q:
        f["lot_no"] = {"$regex": q, "$options": "i"}
    lots = [l async for l in db.lots.find(f).sort("created_at", -1)]
    res = []
    for l in lots:
        d = out(l)
        if with_progress:
            d["progress"] = await lot_progress(db, l)
            d["missing_rates"] = await db.work_types.count_documents(
                {"company_id": user["company_id"], "is_active": True}) - len(await _rate_map(db, user["company_id"], l["_id"]))
        res.append(d)
    return res


@router.post("")
async def create_lot(body: LotIn, user: dict = Depends(staff)):
    db = get_db()
    colours = _colours(body.colours)
    doc = {"_id": new_id(), "company_id": user["company_id"], "lot_no": body.lot_no, "item_name": body.item_name,
           "style_id": body.style_id, "colours": colours, "total_qty": money(sum(c["qty"] for c in colours)),
           "start_date": as_dt(body.start_date) if body.start_date else None,
           "target_date": as_dt(body.target_date) if body.target_date else None,
           "status": "OPEN", "remarks": body.remarks, "created_at": now(), "created_by": user["_id"]}
    try:
        await db.lots.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, f"Lot {body.lot_no} already exists")
    if body.style_id:
        style = await db.styles.find_one({"_id": body.style_id, "company_id": user["company_id"]})
        for r in (style or {}).get("default_rates", []):
            await _upsert_rate(db, user, doc["_id"], r["work_type_id"], float(r["rate"]))
    await audit(db, user, "lot", doc["_id"], "CREATE", new={"lot_no": body.lot_no, "colours": colours})
    return out(doc)


@router.get("/{lot_id}")
async def lot_detail(lot_id: str, user: dict = Depends(anyone)):
    db = get_db()
    lot = await get_lot(db, user["company_id"], lot_id)
    d = out(lot)
    d["progress"] = await lot_progress(db, lot)
    return d


@router.patch("/{lot_id}")
async def update_lot(lot_id: str, body: LotPatch, user: dict = Depends(staff)):
    db = get_db()
    lot = await get_lot(db, user["company_id"], lot_id)
    upd = body.model_dump(exclude_none=True, exclude={"reason", "colours"})
    for k in ("start_date", "target_date"):
        if k in upd:
            upd[k] = as_dt(upd[k])
    recalced = []
    if body.colours is not None:
        colours = _colours(body.colours)
        new_codes = {c["code"] for c in colours}
        # a colour held by an active/frozen job can't be removed
        async for j in db.jobs.find({"company_id": user["company_id"], "lot_id": lot_id,
                                     "status": {"$in": ACTIVE + FROZEN}}):
            missing = set(j["colour_codes"]) - new_codes - {"ALL"}
            if missing:
                raise HTTPException(400, f"Colour {', '.join(missing)} is used by job {j['job_no']}; cancel it first")
        upd["colours"] = colours
        upd["total_qty"] = money(sum(c["qty"] for c in colours))
        new_lot = {**lot, **upd}
        company = await db.companies.find_one({"_id": user["company_id"]})
        rounding = (company.get("settings") or {}).get("rounding", "NONE")
        # Recalculate open (not yet approved) jobs; approved ones stay frozen.
        async for j in db.jobs.find({"company_id": user["company_id"], "lot_id": lot_id, "status": {"$in": ACTIVE}}):
            if j.get("split_pieces"):
                continue
            pcs = pieces_for(new_lot, j["colour_codes"])
            if pcs != j["pieces"]:
                amt = job_amount(pcs, j["rate_snapshot"], rounding)
                await db.jobs.update_one({"_id": j["_id"]}, {"$set": {"pieces": pcs, "amount": amt}})
                recalced.append({"job_no": j["job_no"], "old_amount": j["amount"], "new_amount": amt})
        # Frozen jobs whose basis changed: tell admin (use a deduction/bonus instead of editing)
        frozen_diff = 0.0
        async for j in db.jobs.find({"company_id": user["company_id"], "lot_id": lot_id, "status": {"$in": FROZEN}}):
            if not j.get("split_pieces"):
                frozen_diff += job_amount(pieces_for(new_lot, j["colour_codes"]), j["rate_snapshot"]) - j["amount"]
        if recalced or abs(frozen_diff) >= 0.01:
            diff = money(sum(r["new_amount"] - r["old_amount"] for r in recalced))
            msg = f"Lot {lot['lot_no']} quantities changed: open jobs {diff:+.2f} Rs"
            if abs(frozen_diff) >= 0.01:
                msg += f"; approved jobs would differ by {frozen_diff:+.2f} Rs (add a deduction/bonus if needed)"
            await notify(db, user["company_id"], await users_with_role(db, user["company_id"], ADMIN),
                         "LOT_QTY_CHANGED", "Lot quantity changed", msg, {"lot_id": lot_id})
    await db.lots.update_one({"_id": lot_id}, {"$set": upd})
    await audit(db, user, "lot", lot_id, "UPDATE", old={k: lot.get(k) for k in upd},
                new={**upd, "reason": body.reason, "recalculated_jobs": recalced})
    d = out(await db.lots.find_one({"_id": lot_id}))
    d["recalculated_jobs"] = recalced
    return d


@router.post("/{lot_id}/status")
async def set_status(lot_id: str, status: str = Query(pattern="^(OPEN|IN_PRODUCTION|CLOSED)$"), reason: str = "",
                     user: dict = Depends(staff)):
    db = get_db()
    lot = await get_lot(db, user["company_id"], lot_id)
    if status == "CLOSED":
        open_n = await db.jobs.count_documents({"company_id": user["company_id"], "lot_id": lot_id,
                                                "status": {"$in": ["ASSIGNED", "STARTED", "DONE"]}})
        if open_n:
            raise HTTPException(400, f"{open_n} jobs are still open on this lot")
    if lot["status"] == "CLOSED" and status != "CLOSED":
        if not has(user, ADMIN):
            raise HTTPException(403, "Only admin can reopen a closed lot")
        if not reason:
            raise HTTPException(400, "Reason required to reopen")
    await db.lots.update_one({"_id": lot_id}, {"$set": {"status": status}})
    await audit(db, user, "lot", lot_id, "STATUS", old=lot["status"], new={"status": status, "reason": reason})
    return {"ok": True, "status": status}


# ---------- rates ----------
async def _upsert_rate(db, user, lot_id, work_type_id, rate, reason=""):
    existing = await db.lot_rates.find_one({"company_id": user["company_id"], "lot_id": lot_id,
                                            "work_type_id": work_type_id})
    if existing and existing.get("is_locked") and not has(user, ADMIN):
        raise HTTPException(403, "Rate is locked by admin")
    if existing and existing["rate"] == rate:
        return existing
    if existing:
        used = await db.jobs.count_documents({"company_id": user["company_id"], "lot_id": lot_id,
                                              "work_type_id": work_type_id, "status": {"$ne": "CANCELLED"}})
        if used and not reason:
            raise HTTPException(400, "Jobs already use this rate. Give a reason for changing it.")
        await db.lot_rates.update_one({"_id": existing["_id"]}, {"$set": {"rate": rate, "updated_at": now(),
                                                                          "updated_by": user["_id"]}})
        await audit(db, user, "lot_rate", existing["_id"], "UPDATE", old=existing["rate"],
                    new={"rate": rate, "reason": reason, "lot_id": lot_id, "work_type_id": work_type_id})
        # open jobs pick up the new rate; approved jobs are frozen
        company = await db.companies.find_one({"_id": user["company_id"]})
        rounding = (company.get("settings") or {}).get("rounding", "NONE")
        async for j in db.jobs.find({"company_id": user["company_id"], "lot_id": lot_id,
                                     "work_type_id": work_type_id, "status": {"$in": ACTIVE}}):
            await db.jobs.update_one({"_id": j["_id"]}, {"$set": {"rate_snapshot": rate,
                                                                  "amount": job_amount(j["pieces"], rate, rounding)}})
        return existing
    doc = {"_id": new_id(), "company_id": user["company_id"], "lot_id": lot_id, "work_type_id": work_type_id,
           "rate": rate, "is_locked": False, "effective_from": now(), "created_at": now(), "created_by": user["_id"]}
    await db.lot_rates.insert_one(doc)
    await audit(db, user, "lot_rate", doc["_id"], "CREATE", new={"rate": rate, "lot_id": lot_id,
                                                                  "work_type_id": work_type_id})
    return doc


@router.get("/{lot_id}/rates")
async def get_rates(lot_id: str, user: dict = Depends(staff)):
    """Every active work type with its rate on this lot (None = missing, shown red in the app)."""
    db = get_db()
    await get_lot(db, user["company_id"], lot_id)
    rates = await _rate_map(db, user["company_id"], lot_id)
    res = []
    async for w in db.work_types.find({"company_id": user["company_id"], "is_active": True}).sort("sequence_no", 1):
        r = rates.get(w["_id"])
        res.append({"work_type_id": w["_id"], "code": w["code"], "name_en": w["name_en"], "name_hi": w.get("name_hi"),
                    "name_gu": w.get("name_gu"), "icon": w.get("icon"), "rate": r["rate"] if r else None,
                    "is_locked": bool(r and r.get("is_locked"))})
    return res


@router.put("/{lot_id}/rates")
async def set_rates(lot_id: str, body: RatesIn, user: dict = Depends(staff)):
    db = get_db()
    await get_lot(db, user["company_id"], lot_id)
    for r in body.rates:
        if r.get("rate") is None or r.get("rate") == "":
            continue
        rate = float(r["rate"])
        if rate < 0:
            raise HTTPException(400, "Rate can't be negative")
        await _upsert_rate(db, user, lot_id, r["work_type_id"], money(rate), body.reason)
    return await get_rates(lot_id, user)


@router.post("/{lot_id}/rates/copy")
async def copy_rates(lot_id: str, body: CopyRatesIn, user: dict = Depends(staff)):
    db = get_db()
    await get_lot(db, user["company_id"], lot_id)
    if body.from_lot_id:
        src = [{"work_type_id": r["work_type_id"], "rate": r["rate"]}
               async for r in db.lot_rates.find({"company_id": user["company_id"], "lot_id": body.from_lot_id})]
    elif body.from_style_id:
        style = await db.styles.find_one({"_id": body.from_style_id, "company_id": user["company_id"]})
        src = (style or {}).get("default_rates", [])
    else:
        raise HTTPException(400, "Give from_lot_id or from_style_id")
    existing = await _rate_map(db, user["company_id"], lot_id)
    n = 0
    for r in src:
        if r["work_type_id"] not in existing:  # never overwrite rates already set
            await _upsert_rate(db, user, lot_id, r["work_type_id"], float(r["rate"]))
            n += 1
    return {"copied": n}


@router.post("/{lot_id}/rates/lock")
async def lock_rates(lot_id: str, locked: bool = True, user: dict = Depends(admin_only)):
    db = get_db()
    await get_lot(db, user["company_id"], lot_id)
    await db.lot_rates.update_many({"company_id": user["company_id"], "lot_id": lot_id}, {"$set": {"is_locked": locked}})
    await audit(db, user, "lot", lot_id, "LOCK_RATES" if locked else "UNLOCK_RATES")
    return {"ok": True, "locked": locked}


# ---------- work grid ----------
@router.get("/{lot_id}/grid")
async def work_grid(lot_id: str, user: dict = Depends(staff)):
    """Rows = work types, columns = colours. Each cell lists the job(s) covering it."""
    db = get_db()
    lot = await get_lot(db, user["company_id"], lot_id)
    codes = [c["code"] for c in lot.get("colours", [])]
    rates = await _rate_map(db, user["company_id"], lot_id)
    workers = {u["_id"]: u async for u in db.users.find({"company_id": user["company_id"]},
                                                         {"name": 1, "name_local": 1, "photo_url": 1})}
    cells: dict = {}
    async for j in db.jobs.find({"company_id": user["company_id"], "lot_id": lot_id,
                                 "status": {"$nin": ["CANCELLED"]}}):
        w = workers.get(j["worker_id"], {})
        initials = "".join(p[0] for p in w.get("name", "?").split()[:2]).upper()
        for c in (codes if j["colour_codes"] == ["ALL"] else j["colour_codes"]):
            cells.setdefault(f"{j['work_type_id']}|{c}", []).append(
                {"job_id": j["_id"], "job_no": j["job_no"], "status": j["status"], "worker_id": j["worker_id"],
                 "worker_name": w.get("name"), "initials": initials, "pieces": j["pieces"],
                 "split_pieces": j.get("split_pieces")})
    rows = []
    async for w in db.work_types.find({"company_id": user["company_id"], "is_active": True}).sort("sequence_no", 1):
        r = rates.get(w["_id"])
        rows.append({"work_type_id": w["_id"], "code": w["code"], "name_en": w["name_en"], "name_hi": w.get("name_hi"),
                     "icon": w.get("icon"), "rate": r["rate"] if r else None,
                     "cells": [{"colour": c, "jobs": cells.get(f"{w['_id']}|{c}", [])} for c in codes]})
    return {"lot": out(lot), "colours": lot.get("colours", []), "rows": rows}


@router.get("/{lot_id}/summary")
async def lot_summary(lot_id: str, user: dict = Depends(staff)):
    """Labour cost of the lot: estimate (rate x total qty) vs actual approved; cost per piece."""
    db = get_db()
    lot = await get_lot(db, user["company_id"], lot_id)
    rates = await _rate_map(db, user["company_id"], lot_id)
    wts = {w["_id"]: w async for w in db.work_types.find({"company_id": user["company_id"]})}
    actual: dict[str, dict] = {}
    async for j in db.jobs.find({"company_id": user["company_id"], "lot_id": lot_id, "status": {"$ne": "CANCELLED"}}):
        a = actual.setdefault(j["work_type_id"], {"approved": 0.0, "pending": 0.0, "pieces_done": 0.0})
        if j["status"] in FROZEN:
            a["approved"] += j["amount"]
            a["pieces_done"] += j["pieces"]
        elif j["status"] in ("DONE", "CHECKED"):
            a["pending"] += j["amount"]
            a["pieces_done"] += j["pieces"]
    rows = []
    for wid in set(rates) | set(actual):
        rate = rates.get(wid, {}).get("rate")
        a = actual.get(wid, {"approved": 0.0, "pending": 0.0, "pieces_done": 0.0})
        est = money((rate or 0) * lot["total_qty"])
        rows.append({"work_type_id": wid, "code": wts.get(wid, {}).get("code"), "rate": rate,
                     "estimated_cost": est, "approved_cost": money(a["approved"]), "pending_cost": money(a["pending"]),
                     "pieces_done": a["pieces_done"],
                     "percent_done": round(100 * a["pieces_done"] / lot["total_qty"], 1) if lot["total_qty"] else 0})
    rows.sort(key=lambda r: wts.get(r["work_type_id"], {}).get("sequence_no", 999))
    est_total = money(sum(r["estimated_cost"] for r in rows))
    appr_total = money(sum(r["approved_cost"] for r in rows))
    return {
        "lot_no": lot["lot_no"], "total_qty": lot["total_qty"], "rows": rows,
        "estimated_total": est_total, "approved_total": appr_total,
        "pending_total": money(sum(r["pending_cost"] for r in rows)),
        "estimated_cost_per_piece": money(est_total / lot["total_qty"]) if lot["total_qty"] else 0,
        "progress": await lot_progress(db, lot),
    }
