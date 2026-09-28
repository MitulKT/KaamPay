"""Excel import wizard: preview (dry run) -> commit (with choices) -> undo."""
import io
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..audit import audit
from ..db import get_db
from ..importer import parse_workbook
from ..payout import job_amount
from ..security import WORKER, admin_only
from ..utils import money, new_id, next_number, now, out

router = APIRouter(prefix="/import", tags=["import"])

IMPORT_COLLECTIONS = ["users", "worker_profiles", "work_types", "lots", "lot_rates", "jobs", "job_coverage",
                      "payments", "advances", "payout_cycles"]


class CommitIn(BaseModel):
    # months strictly before this (YYYY-MM) are already settled -> jobs PAID via an opening settlement
    settled_before_month: str | None = None
    duplicate_policy: Literal["KEEP_FIRST", "KEEP_ALL", "SKIP_ALL"] = "KEEP_FIRST"
    # manual choices per duplicate group index: list of line indexes to keep
    duplicate_choices: dict[str, list[int]] = {}
    # payment sheet name -> worker key (e.g. "GULAM"); None/"" = skip that row
    name_matches: dict[str, str | None] = {}
    payment_rows_as: Literal["ADVANCE", "PAYMENT"] = "ADVANCE"
    skip_lines_without_rate: bool = False


def _clean_report(rep: dict) -> dict:
    """Trim the big job_lines list for the API response."""
    r = {k: v for k, v in rep.items() if k not in ("job_lines", "colour_qty")}
    r["sample_lines"] = [{k: v for k, v in l.items() if k not in ("timestamp",)} for l in rep["job_lines"][:50]]
    r["flagged_lines"] = [l for l in rep["job_lines"] if l["flags"]][:200]
    r["duplicates"] = [{**g, "lines": [{k: rep["job_lines"][i][k] for k in
                                         ("index", "worker", "lot", "work_type", "colours", "row", "amount")}
                                        for i in g["line_indexes"]]} for g in rep["duplicates"]]
    return r


@router.post("/preview")
async def preview(file: UploadFile = File(...), user: dict = Depends(admin_only)):
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 15 MB)")
    try:
        rep = parse_workbook(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not read the Excel file: {e}")
    sid = new_id()
    # keep parsed data server-side so commit doesn't need the file again
    store = {**rep, "lots": rep["lots"], "colour_qty": rep["colour_qty"]}
    for l in store["job_lines"]:
        l["timestamp"] = l["timestamp"] or None
    await get_db().import_sessions.insert_one({"_id": sid, "company_id": user["company_id"], "file_name": file.filename,
                                               "report": store, "created_at": now(), "created_by": user["_id"],
                                               "status": "PREVIEW"})
    return {"session_id": sid, **_clean_report(rep)}


@router.post("/{session_id}/commit")
async def commit(session_id: str, body: CommitIn, user: dict = Depends(admin_only)):
    db = get_db()
    cid = user["company_id"]
    sess = await db.import_sessions.find_one({"_id": session_id, "company_id": cid})
    if not sess:
        raise HTTPException(404, "Import session not found")
    if sess["status"] != "PREVIEW":
        raise HTTPException(409, "Already imported")
    rep = sess["report"]
    batch = session_id
    tag = {"source": "excel_import", "import_batch": batch}
    t = now()
    counts = defaultdict(int)

    # ---- work types
    wt_ids = {w["code"]: w["_id"] async for w in db.work_types.find({"company_id": cid})}
    seq = await db.work_types.count_documents({"company_id": cid})
    for w in rep["work_types"]:
        if w["code"] not in wt_ids:
            seq += 1
            _id = new_id()
            await db.work_types.insert_one({"_id": _id, "company_id": cid, "code": w["code"], "name_en": w["code"].title(),
                                            "name_hi": w["name_local"], "name_gu": "", "icon": "scissors",
                                            "sequence_no": seq, "is_active": True, "created_at": t, **tag})
            wt_ids[w["code"]] = _id
            counts["work_types"] += 1

    # ---- workers (no mobile in sheet -> pending_mobile)
    worker_ids = {}
    existing = {u["name"].upper(): u["_id"] async for u in db.users.find({"company_id": cid, "roles": WORKER})}
    for w in rep["workers"]:
        if w["key"] in existing:
            worker_ids[w["key"]] = existing[w["key"]]
            continue
        _id = new_id()
        await db.users.insert_one({"_id": _id, "company_id": cid, "name": w["name"], "name_local": w["name_local"],
                                   "mobile": f"pending-{_id[:10]}", "pending_mobile": True, "roles": [WORKER],
                                   "preferred_language": "hi", "is_active": True, "session_version": 0,
                                   "created_at": t, **tag})
        n = await next_number(db, cid, "worker")
        await db.worker_profiles.insert_one({"_id": new_id(), "company_id": cid, "user_id": _id,
                                             "worker_code": f"W{n:03d}", "payment_mode": "CASH",
                                             "skill_work_type_ids": [], **tag})
        worker_ids[w["key"]] = _id
        counts["workers"] += 1

    # ---- lots + colours
    lot_docs = {l["lot_no"]: l async for l in db.lots.find({"company_id": cid})}
    for lot_no in rep["lots"]:
        qty = rep["colour_qty"].get(lot_no, {})
        colours = [{"code": c, "name": "", "qty": q} for c, q in sorted(qty.items())]
        if lot_no in lot_docs:
            if not lot_docs[lot_no].get("colours") and colours:
                await db.lots.update_one({"_id": lot_docs[lot_no]["_id"]},
                                         {"$set": {"colours": colours, "total_qty": sum(qty.values())}})
                lot_docs[lot_no]["colours"] = colours
            continue
        doc = {"_id": new_id(), "company_id": cid, "lot_no": lot_no, "item_name": "", "style_id": None,
               "colours": colours, "total_qty": money(sum(qty.values())), "start_date": None, "target_date": None,
               "status": "IN_PRODUCTION", "remarks": "", "created_at": t, **tag}
        await db.lots.insert_one(doc)
        lot_docs[lot_no] = doc
        counts["lots"] += 1

    # ---- rates
    have = {(r["lot_id"], r["work_type_id"]) async for r in
            db.lot_rates.find({"company_id": cid}, {"lot_id": 1, "work_type_id": 1})}
    for r in rep["rates"]:
        lot, wt = lot_docs.get(r["lot"]), wt_ids.get(r["work_type"])
        if not lot or not wt or (lot["_id"], wt) in have:
            continue
        await db.lot_rates.insert_one({"_id": new_id(), "company_id": cid, "lot_id": lot["_id"], "work_type_id": wt,
                                       "rate": r["rate"], "is_locked": False, "effective_from": t, "created_at": t, **tag})
        have.add((lot["_id"], wt))
        counts["rates"] += 1

    # ---- decide which job lines to keep
    lines = rep["job_lines"]
    drop = set()
    for gi, g in enumerate(rep["duplicates"]):
        idxs = g["line_indexes"]
        if str(gi) in body.duplicate_choices:
            keep = set(body.duplicate_choices[str(gi)])
            drop |= set(idxs) - keep
        elif body.duplicate_policy == "KEEP_FIRST":
            drop |= set(sorted(idxs, key=lambda i: (lines[i]["timestamp"] or datetime.max, i))[1:])
        elif body.duplicate_policy == "SKIP_ALL":
            drop |= set(idxs)
    if body.skip_lines_without_rate:
        drop |= {l["index"] for l in lines if l["rate"] is None}

    # ---- jobs
    cutoff = body.settled_before_month
    settled: dict = defaultdict(lambda: defaultdict(list))  # month -> worker -> [job]
    for l in lines:
        if l["index"] in drop:
            counts["lines_skipped"] += 1
            continue
        lot, wt, wid = lot_docs.get(l["lot"]), wt_ids.get(l["work_type"]), worker_ids.get(l["worker"])
        if not (lot and wt and wid):
            counts["lines_unresolved"] += 1
            continue
        month = l["month"] or l["timestamp"] or t
        month_key = month.strftime("%Y-%m")
        is_settled = bool(cutoff and month_key < cutoff)
        n = await next_number(db, cid, "job")
        rate = l["rate"] or 0.0
        done_at = l["timestamp"] or month
        job = {"_id": new_id(), "company_id": cid, "job_no": f"J-{n:06d}", "lot_id": lot["_id"], "work_type_id": wt,
               "worker_id": wid, "colour_codes": l["colours"], "split_pieces": None, "pieces": l["pieces"],
               "rate_snapshot": rate, "amount": job_amount(l["pieces"], rate), "status": "PAID" if is_settled else "APPROVED",
               "assigned_by": user["_id"], "assigned_at": done_at, "done_at": done_at, "checked_at": done_at,
               "approved_at": month, "approved_by": user["_id"], "work_month": month, "reject_count": 0,
               "import_flags": l["flags"], "payout_cycle_id": None, "created_at": t, "updated_at": t,
               "status_history": [{"status": "APPROVED", "by": user["_id"], "by_name": "Excel import", "at": done_at,
                                   "note": f"{l['sheet']} row {l['row']}"}], **tag}
        await db.jobs.insert_one(job)
        counts["jobs"] += 1
        # reserve cells so the same work can't be claimed again in the app; kept duplicates just skip reservation
        codes = sorted(c["code"] for c in lot.get("colours", [])) if l["colours"] == ["ALL"] else l["colours"]
        for c in codes:
            try:
                await db.job_coverage.insert_one({"_id": new_id(), "company_id": cid, "lot_id": lot["_id"],
                                                  "work_type_id": wt, "colour_code": c, "slot": "FULL",
                                                  "job_id": job["_id"], "worker_id": wid, **tag})
            except Exception:
                pass
        if is_settled:
            settled[month_key][wid].append(job)

    # ---- opening settlements for already-paid months: one PAID cycle per month so ledgers start at zero
    for month_key, by_worker in sorted(settled.items()):
        y, m = map(int, month_key.split("-"))
        start = datetime(y, m, 1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        cyc_id = new_id()
        lines_doc = []
        for wid, jobs in by_worker.items():
            gross = money(sum(j["amount"] for j in jobs))
            n = await next_number(db, cid, "receipt")
            await db.payments.insert_one({"_id": new_id(), "company_id": cid, "worker_id": wid, "payout_cycle_id": cyc_id,
                                          "amount": gross, "date": end, "mode": "CASH",
                                          "reference_no": "Opening settlement (Excel import)", "paid_by": user["_id"],
                                          "receipt_no": f"RCP-{n:05d}", "is_active": True, "created_at": t, **tag})
            await db.jobs.update_many({"_id": {"$in": [j["_id"] for j in jobs]}},
                                      {"$set": {"payout_cycle_id": cyc_id, "paid_at": end}})
            lines_doc.append({"worker_id": wid, "gross": gross, "advance_recovery": 0.0, "deductions": 0.0,
                              "net_payable": gross, "paid_amount": gross, "balance": 0.0,
                              "job_ids": [j["_id"] for j in jobs], "deduction_ids": [], "excluded": False,
                              "recovery_overridden": False})
        n = await next_number(db, cid, "cycle")
        await db.payout_cycles.insert_one({"_id": cyc_id, "company_id": cid, "cycle_no": f"PC-{n:04d}",
                                           "period_type": "MONTHLY", "from_date": start, "to_date": end,
                                           "status": "PAID", "lines": lines_doc, "excluded_job_ids": [],
                                           "created_by": user["_id"], "created_at": t, "note": "Opening settlement",
                                           **tag})
        counts["opening_cycles"] += 1

    # ---- payment sheet rows
    for p in rep["payments"]:
        key = body.name_matches.get(p["name"], rep["name_matches"].get(p["name"], {}).get("proposed_worker"))
        wid = worker_ids.get(key) if key else None
        if not wid:
            counts["payments_skipped"] += 1
            continue
        month_key = (p["month"] or p["date"] or t).strftime("%Y-%m")
        if cutoff and month_key < cutoff:
            counts["payments_in_settled_months_skipped"] += 1
            continue
        if body.payment_rows_as == "ADVANCE":
            n = await next_number(db, cid, "advance")
            await db.advances.insert_one({"_id": new_id(), "company_id": cid, "worker_id": wid, "amount": p["amount"],
                                          "date": p["date"] or t, "mode": "CASH", "reason": "Excel import",
                                          "recovered_amount": 0.0, "status": "OPEN", "receipt_no": f"ADV-{n:05d}",
                                          "is_active": True, "created_at": t, "created_by": user["_id"], **tag})
            counts["advances"] += 1
        else:
            n = await next_number(db, cid, "receipt")
            await db.payments.insert_one({"_id": new_id(), "company_id": cid, "worker_id": wid, "payout_cycle_id": None,
                                          "amount": p["amount"], "date": p["date"] or t, "mode": "CASH",
                                          "reference_no": "Excel import", "paid_by": user["_id"],
                                          "receipt_no": f"RCP-{n:05d}", "is_active": True, "created_at": t, **tag})
            counts["payments"] += 1

    # ---- totals by month for tick-off against Excel
    by_month = defaultdict(float)
    async for j in db.jobs.find({"company_id": cid, "import_batch": batch}):
        by_month[j["work_month"].strftime("%Y-%m")] += j["amount"]
    await db.import_sessions.update_one({"_id": session_id}, {"$set": {"status": "IMPORTED", "imported_at": now(),
                                                                       "options": body.model_dump(),
                                                                       "counts": dict(counts)}})
    await audit(db, user, "import", batch, "IMPORT", new=dict(counts))
    return {"batch_id": batch, "counts": dict(counts),
            "amount_by_month": {k: money(v) for k, v in sorted(by_month.items())}}


@router.delete("/{batch_id}")
async def undo_import(batch_id: str, user: dict = Depends(admin_only)):
    """Removes everything that import created. Refuses if app activity already happened on imported jobs."""
    db = get_db()
    cid = user["company_id"]
    sess = await db.import_sessions.find_one({"_id": batch_id, "company_id": cid})
    if not sess or sess["status"] != "IMPORTED":
        raise HTTPException(404, "Import batch not found")
    touched = await db.jobs.count_documents({"company_id": cid, "import_batch": batch_id,
                                             "payout_cycle_id": {"$ne": None}, "status": "PAID",
                                             "paid_at": {"$gt": sess["imported_at"]}})
    if touched:
        raise HTTPException(409, "Some imported jobs were paid in the app after import; can't undo automatically")
    removed = {}
    for coll in IMPORT_COLLECTIONS:
        res = await db[coll].delete_many({"company_id": cid, "import_batch": batch_id})
        removed[coll] = res.deleted_count
    await db.import_sessions.update_one({"_id": batch_id}, {"$set": {"status": "UNDONE"}})
    await audit(db, user, "import", batch_id, "UNDO", new=removed)
    return {"removed": removed}


@router.get("")
async def list_imports(user: dict = Depends(admin_only)):
    res = []
    async for s in get_db().import_sessions.find({"company_id": user["company_id"]}, {"report": 0}).sort("created_at", -1):
        res.append(out(s))
    return res
