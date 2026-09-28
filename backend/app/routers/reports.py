"""Dashboards + reports R1..R11. Every report returns {filters, summary, rows, chart?} and supports ?format=xlsx."""
import io
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font

from ..db import get_db
from ..security import ADMIN, SUPERVISOR, WORKER, admin_only, anyone, has, staff
from ..utils import as_dt, ist_day_bounds, money, now, out, outs, to_ist
from .jobs import company_settings, enrich
from .lots import lot_progress
from .ledger import month_start_utc

router = APIRouter(tags=["reports"])

STATUSES = ["ASSIGNED", "STARTED", "DONE", "CHECKED", "APPROVED", "PAID", "CANCELLED"]


def _range(date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    """Defaults to this month. Returns UTC-naive [from, to)."""
    if date_from:
        f = as_dt(date.fromisoformat(date_from)) - timedelta(hours=5, minutes=30)  # IST midnight -> UTC
    else:
        f = month_start_utc()
    t = (as_dt(date.fromisoformat(date_to)) + timedelta(days=1) - timedelta(hours=5, minutes=30)) if date_to else now() + timedelta(days=1)
    return f, t


async def _maps(db, cid):
    lots = {l["_id"]: l async for l in db.lots.find({"company_id": cid})}
    wts = {w["_id"]: w async for w in db.work_types.find({"company_id": cid})}
    users = {u["_id"]: u async for u in db.users.find({"company_id": cid}, {"name": 1, "name_local": 1, "roles": 1})}
    return lots, wts, users


def _xlsx(title: str, rows: list[dict]) -> StreamingResponse:
    wb = Workbook()
    ws = wb.active
    ws.title = title[:30]
    if rows:
        cols = [k for k in rows[0].keys() if not isinstance(rows[0][k], (list, dict))]
        ws.append(cols)
        for c in ws[1]:
            c.font = Font(bold=True)
        for r in rows:
            ws.append([to_ist(r[k]).strftime("%d-%m-%Y %H:%M") if isinstance(r.get(k), datetime) else r.get(k)
                       for k in cols])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={title}.xlsx"})


def _respond(title, payload, format):
    return _xlsx(title, payload["rows"]) if format == "xlsx" else payload


# ---------------- dashboards ----------------
@router.get("/dashboard/supervisor")
async def supervisor_dashboard(user: dict = Depends(staff)):
    db = get_db()
    cid = user["company_id"]
    start, end = ist_day_bounds()
    today = {"$gte": start, "$lt": end}
    s = await company_settings(db, cid)
    cards = {
        "assigned_today": await db.jobs.count_documents({"company_id": cid, "assigned_at": today}),
        "done_today_waiting_check": await db.jobs.count_documents({"company_id": cid, "status": "DONE", "done_at": today}),
        "checked_today": await db.jobs.count_documents({"company_id": cid, "checked_at": today}),
        "rejected_today": await db.jobs.count_documents({"company_id": cid, "rejected_at": today}),
        "waiting_check_total": await db.jobs.count_documents({"company_id": cid, "status": "DONE"}),
        "open_jobs": await db.jobs.count_documents({"company_id": cid, "status": {"$in": ["ASSIGNED", "STARTED"]}}),
    }
    attention = []
    old_done = [j async for j in db.jobs.find({"company_id": cid, "status": "DONE",
                                               "done_at": {"$lt": now() - timedelta(hours=24)}}).limit(50)]
    if old_done:
        attention.append({"kind": "DONE_NOT_CHECKED", "count": len(old_done),
                          "text": f"{len(old_done)} jobs done over 24h ago are not checked"})
    stuck = await db.jobs.count_documents({"company_id": cid, "status": "STARTED",
                                           "started_at": {"$lt": now() - timedelta(days=3)}})
    if stuck:
        attention.append({"kind": "STARTED_TOO_LONG", "count": stuck, "text": f"{stuck} jobs started 3+ days ago"})
    active_wts = await db.work_types.count_documents({"company_id": cid, "is_active": True})
    async for l in db.lots.find({"company_id": cid, "status": {"$ne": "CLOSED"}}):
        n_rates = await db.lot_rates.count_documents({"company_id": cid, "lot_id": l["_id"]})
        if n_rates == 0:
            attention.append({"kind": "NO_RATES", "lot_id": l["_id"], "text": f"Lot {l['lot_no']} has no rates"})
        if not l.get("colours"):
            attention.append({"kind": "NO_COLOURS", "lot_id": l["_id"], "text": f"Lot {l['lot_no']} has no colour qty"})
        if l.get("target_date") and l["target_date"] - now() < timedelta(days=3):
            p = await lot_progress(db, l)
            if p["percent_done"] < 80:
                attention.append({"kind": "LOT_BEHIND", "lot_id": l["_id"],
                                  "text": f"Lot {l['lot_no']} due {to_ist(l['target_date']):%d-%b}, only {p['percent_done']}% done"})
    return {"cards": cards, "attention": attention, "active_work_types": active_wts, "settings": s}


@router.get("/dashboard/admin")
async def admin_dashboard(user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    s = await company_settings(db, cid)
    pending_status = ["CHECKED"] if s["supervisor_check_required"] else ["DONE", "CHECKED"]

    async def agg(match):
        r = [x async for x in db.jobs.aggregate([{"$match": {"company_id": cid, **match}},
                                                 {"$group": {"_id": None, "n": {"$sum": 1}, "amt": {"$sum": "$amount"}}}])]
        return {"count": r[0]["n"] if r else 0, "amount": money(r[0]["amt"]) if r else 0.0}

    paid_month = 0.0
    async for p in db.payments.find({"company_id": cid, "is_active": True, "date": {"$gte": month_start_utc()}}):
        paid_month += p["amount"]
    open_adv = 0.0
    async for a in db.advances.find({"company_id": cid, "is_active": True, "status": "OPEN"}):
        open_adv += a["amount"] - a["recovered_amount"]
    kpis = {
        "pending_approval": await agg({"status": {"$in": pending_status}}),
        "waiting_supervisor_check": await agg({"status": "DONE"}),
        "approved_unpaid": await agg({"status": "APPROVED"}),
        "paid_this_month": money(paid_month),
        "open_advances": money(open_adv),
        "active_lots": await db.lots.count_documents({"company_id": cid, "status": {"$ne": "CLOSED"}}),
        "active_workers": await db.users.count_documents({"company_id": cid, "roles": WORKER, "is_active": True}),
    }
    alerts = []
    late = await db.jobs.count_documents({"company_id": cid, "status": {"$in": pending_status},
                                          "updated_at": {"$lt": now() - timedelta(hours=48)}})
    if late:
        alerts.append({"kind": "APPROVAL_LATE", "text": f"{late} jobs waiting approval for 48h+"})
    dups = await db.audit_logs.count_documents({"company_id": cid, "action": "DUPLICATE_BLOCKED",
                                                "at": {"$gte": now() - timedelta(days=7)}})
    if dups:
        alerts.append({"kind": "DUPLICATES", "text": f"{dups} duplicate claims blocked this week"})
    no_rate_lots = 0
    async for l in db.lots.find({"company_id": cid, "status": {"$ne": "CLOSED"}}, {"_id": 1}):
        if not await db.lot_rates.count_documents({"company_id": cid, "lot_id": l["_id"]}):
            no_rate_lots += 1
    if no_rate_lots:
        alerts.append({"kind": "NO_RATES", "text": f"{no_rate_lots} open lots have no rates"})
    pending_mobile = await db.users.count_documents({"company_id": cid, "pending_mobile": True, "is_active": True})
    if pending_mobile:
        alerts.append({"kind": "PENDING_MOBILE", "text": f"{pending_mobile} workers have no mobile number yet"})
    # negative balances (advance > earnings)
    from .ledger import worker_summary
    neg = 0
    async for w in db.users.find({"company_id": cid, "roles": WORKER, "is_active": True}, {"_id": 1}):
        if (await worker_summary(db, cid, w["_id"]))["receivable"] < 0:
            neg += 1
    if neg:
        alerts.append({"kind": "NEGATIVE_BALANCE", "text": f"{neg} workers owe money (advance more than earnings)"})
    return {"kpis": kpis, "alerts": alerts}


# ---------------- R1 status board ----------------
@router.get("/reports/status-board")
async def r1_status_board(date_from: str | None = None, date_to: str | None = None, lot_id: str | None = None,
                          worker_id: str | None = None, format: str = "json", user: dict = Depends(staff)):
    db = get_db()
    cid = user["company_id"]
    f, t = _range(date_from, date_to)
    q = {"company_id": cid, "assigned_at": {"$gte": f, "$lt": t}}
    if lot_id:
        q["lot_id"] = lot_id
    if worker_id:
        q["worker_id"] = worker_id
    lots, wts, users = await _maps(db, cid)
    by_status = {s: {"count": 0, "amount": 0.0, "pieces": 0.0} for s in STATUSES}
    by_lot: dict = defaultdict(lambda: {s: 0 for s in STATUSES})
    async for j in db.jobs.find(q):
        b = by_status[j["status"]]
        b["count"] += 1
        b["amount"] = money(b["amount"] + j["amount"])
        b["pieces"] += j["pieces"]
        by_lot[j["lot_id"]][j["status"]] += 1
    rows = [{"lot_no": lots.get(k, {}).get("lot_no"), "lot_id": k, **v} for k, v in by_lot.items()]
    rows.sort(key=lambda r: str(r["lot_no"]))
    payload = {"summary": by_status, "rows": rows,
               "chart": {"type": "stacked_bar", "x": "lot_no", "series": STATUSES[:-1]}}
    return _respond("status_board", payload, format)


# ---------------- R2 lot progress ----------------
@router.get("/reports/lot-progress")
async def r2_lot_progress(status: str | None = None, format: str = "json", user: dict = Depends(staff)):
    db = get_db()
    cid = user["company_id"]
    q = {"company_id": cid}
    if status:
        q["status"] = status
    rows = []
    async for l in db.lots.find(q).sort("lot_no", 1):
        p = await lot_progress(db, l)
        days_left = (l["target_date"] - now()).days if l.get("target_date") else None
        elapsed_pct = None
        if l.get("start_date") and l.get("target_date") and l["target_date"] > l["start_date"]:
            elapsed_pct = round(100 * (now() - l["start_date"]) / (l["target_date"] - l["start_date"]), 1)
        rows.append({"lot_id": l["_id"], "lot_no": l["lot_no"], "item_name": l.get("item_name"), "status": l["status"],
                     "total_qty": l.get("total_qty"), **p, "target_date": l.get("target_date"), "days_left": days_left,
                     "behind": bool(elapsed_pct is not None and p["percent_done"] < min(elapsed_pct, 100) - 10
                                    or (days_left is not None and days_left < 0 and p["percent_done"] < 100))})
    return _respond("lot_progress", {"summary": {"lots": len(rows), "behind": sum(r["behind"] for r in rows)},
                                     "rows": rows}, format)


# ---------------- R3 worker productivity ----------------
@router.get("/reports/worker-productivity")
async def r3_productivity(date_from: str | None = None, date_to: str | None = None, worker_id: str | None = None,
                          format: str = "json", user: dict = Depends(staff)):
    db = get_db()
    cid = user["company_id"]
    f, t = _range(date_from, date_to)
    lots, wts, users = await _maps(db, cid)
    stats: dict = defaultdict(lambda: {"jobs_done": 0, "pieces": 0.0, "amount": 0.0, "days": set(), "rejections": 0})
    daily: dict = defaultdict(float)
    q = {"company_id": cid, "done_at": {"$gte": f, "$lt": t}, "status": {"$in": ["DONE", "CHECKED", "APPROVED", "PAID"]}}
    if worker_id:
        q["worker_id"] = worker_id
    async for j in db.jobs.find(q):
        s = stats[j["worker_id"]]
        s["jobs_done"] += 1
        s["pieces"] += j["pieces"]
        s["amount"] = money(s["amount"] + j["amount"])
        d = to_ist(j["done_at"]).date().isoformat()
        s["days"].add(d)
        if worker_id:
            daily[d] += j["pieces"]
    rq = {"company_id": cid, "rejected_at": {"$gte": f, "$lt": t}}
    async for j in db.jobs.find(rq):
        stats[j["worker_id"]]["rejections"] += 1
    rows = []
    for wid, s in stats.items():
        n = s["jobs_done"] + s["rejections"]
        rows.append({"worker_id": wid, "worker_name": users.get(wid, {}).get("name"), "jobs_done": s["jobs_done"],
                     "pieces": s["pieces"], "amount": s["amount"], "working_days": len(s["days"]),
                     "avg_pieces_per_day": round(s["pieces"] / len(s["days"]), 1) if s["days"] else 0,
                     "rejections": s["rejections"], "rejection_pct": round(100 * s["rejections"] / n, 1) if n else 0})
    rows.sort(key=lambda r: -r["pieces"])
    payload = {"summary": {"workers": len(rows), "pieces": sum(r["pieces"] for r in rows)}, "rows": rows}
    if worker_id:
        payload["chart"] = {"type": "line", "points": [{"date": k, "pieces": v} for k, v in sorted(daily.items())]}
    return _respond("worker_productivity", payload, format)


# ---------------- R4 ageing ----------------
@router.get("/reports/ageing")
async def r4_ageing(format: str = "json", user: dict = Depends(staff)):
    db = get_db()
    cid = user["company_id"]
    buckets = ["0-1", "2-3", "4-7", "7+"]
    summary = {s: {b: 0 for b in buckets} for s in ["ASSIGNED", "STARTED", "DONE", "CHECKED"]}
    jobs = []
    async for j in db.jobs.find({"company_id": cid, "status": {"$in": list(summary)}}):
        since = j["status_history"][-1]["at"] if j.get("status_history") else j["assigned_at"]
        age = (now() - since).days
        b = "0-1" if age <= 1 else "2-3" if age <= 3 else "4-7" if age <= 7 else "7+"
        summary[j["status"]][b] += 1
        j["age_days"], j["bucket"] = age, b
        jobs.append(j)
    jobs.sort(key=lambda j: -j["age_days"])
    rows = await enrich(db, cid, jobs[:500])
    for r, j in zip(rows, jobs[:500]):
        r.pop("status_history", None)
        r["age_days"], r["bucket"] = j["age_days"], j["bucket"]
    return _respond("ageing", {"summary": summary, "rows": rows}, format)


# ---------------- R5 timeline ----------------
@router.get("/reports/timeline")
async def r5_timeline(date_from: str | None = None, date_to: str | None = None, lot_id: str | None = None,
                      worker_id: str | None = None, event: str | None = None, limit: int = Query(300, le=2000),
                      format: str = "json", user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    f, t = _range(date_from, date_to)
    lots, wts, users = await _maps(db, cid)
    events = []
    q: dict = {"company_id": cid, "status_history.at": {"$gte": f, "$lt": t}}
    if lot_id:
        q["lot_id"] = lot_id
    if worker_id:
        q["worker_id"] = worker_id
    async for j in db.jobs.find(q):
        what = (f"Lot {lots.get(j['lot_id'], {}).get('lot_no')} {wts.get(j['work_type_id'], {}).get('code')} "
                f"{','.join(j['colour_codes'])} ({j['pieces']:g} pcs)")
        for h in j.get("status_history", []):
            if f <= h["at"] < t and (not event or h["status"] == event):
                events.append({"at": h["at"], "event": h["status"], "by": h.get("by_name"),
                               "worker": users.get(j["worker_id"], {}).get("name"), "what": what,
                               "amount": j["amount"], "job_id": j["_id"], "note": h.get("note", "")})
    if not lot_id and (not event or event in ("PAYMENT", "ADVANCE")):
        pq = {"company_id": cid, "is_active": True, "created_at": {"$gte": f, "$lt": t}}
        if worker_id:
            pq["worker_id"] = worker_id
        if event in (None, "PAYMENT"):
            async for p in db.payments.find(pq):
                events.append({"at": p["created_at"], "event": "PAYMENT", "by": users.get(p["paid_by"], {}).get("name"),
                               "worker": users.get(p["worker_id"], {}).get("name"), "what": f"{p['mode']} {p['receipt_no']}",
                               "amount": p["amount"], "note": p.get("reference_no", "")})
        if event in (None, "ADVANCE"):
            async for a in db.advances.find(pq):
                events.append({"at": a["created_at"], "event": "ADVANCE", "by": users.get(a["created_by"], {}).get("name"),
                               "worker": users.get(a["worker_id"], {}).get("name"), "what": a.get("reason", ""),
                               "amount": a["amount"], "note": a["mode"]})
    events.sort(key=lambda e: e["at"], reverse=True)
    return _respond("timeline", {"summary": {"events": len(events)}, "rows": events[:limit]}, format)


# ---------------- R6 payout register ----------------
@router.get("/reports/payout-register")
async def r6_payout_register(date_from: str | None = None, date_to: str | None = None, format: str = "json",
                             user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    f, t = _range(date_from, date_to)
    lots, wts, users = await _maps(db, cid)
    profiles = {p["user_id"]: p async for p in db.worker_profiles.find({"company_id": cid})}
    rows = []
    async for c in db.payout_cycles.find({"company_id": cid, "status": {"$ne": "DRAFT"},
                                          "to_date": {"$gte": f}, "from_date": {"$lt": t}}).sort("from_date", 1):
        for l in c["lines"]:
            rows.append({"cycle_no": c["cycle_no"], "from": c["from_date"], "to": c["to_date"],
                         "worker": users.get(l["worker_id"], {}).get("name"), "gross": l["gross"],
                         "advance_recovery": l["advance_recovery"], "deductions": l["deductions"],
                         "net_payable": l["net_payable"], "paid": l["paid_amount"], "balance": l["balance"],
                         "mode": profiles.get(l["worker_id"], {}).get("payment_mode")})
    summary = {k: money(sum(r[k] for r in rows)) for k in
               ("gross", "advance_recovery", "deductions", "net_payable", "paid", "balance")}
    return _respond("payout_register", {"summary": summary, "rows": rows}, format)


# ---------------- R8 lot labour cost ----------------
@router.get("/reports/lot-cost")
async def r8_lot_cost(status: str | None = None, format: str = "json", user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    q = {"company_id": cid}
    if status:
        q["status"] = status
    rows = []
    async for l in db.lots.find(q).sort("lot_no", 1):
        est = 0.0
        async for r in db.lot_rates.find({"company_id": cid, "lot_id": l["_id"]}):
            est += r["rate"] * (l.get("total_qty") or 0)
        approved = pending = 0.0
        async for j in db.jobs.find({"company_id": cid, "lot_id": l["_id"], "status": {"$ne": "CANCELLED"}}):
            if j["status"] in ("APPROVED", "PAID"):
                approved += j["amount"]
            elif j["status"] in ("DONE", "CHECKED"):
                pending += j["amount"]
        qty = l.get("total_qty") or 0
        rows.append({"lot_id": l["_id"], "lot_no": l["lot_no"], "item_name": l.get("item_name"), "status": l["status"],
                     "pieces": qty, "estimated_cost": money(est), "approved_cost": money(approved),
                     "pending_cost": money(pending), "estimated_cost_per_piece": money(est / qty) if qty else 0,
                     "actual_cost_per_piece": money(approved / qty) if qty else 0,
                     "variance": money(approved + pending - est)})
    summary = {"estimated": money(sum(r["estimated_cost"] for r in rows)),
               "approved": money(sum(r["approved_cost"] for r in rows)),
               "pieces": sum(r["pieces"] for r in rows)}
    return _respond("lot_cost", {"summary": summary, "rows": rows}, format)


# ---------------- R9 work type cost ----------------
@router.get("/reports/work-type-cost")
async def r9_work_type_cost(date_from: str | None = None, date_to: str | None = None, format: str = "json",
                            user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    f, t = _range(date_from, date_to)
    lots, wts, users = await _maps(db, cid)
    agg: dict = defaultdict(lambda: {"pieces": 0.0, "amount": 0.0})
    async for j in db.jobs.find({"company_id": cid, "status": {"$in": ["APPROVED", "PAID"]},
                                 "approved_at": {"$gte": f, "$lt": t}}):
        a = agg[j["work_type_id"]]
        a["pieces"] += j["pieces"]
        a["amount"] += j["amount"]
    rates: dict = defaultdict(list)
    async for r in db.lot_rates.find({"company_id": cid}):
        rates[r["work_type_id"]].append({"lot_no": lots.get(r["lot_id"], {}).get("lot_no"), "rate": r["rate"]})
    rows = []
    for wid, w in wts.items():
        a, rs = agg.get(wid, {"pieces": 0, "amount": 0}), rates.get(wid, [])
        if not a["pieces"] and not rs:
            continue
        vals = [r["rate"] for r in rs]
        rows.append({"work_type_id": wid, "code": w["code"], "pieces": a["pieces"], "amount": money(a["amount"]),
                     "avg_rate": money(a["amount"] / a["pieces"]) if a["pieces"] else None,
                     "min_rate": min(vals) if vals else None, "max_rate": max(vals) if vals else None,
                     "rate_trend": sorted(rs, key=lambda r: str(r["lot_no"]))})
    rows.sort(key=lambda r: -r["amount"])
    return _respond("work_type_cost", {"summary": {"amount": money(sum(r["amount"] for r in rows))}, "rows": rows},
                    format)


# ---------------- R10 monthly summary ----------------
@router.get("/reports/monthly-summary")
async def r10_monthly(months: int = Query(12, le=36), format: str = "json", user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    lots, wts, users = await _maps(db, cid)
    by_month: dict = defaultdict(lambda: {"amount": 0.0, "workers": defaultdict(float), "wt": defaultdict(float)})
    since = now() - timedelta(days=31 * months)
    async for j in db.jobs.find({"company_id": cid, "status": {"$in": ["APPROVED", "PAID"]},
                                 "approved_at": {"$gte": since}}):
        m = to_ist(j.get("work_month") or j["approved_at"]).strftime("%Y-%m")
        b = by_month[m]
        b["amount"] += j["amount"]
        b["workers"][j["worker_id"]] += j["amount"]
        b["wt"][wts.get(j["work_type_id"], {}).get("code", "?")] += j["amount"]
    rows = []
    for m in sorted(by_month):
        b = by_month[m]
        top = sorted(b["workers"].items(), key=lambda x: -x[1])[:5]
        rows.append({"month": m, "labour_cost": money(b["amount"]), "workers_paid": len(b["workers"]),
                     "avg_per_worker": money(b["amount"] / len(b["workers"])) if b["workers"] else 0,
                     "top_earners": [{"name": users.get(w, {}).get("name"), "amount": money(a)} for w, a in top],
                     "by_work_type": {k: money(v) for k, v in sorted(b["wt"].items(), key=lambda x: -x[1])}})
    return _respond("monthly_summary", {"summary": {"months": len(rows)}, "rows": rows}, format)


# ---------------- R11 exceptions ----------------
@router.get("/reports/exceptions")
async def r11_exceptions(date_from: str | None = None, date_to: str | None = None, format: str = "json",
                         user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    f, t = _range(date_from, date_to)
    s = await company_settings(db, cid)
    lots, wts, users = await _maps(db, cid)
    rows = []
    async for a in db.audit_logs.find({"company_id": cid, "at": {"$gte": f, "$lt": t},
                                       "$or": [{"action": {"$in": ["EDIT", "DUPLICATE_BLOCKED", "VOID"]}},
                                               {"entity": "lot_rate", "action": "UPDATE"},
                                               {"entity": "job", "action": "ASSIGNED",
                                                "new_value.rejected_reason": {"$exists": True}}]}).sort("at", -1):
        kind = {"EDIT": "ADMIN_EDIT", "DUPLICATE_BLOCKED": "DUPLICATE_BLOCKED", "VOID": "VOIDED"}.get(
            a["action"], "RATE_CHANGE" if a["entity"] == "lot_rate" else "REJECTED")
        nv = a.get("new_value") or {}
        rows.append({"at": a["at"], "kind": kind, "by": a.get("user_name"), "entity": a["entity"],
                     "detail": (nv.get("detail", {}).get("message") if isinstance(nv.get("detail"), dict) else None)
                               or nv.get("reason") or nv.get("rejected_reason") or nv.get("override_reason") or "",
                     "old": str(a.get("old_value"))[:120], "new": str({k: v for k, v in nv.items()
                                                                        if k not in ("detail",)})[:160]})
    async for j in db.jobs.find({"company_id": cid, "done_on_behalf": True, "done_at": {"$gte": f, "$lt": t}}):
        rows.append({"at": j["done_at"], "kind": "DONE_BY_SUPERVISOR", "by": users.get(j.get("done_by"), {}).get("name"),
                     "entity": "job", "detail": f"{j['job_no']} for {users.get(j['worker_id'], {}).get('name')}",
                     "old": "", "new": ""})
    async for a in db.advances.find({"company_id": cid, "is_active": True, "amount": {"$gt": s["advance_alert_above"]},
                                     "created_at": {"$gte": f, "$lt": t}}):
        rows.append({"at": a["created_at"], "kind": "BIG_ADVANCE", "by": users.get(a["created_by"], {}).get("name"),
                     "entity": "advance", "detail": f"{users.get(a['worker_id'], {}).get('name')} ₹{a['amount']:.2f}",
                     "old": "", "new": ""})
    rows.sort(key=lambda r: r["at"], reverse=True)
    counts: dict = defaultdict(int)
    for r in rows:
        counts[r["kind"]] += 1
    return _respond("exceptions", {"summary": dict(counts), "rows": rows}, format)


# ---------------- worker monthly ----------------
@router.get("/reports/my-month")
async def my_month(worker_id: str | None = None, user: dict = Depends(anyone)):
    """Worker card: pieces + Rs this month, split by week."""
    db = get_db()
    wid = worker_id if (worker_id and has(user, SUPERVISOR, ADMIN)) else user["_id"]
    weeks: dict = defaultdict(lambda: {"pieces": 0.0, "amount": 0.0})
    async for j in db.jobs.find({"company_id": user["company_id"], "worker_id": wid,
                                 "status": {"$in": ["DONE", "CHECKED", "APPROVED", "PAID"]},
                                 "done_at": {"$gte": month_start_utc()}}):
        wk = f"W{(to_ist(j['done_at']).day - 1) // 7 + 1}"
        weeks[wk]["pieces"] += j["pieces"]
        weeks[wk]["amount"] = money(weeks[wk]["amount"] + j["amount"])
    return {"weeks": [{"week": k, **v} for k, v in sorted(weeks.items())],
            "pieces": sum(v["pieces"] for v in weeks.values()),
            "amount": money(sum(v["amount"] for v in weeks.values()))}


# ---------------- notifications + audit ----------------
@router.get("/notifications")
async def my_notifications(unread_only: bool = False, user: dict = Depends(anyone)):
    q = {"company_id": user["company_id"], "user_id": user["_id"]}
    if unread_only:
        q["read"] = False
    items = outs([n async for n in get_db().notifications.find(q).sort("at", -1).limit(100)])
    unread = await get_db().notifications.count_documents({**q, "read": False})
    return {"items": items, "unread": unread}


@router.post("/notifications/read-all")
async def read_all(user: dict = Depends(anyone)):
    await get_db().notifications.update_many({"company_id": user["company_id"], "user_id": user["_id"]},
                                             {"$set": {"read": True}})
    return {"ok": True}


@router.get("/audit-logs")
async def audit_logs(entity: str | None = None, user_id: str | None = None, entity_id: str | None = None,
                     date_from: str | None = None, date_to: str | None = None, limit: int = Query(200, le=1000),
                     user: dict = Depends(admin_only)):
    f, t = _range(date_from, date_to) if (date_from or date_to) else (datetime(2000, 1, 1), now() + timedelta(days=1))
    q = {"company_id": user["company_id"], "at": {"$gte": f, "$lt": t}}
    if entity:
        q["entity"] = entity
    if user_id:
        q["user_id"] = user_id
    if entity_id:
        q["entity_id"] = entity_id
    return outs([a async for a in get_db().audit_logs.find(q).sort("at", -1).limit(limit)])
