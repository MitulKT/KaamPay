"""Imports the real sample workbook the manufacturer shared."""
import pytest

from app.importer import parse_workbook

from .conftest import SAMPLE


def test_parse_sample_workbook():
    rep = parse_workbook(SAMPLE)
    s = rep["summary"]
    print(s)
    assert s["workers"] >= 31
    assert s["work_types"] == 27
    assert s["lots"] >= 37
    assert s["job_lines"] > 1000
    assert s["amount_by_month"]["2026-08"] == 501684.0
    assert s["duplicate_groups"] > 50 and s["cross_worker_duplicates"] >= 5
    assert s["lines_missing_rate"] > 0
    # the worked example: Suraj lot 128 colour A FRONT = 77 x 14.5
    l = next(l for l in rep["job_lines"] if l["worker"] == "SURAJ" and l["lot"] == "128" and l["work_type"] == "FRONT")
    assert l["pieces"] == 77 and l["rate"] == 14.5 and l["amount"] == 1116.5
    assert rep["name_matches"]["Gulam"]["proposed_worker"] == "GULAM"


async def test_import_commit_and_undo(admin, db):
    with open(SAMPLE, "rb") as f:
        r = await admin.post("/import/preview", files={"file": ("sample.xlsx", f.read(),
                             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    prev = r.json()
    sid = prev["session_id"]
    r = await admin.post(f"/import/{sid}/commit", {"settled_before_month": "2026-08", "duplicate_policy": "KEEP_FIRST"})
    assert r.status_code == 200, r.text
    res = r.json()
    print(res)
    assert res["counts"]["jobs"] > 900 and res["counts"]["lines_skipped"] > 0
    assert res["counts"]["opening_cycles"] >= 3
    # settled months -> PAID with opening settlement; Aug/Sep -> APPROVED, ready for a payout cycle
    assert await db.jobs.count_documents({"status": "PAID"}) > 0
    assert await db.jobs.count_documents({"status": "APPROVED"}) > 0
    # a worker's ledger for a settled month nets to zero; open months show receivable
    d = (await admin.get("/dashboard/admin")).json()
    assert d["kpis"]["approved_unpaid"]["amount"] > 100000
    assert any(a["kind"] == "PENDING_MOBILE" for a in d["alerts"])
    m = (await admin.get("/reports/monthly-summary")).json()
    assert len(m["rows"]) >= 4
    # undo removes everything
    r = await admin.delete(f"/import/{sid}")
    assert r.status_code == 200
    assert await db.jobs.count_documents({}) == 0
    assert await db.lots.count_documents({}) == 0
