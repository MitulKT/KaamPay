"""Seeds a demo company through the real API so you can click around immediately.

Usage (server running on :8000):   python seed_demo.py [http://localhost:8000]
Logins (DEV OTP = 123456):
  Admin/owner  9000000001      Supervisor  9000000002
  Workers      9000000011 (Suraj), 9000000012 (Rachna), 9000000013 (Gulam)
"""
import sys

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/") + "/api"


def login(c, mobile):
    c.post("/auth/otp/request", json={"mobile": mobile}).raise_for_status()
    r = c.post("/auth/otp/verify", json={"mobile": mobile, "code": "123456"})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def main():
    with httpx.Client(base_url=BASE, timeout=30) as c:
        c.post("/auth/otp/request", json={"mobile": "9000000001"})
        r = c.post("/auth/signup", json={"company_name": "Shree Demo Garments", "owner_name": "Mitul",
                                         "mobile": "9000000001", "code": "123456"})
        if r.status_code != 200:
            print("Signup failed (already seeded?)", r.text)
            return
        A = {"Authorization": f"Bearer {r.json()['access_token']}"}
        c.post("/work-types/seed-defaults", headers=A).raise_for_status()
        wts = {w["code"]: w["id"] for w in c.get("/work-types", headers=A).json()}
        c.post("/users", headers=A, json={"name": "Ramesh", "mobile": "9000000002", "roles": ["SUPERVISOR"]})
        workers = {}
        for mob, name, local, mode in [("9000000011", "Suraj", "सूरज", "UPI"), ("9000000012", "Rachna", "रचना", "CASH"),
                                       ("9000000013", "Gulam", "गुलाम", "CASH")]:
            workers[name] = c.post("/users", headers=A, json={"name": name, "name_local": local, "mobile": mob,
                                                              "roles": ["WORKER"], "payment_mode": mode,
                                                              "upi_id": "suraj@upi" if mode == "UPI" else None}).json()["id"]
        S = login(c, "9000000002")
        lots = {}
        for no, cols, rates in [
            ("128", [("A", 77), ("B", 70), ("C", 53), ("D", 64)], {"FRONT": 14.5, "BACK": 25, "ZIPPER": 3, "SIDE POCKET": 6}),
            ("129", [("A", 90), ("B", 81), ("C", 81)], {"FRONT": 15, "BACK": 22, "ZIPPER": 3, "OVER LOCK": 1}),
        ]:
            lot = c.post("/lots", headers=S, json={"lot_no": no, "item_name": "Cargo trouser",
                                                   "colours": [{"code": k, "qty": q} for k, q in cols]}).json()
            lots[no] = lot["id"]
            c.put(f"/lots/{lot['id']}/rates", headers=S,
                  json={"rates": [{"work_type_id": wts[k], "rate": v} for k, v in rates.items()]}).raise_for_status()

        def assign(worker, lot, wt, colours):
            r = c.post("/jobs/assign", headers=S, json={"worker_id": workers[worker], "lot_id": lots[lot],
                                                        "work_type_ids": [wts[x] for x in wt], "colour_codes": colours})
            r.raise_for_status()
            return [j["id"] for j in r.json()["jobs"]]

        j1 = assign("Suraj", "128", ["FRONT", "BACK"], ["A"])
        j2 = assign("Suraj", "129", ["BACK"], ["C"])
        j3 = assign("Rachna", "128", ["ZIPPER"], ["ALL"])
        assign("Rachna", "129", ["ZIPPER"], ["A", "B"])
        j5 = assign("Gulam", "128", ["FRONT"], ["B", "C"])
        assign("Gulam", "129", ["FRONT"], ["A"])
        # some progress so every screen has data
        W1, W2, W3 = login(c, "9000000011"), login(c, "9000000012"), login(c, "9000000013")
        c.post("/jobs-bulk/done", headers=W1, json={"job_ids": j1}).raise_for_status()
        c.post(f"/jobs/{j3[0]}/done", headers=W2, json={}).raise_for_status()
        c.post(f"/jobs/{j5[0]}/done", headers=W3, json={}).raise_for_status()
        c.post("/jobs-bulk/check", headers=S, json={"job_ids": j1 + j3}).raise_for_status()
        c.post("/jobs-bulk/approve", headers=A, json={"job_ids": j1}).raise_for_status()
        c.post("/advances", headers=A, json={"worker_id": workers["Gulam"], "amount": 1000, "mode": "CASH",
                                             "reason": "festival"}).raise_for_status()
        print("Seeded ✅  Admin 9000000001 · Supervisor 9000000002 · Workers 9000000011/12/13 · OTP 123456")


if __name__ == "__main__":
    main()
