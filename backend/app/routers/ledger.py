"""Worker money view: balance, pending approval, advances, ledger, settlements. Used by worker and admin."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..payout import worker_balance
from ..security import ADMIN, SUPERVISOR, anyone, has
from ..utils import IST, money, out, outs

router = APIRouter(tags=["ledger"])


async def _sum(db, coll: str, match: dict, field: str = "amount") -> float:
    total = 0.0
    async for r in db[coll].aggregate([{"$match": match}, {"$group": {"_id": None, "t": {"$sum": f"${field}"}}}]):
        total = r["t"]
    return money(total)


def month_start_utc() -> datetime:
    n = datetime.now(IST)
    return datetime(n.year, n.month, 1, tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)


async def worker_summary(db, company_id: str, worker_id: str) -> dict:
    base = {"company_id": company_id, "worker_id": worker_id}
    earned = await _sum(db, "jobs", {**base, "status": {"$in": ["APPROVED", "PAID"]}})
    pending = await _sum(db, "jobs", {**base, "status": {"$in": ["DONE", "CHECKED"]}})
    advances = await _sum(db, "advances", {**base, "is_active": True})
    recovered = await _sum(db, "advances", {**base, "is_active": True}, "recovered_amount")
    deductions = await _sum(db, "deductions", {**base, "is_active": True})
    payments = await _sum(db, "payments", {**base, "is_active": True})
    this_month = await _sum(db, "jobs", {**base, "status": {"$in": ["APPROVED", "PAID"]},
                                         "approved_at": {"$gte": month_start_utc()}})
    open_jobs = await db.jobs.count_documents({**base, "status": {"$in": ["ASSIGNED", "STARTED"]}})
    return {
        "receivable": worker_balance(earned, advances, deductions, payments),
        "earned_total": earned,
        "pending_approval": pending,
        "advance_total": advances,
        "advance_open": money(advances - recovered),
        "deductions_total": deductions,
        "paid_total": payments,
        "earned_this_month": this_month,
        "open_jobs": open_jobs,
    }


def _can_see(user: dict, worker_id: str) -> None:
    if worker_id != user["_id"] and not has(user, SUPERVISOR, ADMIN):
        raise HTTPException(403, "Not allowed")


@router.get("/workers/{worker_id}/summary")
async def summary(worker_id: str, user: dict = Depends(anyone)):
    _can_see(user, worker_id)
    return await worker_summary(get_db(), user["company_id"], worker_id)


@router.get("/workers/{worker_id}/ledger")
async def ledger(worker_id: str, user: dict = Depends(anyone)):
    """Date-wise statement: job earnings (credit), advances/deductions/payments (debit), running balance."""
    _can_see(user, worker_id)
    db = get_db()
    base = {"company_id": user["company_id"], "worker_id": worker_id}
    rows = []
    lots = {l["_id"]: l["lot_no"] async for l in db.lots.find({"company_id": user["company_id"]}, {"lot_no": 1})}
    wts = {w["_id"]: w["code"] async for w in db.work_types.find({"company_id": user["company_id"]}, {"code": 1})}
    async for j in db.jobs.find({**base, "status": {"$in": ["APPROVED", "PAID"]}}):
        rows.append({"date": j["approved_at"], "type": "EARNING", "credit": j["amount"], "debit": 0,
                     "text": f"Lot {lots.get(j['lot_id'])} {wts.get(j['work_type_id'])} "
                             f"{','.join(j['colour_codes'])} {j['pieces']:g} pcs", "ref": j["job_no"]})
    async for a in db.advances.find({**base, "is_active": True}):
        rows.append({"date": a["date"], "type": "ADVANCE", "credit": 0, "debit": a["amount"],
                     "text": f"Advance ({a['mode']}) {a.get('reason', '')}".strip(), "ref": a.get("receipt_no", "")})
    async for d in db.deductions.find({**base, "is_active": True}):
        rows.append({"date": d["date"], "type": "DEDUCTION", "credit": 0, "debit": d["amount"],
                     "text": f"Deduction: {d['reason']} {d.get('note', '')}".strip(), "ref": ""})
    async for p in db.payments.find({**base, "is_active": True}):
        rows.append({"date": p["date"], "type": "PAYMENT", "credit": 0, "debit": p["amount"],
                     "text": f"Paid ({p['mode']}) {p.get('reference_no', '')}".strip(), "ref": p["receipt_no"]})
    rows.sort(key=lambda r: (r["date"], 0 if r["credit"] else 1))
    bal = 0.0
    for r in rows:
        bal = money(bal + r["credit"] - r["debit"])
        r["balance"] = bal
    return {"rows": rows, "closing_balance": bal}


@router.get("/workers/{worker_id}/settlements")
async def settlements(worker_id: str, user: dict = Depends(anyone)):
    _can_see(user, worker_id)
    db = get_db()
    res = []
    async for c in db.payout_cycles.find({"company_id": user["company_id"], "status": {"$in": ["LOCKED", "PAID"]},
                                          "lines.worker_id": worker_id}).sort("from_date", -1):
        line = next(l for l in c["lines"] if l["worker_id"] == worker_id)
        pays = outs([p async for p in db.payments.find({"company_id": user["company_id"], "worker_id": worker_id,
                                                         "payout_cycle_id": c["_id"], "is_active": True})])
        res.append({"cycle_id": c["_id"], "cycle_no": c["cycle_no"], "from_date": c["from_date"], "to_date": c["to_date"],
                    "status": c["status"], **line, "payments": pays})
    advances = outs([a async for a in db.advances.find({"company_id": user["company_id"], "worker_id": worker_id,
                                                         "is_active": True}).sort("date", -1)])
    return {"settlements": res, "advances": advances}
