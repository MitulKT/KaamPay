"""End-to-end: setup -> assign -> done -> check -> approve -> cycle -> pay, plus roles, duplicates and edge cases."""
import pytest

from .conftest import login

pytestmark = pytest.mark.asyncio


async def setup_factory(admin, client):
    r = await admin.post("/work-types/seed-defaults")
    assert r.json()["added"] == 27
    wts = {w["code"]: w["id"] for w in (await admin.get("/work-types")).json()}
    r = await admin.post("/users", {"name": "Ramesh", "mobile": "9000000002", "roles": ["SUPERVISOR"]})
    assert r.status_code == 200, r.text
    suraj = (await admin.post("/users", {"name": "Suraj", "name_local": "सूरज", "mobile": "9000000011",
                                         "roles": ["WORKER"], "payment_mode": "UPI", "upi_id": "suraj@upi"})).json()
    rachna = (await admin.post("/users", {"name": "Rachna", "mobile": "9000000012", "roles": ["WORKER"]})).json()
    sup = await login(client, "9000000002")
    w_suraj = await login(client, "9000000011")
    w_rachna = await login(client, "9000000012")
    lot = (await sup.post("/lots", {"lot_no": 128, "item_name": "Cargo trouser", "colours": [
        {"code": "A", "qty": 77}, {"code": "B", "qty": 70}, {"code": "C", "qty": 53}]})).json()
    assert lot["total_qty"] == 200 and lot["lot_no"] == "128"
    r = await sup.put(f"/lots/{lot['id']}/rates", {"rates": [{"work_type_id": wts["FRONT"], "rate": 14.5},
                                                            {"work_type_id": wts["BACK"], "rate": 25},
                                                            {"work_type_id": wts["ZIPPER"], "rate": 3}]})
    assert r.status_code == 200
    return dict(wts=wts, suraj=suraj, rachna=rachna, sup=sup, w_suraj=w_suraj, w_rachna=w_rachna, lot=lot)


async def test_full_payout_flow(admin, client):
    s = await setup_factory(admin, client)
    sup, wts, lot = s["sup"], s["wts"], s["lot"]

    # assign FRONT + BACK colour A to Suraj -> 2 jobs, 1116.50 + 1925
    r = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["FRONT"], wts["BACK"]], "colour_codes": ["a"]})
    assert r.status_code == 200, r.text
    jobs = r.json()["jobs"]
    assert sorted(j["amount"] for j in jobs) == [1116.5, 1925.0]
    assert r.json()["total_amount"] == 3041.5

    # double claim: Rachna on FRONT A -> blocked, names the holder
    r = await sup.post("/jobs/assign", {"worker_id": s["rachna"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["FRONT"]], "colour_codes": ["A"]})
    assert r.status_code == 409 and "Suraj" in r.json()["detail"]["message"]
    # ALL overlaps A -> blocked too
    r = await sup.post("/jobs/assign", {"worker_id": s["rachna"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["FRONT"]], "colour_codes": ["ALL"]})
    assert r.status_code == 409
    # availability greys out A for FRONT
    av = (await sup.get("/jobs/availability", params={"lot_id": lot["id"], "work_type_id": wts["FRONT"]})).json()
    assert av[0]["code"] == "A" and av[0]["taken_by"][0]["worker_name"] == "Suraj" and not av[1]["taken_by"]
    # missing rate
    r = await sup.post("/jobs/assign", {"worker_id": s["rachna"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["CUTTING"]], "colour_codes": ["B"]})
    assert r.status_code == 400 and "Rate not set" in r.json()["detail"]

    # split: ZIPPER colour B 70 pcs -> 40 Rachna + 30 Suraj; 1 more piece is refused
    r = await sup.post("/jobs/assign", {"worker_id": s["rachna"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["ZIPPER"]], "colour_codes": ["B"], "split_pieces": 40})
    assert r.status_code == 200 and r.json()["jobs"][0]["amount"] == 120
    r = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["ZIPPER"]], "colour_codes": ["B"], "split_pieces": 31})
    assert r.status_code == 409
    r = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["ZIPPER"]], "colour_codes": ["B"], "split_pieces": 30})
    assert r.status_code == 200

    # worker sees only own jobs; can't approve / check
    w = s["w_suraj"]
    mine = (await w.get("/jobs")).json()
    assert len(mine) == 3 and all(j["worker_id"] == s["suraj"]["id"] for j in mine)
    front = next(j for j in mine if j["work_type_code"] == "FRONT")
    back = next(j for j in mine if j["work_type_code"] == "BACK")
    assert (await w.post(f"/jobs/{front['id']}/approve")).status_code == 403
    assert (await w.post(f"/jobs/{front['id']}/check")).status_code == 403
    rachna_job = (await s["w_rachna"].get("/jobs")).json()[0]
    assert (await w.post(f"/jobs/{rachna_job['id']}/done")).status_code == 404  # can't touch others' jobs
    assert (await w.get(f"/workers/{s['rachna']['id']}/summary")).status_code == 403

    # done -> undo within 10 min -> done again
    assert (await w.post(f"/jobs/{front['id']}/done", {"note": ""})).json()["status"] == "DONE"
    assert (await w.post(f"/jobs/{front['id']}/undo-done")).json()["status"] == "ASSIGNED"
    r = await client.post("/jobs-bulk/done", json={"job_ids": [front["id"], back["id"]]}, headers=w.h)
    assert r.json()["ok"] == [front["id"], back["id"]]

    # admin can't approve before supervisor check (setting ON)
    assert (await admin.post(f"/jobs/{front['id']}/approve")).status_code == 409
    # supervisor rejects BACK, worker gets notification, job back to ASSIGNED
    r = await sup.post(f"/jobs/{back['id']}/reject", {"reason": "QUALITY", "note": "stitch loose"})
    assert r.json()["status"] == "ASSIGNED" and r.json()["reject_count"] == 1
    notes = (await w.get("/notifications")).json()
    assert any(n["kind"] == "JOB_REJECTED" for n in notes["items"])
    assert (await w.post(f"/jobs/{back['id']}/done")).status_code == 200
    r = await client.post("/jobs-bulk/check", json={"job_ids": [front["id"], back["id"]]}, headers=sup.h)
    assert len(r.json()["ok"]) == 2
    # supervisor can't approve
    assert (await sup.post(f"/jobs/{front['id']}/approve")).status_code == 403
    summary = (await w.get(f"/workers/{s['suraj']['id']}/summary")).json()
    assert summary["pending_approval"] == 3041.5 and summary["receivable"] == 0

    r = await client.post("/jobs-bulk/approve", json={"job_ids": [front["id"], back["id"]]}, headers=admin.h)
    assert r.json()["total_amount"] == 3041.5

    # rate change after approval: approved job stays frozen; open ZIPPER job picks up new rate
    r = await sup.put(f"/lots/{lot['id']}/rates", {"rates": [{"work_type_id": wts["FRONT"], "rate": 20}]})
    assert r.status_code == 400  # jobs use it -> reason required
    r = await sup.put(f"/lots/{lot['id']}/rates", {"rates": [{"work_type_id": wts["FRONT"], "rate": 20}],
                                                   "reason": "new season"})
    assert r.status_code == 200
    assert (await admin.get(f"/jobs/{front['id']}")).json()["amount"] == 1116.5
    # admin locks rates -> supervisor can't change
    await admin.post(f"/lots/{lot['id']}/rates/lock")
    r = await sup.put(f"/lots/{lot['id']}/rates", {"rates": [{"work_type_id": wts["FRONT"], "rate": 21}],
                                                   "reason": "x"})
    assert r.status_code == 403

    # advance 2000 -> cycle recovers min(2000, 50% of 3041.5=1520.75)
    r = await admin.post("/advances", {"worker_id": s["suraj"]["id"], "amount": 2000, "mode": "CASH"})
    assert r.json()["receivable_after"] == 1041.5
    period = (await admin.get("/payouts/suggest-period")).json()
    cyc = (await admin.post("/payouts/cycles", {"from_date": period["from_date"], "to_date": period["to_date"]})).json()
    line = next(l for l in cyc["lines"] if l["worker_id"] == s["suraj"]["id"])
    assert line["gross"] == 3041.5 and line["advance_recovery"] == 1520.75 and line["net_payable"] == 1520.75
    # admin overrides recovery to 1000
    cyc = (await admin.patch(f"/payouts/cycles/{cyc['id']}/lines/{s['suraj']['id']}", {"advance_recovery": 1000})).json()
    line = next(l for l in cyc["lines"] if l["worker_id"] == s["suraj"]["id"])
    assert line["net_payable"] == 2041.5
    # can't pay a draft
    r = await admin.post("/payments", {"worker_id": s["suraj"]["id"], "amount": 100, "payout_cycle_id": cyc["id"]})
    assert r.status_code == 409
    cyc = (await admin.post(f"/payouts/cycles/{cyc['id']}/lock")).json()
    assert cyc["status"] == "LOCKED"
    adv = (await admin.get("/advances", params={"worker_id": s["suraj"]["id"]})).json()[0]
    assert adv["recovered_amount"] == 1000 and adv["status"] == "OPEN"

    # partial pay 1000, then the rest
    r = await admin.post("/payments", {"worker_id": s["suraj"]["id"], "amount": 1000, "mode": "UPI",
                                       "payout_cycle_id": cyc["id"]})
    assert r.status_code == 200 and r.json()["receipt_no"].startswith("RCP-")
    assert (await admin.get(f"/jobs/{front['id']}")).json()["status"] == "APPROVED"
    # overpay refused
    r = await admin.post("/payments", {"worker_id": s["suraj"]["id"], "amount": 5000, "payout_cycle_id": cyc["id"]})
    assert r.status_code == 400
    r = await admin.post(f"/payouts/cycles/{cyc['id']}/pay-all", {"mode": "UPI"})
    assert r.json()["total"] == 1041.5
    assert (await admin.get(f"/jobs/{front['id']}")).json()["status"] == "PAID"
    assert (await admin.get(f"/payouts/cycles/{cyc['id']}")).json()["status"] == "PAID"

    # worker money: balance = 3041.5 - 2000 advance - 2041.5 paid = -1000 (advance still to recover)
    summ = (await w.get(f"/workers/{s['suraj']['id']}/summary")).json()
    assert summ["receivable"] == -1000 and summ["advance_open"] == 1000
    ledger = (await w.get(f"/workers/{s['suraj']['id']}/ledger")).json()
    assert ledger["closing_balance"] == -1000
    sett = (await w.get(f"/workers/{s['suraj']['id']}/settlements")).json()
    assert sett["settlements"][0]["paid_amount"] == 2041.5 and len(sett["settlements"][0]["payments"]) == 2
    slip = await w.get(f"/payouts/cycles/{cyc['id']}/slip/{s['suraj']['id']}")
    assert slip.status_code == 200 and "₹3,041.50" in slip.text and "Demo Garments" in slip.text
    # rachna can't open suraj's slip
    assert (await s["w_rachna"].get(f"/payouts/cycles/{cyc['id']}/slip/{s['suraj']['id']}")).status_code == 403

    # duplicate payment warning (same worker, amount, day)
    await admin.post("/payments", {"worker_id": s["rachna"]["id"], "amount": 50})
    r = await admin.post("/payments", {"worker_id": s["rachna"]["id"], "amount": 50})
    assert r.status_code == 409
    r = await admin.post("/payments", {"worker_id": s["rachna"]["id"], "amount": 50, "confirm_duplicate": True})
    assert r.status_code == 200

    # exports
    x = await admin.get(f"/payouts/cycles/{cyc['id']}/export.xlsx")
    assert x.status_code == 200 and x.content[:2] == b"PK"
    csv = await admin.get(f"/payouts/cycles/{cyc['id']}/bank.csv")
    assert csv.status_code == 200


async def test_reports_and_dashboards(admin, client):
    s = await setup_factory(admin, client)
    sup, wts, lot = s["sup"], s["wts"], s["lot"]
    r = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["FRONT"]], "colour_codes": ["ALL"]})
    jid = r.json()["jobs"][0]["id"]
    await sup.post(f"/jobs/{jid}/done", {"note": "no phone"})  # on behalf
    await sup.post(f"/jobs/{jid}/check")
    await admin.post(f"/jobs/{jid}/edit", {"pieces": 199, "reason": "1 piece damaged"})
    a = (await admin.post(f"/jobs/{jid}/approve")).json()
    assert a["amount"] == 199 * 14.5 and a["status"] == "APPROVED"
    # dup attempt to feed exceptions
    await sup.post("/jobs/assign", {"worker_id": s["rachna"]["id"], "lot_id": lot["id"],
                                    "work_type_ids": [wts["FRONT"]], "colour_codes": ["B"]})

    assert (await sup.get("/dashboard/supervisor")).status_code == 200
    d = (await admin.get("/dashboard/admin")).json()
    assert d["kpis"]["approved_unpaid"]["amount"] == 2885.5
    for url in ["/reports/status-board", "/reports/lot-progress", "/reports/worker-productivity", "/reports/ageing"]:
        r = await sup.get(url)
        assert r.status_code == 200, (url, r.text)
    for url in ["/reports/timeline", "/reports/payout-register", "/reports/lot-cost", "/reports/work-type-cost",
                "/reports/monthly-summary", "/reports/exceptions", "/audit-logs"]:
        r = await admin.get(url)
        assert r.status_code == 200, (url, r.text)
        assert (await sup.get(url)).status_code == 403
    exc = (await admin.get("/reports/exceptions")).json()
    kinds = set(exc["summary"])
    assert {"ADMIN_EDIT", "DUPLICATE_BLOCKED", "DONE_BY_SUPERVISOR"} <= kinds, kinds
    lc = (await admin.get("/reports/lot-cost")).json()["rows"][0]
    assert lc["estimated_cost"] == 200 * (14.5 + 25 + 3) and lc["approved_cost"] == 2885.5
    grid = (await sup.get(f"/lots/{lot['id']}/grid")).json()
    front_row = next(r for r in grid["rows"] if r["code"] == "FRONT")
    assert all(c["jobs"][0]["status"] == "APPROVED" for c in front_row["cells"])
    tl = (await admin.get("/reports/timeline")).json()
    assert any(e["event"] == "APPROVED" for e in tl["rows"])
    x = await admin.get("/reports/lot-cost", params={"format": "xlsx"})
    assert x.content[:2] == b"PK"
    mm = (await s["w_suraj"].get("/reports/my-month")).json()
    assert mm["pieces"] == 199


async def test_edge_cases(admin, client):
    s = await setup_factory(admin, client)
    sup, wts, lot = s["sup"], s["wts"], s["lot"]
    # supervisor can't add a supervisor; can add a worker
    assert (await sup.post("/users", {"name": "X", "mobile": "9000000099", "roles": ["SUPERVISOR"]})).status_code == 403
    assert (await sup.post("/users", {"name": "Y", "mobile": "9000000011"})).status_code == 409  # mobile taken
    # unregistered number can't log in
    await client.post("/auth/otp/request", json={"mobile": "9111111111"})
    r = await client.post("/auth/otp/verify", json={"mobile": "9111111111", "code": "123456"})
    assert r.status_code == 404
    # wrong otp
    await client.post("/auth/otp/request", json={"mobile": "9000000011"})
    assert (await client.post("/auth/otp/verify", json={"mobile": "9000000011", "code": "000000"})).status_code == 400

    r = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["FRONT"]], "colour_codes": ["A", "C"],
                                        "client_ref": "offline-1"})
    job = r.json()["jobs"][0]
    assert job["pieces"] == 130
    # offline retry with same client_ref -> same job, not a duplicate
    r2 = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                         "work_type_ids": [wts["FRONT"]], "colour_codes": ["A", "C"],
                                         "client_ref": "offline-1"})
    assert r2.json()["duplicate_request"] and r2.json()["jobs"][0]["id"] == job["id"]
    # colour qty corrected -> open job recalculated
    r = await sup.patch(f"/lots/{lot['id']}", {"colours": [{"code": "A", "qty": 80}, {"code": "B", "qty": 70},
                                                           {"code": "C", "qty": 53}], "reason": "recount"})
    assert r.json()["recalculated_jobs"][0]["new_amount"] == 133 * 14.5
    # can't remove a colour in use
    r = await sup.patch(f"/lots/{lot['id']}", {"colours": [{"code": "B", "qty": 70}]})
    assert r.status_code == 400
    # can't close a lot with open jobs
    assert (await sup.post(f"/lots/{lot['id']}/status", params={"status": "CLOSED"})).status_code == 400
    # reassign to Rachna, coverage follows
    r = await sup.post(f"/jobs/{job['id']}/reassign", {"worker_id": s["rachna"]["id"], "reason": "Suraj absent"})
    assert r.json()["worker_id"] == s["rachna"]["id"]
    av = (await sup.get("/jobs/availability", params={"lot_id": lot["id"], "work_type_id": wts["FRONT"]})).json()
    assert av[0]["taken_by"][0]["worker_name"] == "Rachna"
    # cancel frees the cells
    await sup.post(f"/jobs/{job['id']}/cancel", {"note": "wrong"})
    r = await sup.post("/jobs/assign", {"worker_id": s["suraj"]["id"], "lot_id": lot["id"],
                                        "work_type_ids": [wts["FRONT"]], "colour_codes": ["ALL"]})
    assert r.status_code == 200
    # self-claim off by default
    r = await s["w_rachna"].post("/jobs/self-claim", {"lot_id": lot["id"], "work_type_ids": [wts["BACK"]],
                                                      "colour_codes": ["A"]})
    assert r.status_code == 403
    await admin.patch("/company", {"settings": {"allow_worker_self_claim": True, "supervisor_check_required": False,
                                                "show_amount_to_worker": False}})
    r = await s["w_rachna"].post("/jobs/self-claim", {"lot_id": lot["id"], "work_type_ids": [wts["BACK"]],
                                                      "colour_codes": ["A"]})
    assert r.status_code == 200 and r.json()["jobs"][0]["status"] == "DONE"
    sc = r.json()["jobs"][0]
    # check OFF -> admin approves DONE directly
    assert (await admin.post(f"/jobs/{sc['id']}/approve")).json()["status"] == "APPROVED"
    # amounts hidden from worker when setting off
    assert "amount" not in (await s["w_rachna"].get("/jobs")).json()[0]
    # deactivate worker -> session dies
    await admin.patch(f"/users/{s['rachna']['id']}", {"is_active": False})
    assert (await s["w_rachna"].get("/jobs")).status_code == 401
    # unknown setting rejected
    assert (await admin.patch("/company", {"settings": {"bogus": 1}})).status_code == 400
    # closed lot blocks new jobs; reopen needs admin + reason
    lot2 = (await sup.post("/lots", {"lot_no": "200", "colours": [{"code": "A", "qty": 10}]})).json()
    await sup.post(f"/lots/{lot2['id']}/status", params={"status": "CLOSED"})
    assert (await sup.post(f"/lots/{lot2['id']}/status", params={"status": "OPEN", "reason": "x"})).status_code == 403
    assert (await admin.post(f"/lots/{lot2['id']}/status", params={"status": "OPEN"})).status_code == 400
