"""Photo uploads (job-done proof, worker photos).

Stored inside MongoDB (images are compressed to <600 KB by the app), so hosts with no persistent disk
(Render, Railway) don't lose photos on restart. Served back at /uploads/{company_id}/{name}.
"""
from bson.binary import Binary
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from ..config import settings
from ..db import get_db
from ..security import anyone
from ..utils import new_id, now

router = APIRouter(tags=["uploads"])
public_router = APIRouter(tags=["uploads"])

ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def save_file(company_id: str, content: bytes, ext: str, content_type: str) -> str:
    name = f"{new_id()}.{ext}"
    await get_db().files.insert_one({"_id": f"{company_id}/{name}", "company_id": company_id,
                                     "content_type": content_type, "data": Binary(content), "created_at": now()})
    return f"/uploads/{company_id}/{name}"


@router.post("/uploads")
async def upload(file: UploadFile = File(...), user: dict = Depends(anyone)):
    if file.content_type not in ALLOWED:
        raise HTTPException(400, "Only JPG, PNG or WEBP images")
    content = await file.read()
    if len(content) > settings.max_upload_kb * 1024:
        raise HTTPException(413, f"Image too large (max {settings.max_upload_kb} KB). The app compresses before upload.")
    return {"url": await save_file(user["company_id"], content, ALLOWED[file.content_type], file.content_type)}


@public_router.get("/uploads/{company_id}/{name}")
async def get_upload(company_id: str, name: str):
    # File names are random 128-bit ids, so links are unguessable (same model as a signed URL).
    doc = await get_db().files.find_one({"_id": f"{company_id}/{name}"})
    if not doc:
        raise HTTPException(404, "Not found")
    return Response(content=bytes(doc["data"]), media_type=doc["content_type"],
                    headers={"Cache-Control": "private, max-age=86400"})
