"""KaamPay API — job-work payout for garment manufacturers.

In production one service serves both the API (/api/...) and the built web app (everything else),
so admins can open the same link in a laptop browser.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import ensure_indexes, get_db
from .routers import auth, imports, jobs, ledger, lots, masters, money, reports, uploads, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes(get_db())
    yield


app = FastAPI(title="KaamPay API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs",
              openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

for r in (auth, users, ledger, masters, lots, jobs, money, reports, imports, uploads):
    app.include_router(r.router, prefix="/api")
app.include_router(jobs.bulk_router, prefix="/api")
app.include_router(uploads.public_router)  # GET /uploads/{company}/{name}


@app.get("/api/health")
async def health():
    return {"ok": True, "app": settings.app_name}


# ---- web app (Expo web export) with SPA fallback ----
WEB_DIR = settings.web_dir
if WEB_DIR and os.path.isdir(WEB_DIR):
    app.mount("/_expo", StaticFiles(directory=os.path.join(WEB_DIR, "_expo")), name="expo-static")
    if os.path.isdir(os.path.join(WEB_DIR, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(WEB_DIR, "assets")), name="web-assets")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        f = os.path.join(WEB_DIR, path)
        if path and os.path.isfile(f) and os.path.realpath(f).startswith(os.path.realpath(WEB_DIR)):
            return FileResponse(f)
        return FileResponse(os.path.join(WEB_DIR, "index.html"))
