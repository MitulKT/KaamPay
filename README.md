[README.md](https://github.com/user-attachments/files/32737907/README.md)
# KaamPay — Job-Work Payout App

KaamPay is a mobile app for garment manufacturers. The supervisor assigns lot work, the worker taps **Done**, the supervisor checks it and the admin approves. The app then calculates each payout from the lot's colour quantities and rate master, recovers advances, records payment and gives every worker a slip they can share on WhatsApp.

| Part | Tech | Folder |
|---|---|---|
| API | FastAPI · MongoDB (Motor) · JWT · OTP | `backend/` |
| Mobile app (Android / iOS / web) | Expo SDK 57 · Expo Router · TypeScript | `mobile/` |
| Tests | pytest: 14 tests, including a full import of the real sample Excel | `backend/tests/` |

---

## 1. Try it in 5 minutes (no database needed)

```bash
# API with an in-memory database
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
MONGO_URL=mongomock:// uvicorn app.main:app --port 8000 # Windows: set MONGO_URL=mongomock:// && uvicorn ...
python seed_demo.py                                     # in a 2nd terminal: demo company + jobs

# App
cd ../mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-PC-LAN-IP>:8000 npx expo start
#   press "w" for the browser, or scan the QR with the Expo Go app on an Android phone on the same Wi-Fi
```

**Demo logins** (DEV OTP is always `123456`)

| Role | Mobile |
|---|---|
| Admin + Supervisor (owner) | 9000000001 |
| Supervisor | 9000000002 |
| Worker Suraj / Rachna / Gulam | 9000000011 / 12 / 13 |

To load your real data, log in as admin, then go to **More → Import from Excel** and pick the Google-Form workbook.

---

## 2. Production setup (Render + MongoDB Atlas, one service)

The root `Dockerfile` builds the web app and the API into **one** image. One link serves the API (`/api/...`) and the admin web app. Job photos are stored in MongoDB, so nothing is lost when the free server restarts.

| # | Step |
|---|---|
| 1 | **MongoDB Atlas** → free M0 cluster, region **Mumbai (ap-south-1)** → Database user + password → Network Access: `0.0.0.0/0` → copy the connection string (`mongodb+srv://...`) |
| 2 | **GitHub** → new **private** repo `kaampay` → upload this folder (GitHub Desktop is easiest; web upload works in 2 batches of ≤100 files) |
| 3 | **Render** → sign in with GitHub → **New + → Blueprint** → pick the repo. `render.yaml` sets up everything; paste the Atlas string into `MONGO_URL` → Apply. The first build takes about 10 minutes |
| 4 | Open `https://kaampay-xxxx.onrender.com/api/health` and check it shows `{"ok":true}`. Open the root URL and register the company (OTP is `123456` while `OTP_PROVIDER=dev`) |
| 5 | Android app: in `mobile/eas.json`, set `EXPO_PUBLIC_API_URL` to the Render URL → `npx eas-cli build -p android --profile preview` → share the APK link |
| 6 | Before go-live: Render plan **Starter** (the free plan sleeps after idle time), `OTP_PROVIDER=msg91` with its keys, and Atlas backups |

Run the tests with `cd backend && pytest -q`.

## 3. How the money works

```
job amount  = pieces(lot, colours) × rate(lot, work type)       ALL = every colour of the lot
net payable = approved job amounts − advance recovery − deductions
balance     = approved earnings − advances given − deductions − payments
```

* **Rates are per lot × work type.** Your sheet has FRONT at ₹17.50 on lot 122 but ₹12.50 on lot 123, so a single rate card can't work. The app lets you copy rates from another lot or a style.
* **The amount freezes at approval.** Rate or quantity changes after that don't touch approved jobs.
* **Advance recovery** is automatic in each payout cycle, capped at a % of earnings that you set (default 50%). You can override it per worker.
* **Duplicate claims are blocked.** Each lot × work type × colour cell can have only one active job, enforced by a unique DB index, so two phones can't grab the same cell at once. For partial work, use **Split by pieces**.

## 4. Job lifecycle

```
ASSIGNED ──(worker taps Done)──▶ DONE ──(supervisor ✓)──▶ CHECKED ──(admin)──▶ APPROVED ──(payment)──▶ PAID
    ▲                              │                        │
    └────── REJECTED (reason) ◀────┴────────────────────────┘        CANCELLED frees the cells
```

The optional **STARTED** step and **supervisor check** are switched on or off in Settings.

---

## 5. Feature map

| Role | Screens |
|---|---|
| **Worker** (Hindi by default, Gujarati and English too; big buttons, no typing) | **Kaam**: job cards with huge lot number, work type, colours, pieces and ₹; ✓ Done → Yes/No (+ optional photo); long-press to mark several done at once; undo within 10 minutes; returned jobs shown in red with the reason · **Paisa**: amount to receive, pending approval, advance, this month's pieces and ₹ by week · **Hisaab**: past settlements, a PDF slip to share on WhatsApp, advances · Profile: photo, language, call supervisor · optional self-claim (duplicate-proof) |
| **Supervisor** | **Home**: today's counts and a needs-attention list · **Lots**: create with colour-wise quantity; **work grid** (work type × colour, colour-coded, tap to assign, long-press to multi-assign); **Rates** (copy from lot or style, missing rates in red); **Cost** tab · **Assign**: worker → lot → work types + colours, with taken colours greyed out and the holder's name shown; split by pieces; ₹ preview · **Check**: ✓ / ✗ with reasons, bulk · **Workers**: add/edit, skills, payment mode, ledger · Work-type master (EN/HI/GU, reorder) · Reports R1–R4 |
| **Admin** | **Home**: KPIs and alerts (late approvals, duplicates blocked, missing rates, workers with no mobile, negative balances) · **Approve**: group by worker or lot, bulk approve, reject, edit pieces/rate with a reason · **Payouts**: draft cycle → adjust recovery or exclude → lock → pay one worker or pay all (each worker's own mode), Excel register with signature column, Bank/UPI CSV, slips · Advances and deductions · Settings · Users and roles · **Excel import** (preview → duplicate review → mark months as already settled → import → undo) · Audit log · All 10 reports |

**Reports** (all can be exported to Excel):

| # | Report | Who |
|---|---|---|
| R1 | Job status board | Supervisor + Admin |
| R2 | Lot progress | Supervisor + Admin |
| R3 | Worker productivity | Supervisor + Admin |
| R4 | Ageing / WIP | Supervisor + Admin |
| R5 | Timeline | Admin |
| R6 | Payout register | Admin |
| R7 | Worker ledger (on the worker screen) | Admin + that worker |
| R8 | Lot labour cost and cost per piece | Admin |
| R9 | Work-type cost | Admin |
| R10 | Monthly labour summary | Admin |
| R11 | Exceptions | Admin |

**Offline:** workers' Done taps, supervisor checks and assignments are queued on the phone when there's no signal and synced automatically when it returns. The server rejects any change that's no longer valid with a clear message.

---

## 6. What the sample Excel showed (import dry-run)

| | |
|---|---|
| Workers / lots / work types / rates | 34 / 80 / 27 / 787 |
| Form entries → job lines | 741 → 1,066 |
| Duplicate job lines | **157** in 54 groups. 18 groups are different workers claiming the same cell |
| Lines missing a rate / colour qty | 85 / 66 |
| Aug 2026 total (matches the Excel) | ₹5,01,684. After keeping only the first of each duplicate: ₹4,68,916 |

---

## 7. API quick reference (`/api`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/otp/request` · `/auth/otp/verify` · `/auth/signup` · `/auth/refresh` · `GET/PATCH /auth/me` |
| Company & users | `GET/PATCH /company` · `GET /company/contacts` · `GET/POST /users` · `GET/PATCH /users/{id}` · `GET /workers/tiles` |
| Masters | `GET/POST /work-types` · `PUT /work-types/{id}` · `POST /work-types/seed-defaults` · `/work-types/reorder` · `GET/POST /styles` |
| Lots | `GET/POST /lots` · `GET/PATCH /lots/{id}` · `POST /lots/{id}/status` · `GET/PUT /lots/{id}/rates` · `POST /lots/{id}/rates/copy` · `/rates/lock` · `GET /lots/{id}/grid` · `/summary` |
| Jobs | `POST /jobs/assign` · `/jobs/self-claim` · `GET /jobs` · `/jobs/availability` · `POST /jobs/{id}/start` · `done` · `undo-done` · `check` · `reject` · `approve` · `edit` · `cancel` · `reassign` · `POST /jobs-bulk/{done,check,approve,reject}` |
| Money | `POST/GET /advances` · `DELETE /advances/{id}` · `POST/GET /deductions` · `POST/GET /payouts/cycles` · `GET /payouts/suggest-period` · `POST .../refresh` · `.../lock` · `.../pay-all` · `PATCH .../lines/{worker}` · `GET .../export.xlsx` · `.../bank.csv` · `.../slip/{worker}` · `POST/GET /payments` · `DELETE /payments/{id}` |
| Worker money | `GET /workers/{id}/summary` · `/ledger` · `/settlements` |
| Reports | `GET /dashboard/supervisor` · `/dashboard/admin` · `/reports/{status-board, lot-progress, worker-productivity, ageing, timeline, payout-register, lot-cost, work-type-cost, monthly-summary, exceptions, my-month}` (add `?format=xlsx`) |
| Other | `POST /uploads` · `GET /notifications` · `POST /notifications/read-all` · `GET /audit-logs` · `POST /import/preview` · `POST /import/{id}/commit` · `DELETE /import/{id}` |

Interactive docs are at `http://localhost:8000/docs`.

## 8. Known limits / next steps

* Reports aggregate in Python, which is fine for a pilot of tens of thousands of jobs. Move the heavy reports to Mongo aggregation pipelines when you onboard large factories.
* Supervisors get a notification per bulk "done"; a 30-minute digest would be quieter.
* Company sign-up is open. Add an approval step or invite codes before a public launch.
* The camera and push notifications need a real phone build (Expo Go or an EAS build), not the web preview.
