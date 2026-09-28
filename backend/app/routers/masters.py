"""Work types and styles (default rate cards)."""
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from ..audit import audit
from ..db import get_db
from ..schemas import StyleIn, WorkTypeIn
from ..security import anyone, staff
from ..utils import new_id, now, out, outs

router = APIRouter(tags=["masters"])

DEFAULT_WORK_TYPES = [
    ("FRONT", "फ्रंट"), ("BACK", "बैक"), ("SIDE POCKET", "साइड पॉकेट"), ("ZIPPER", "जिपर"),
    ("SIDE TOP", "साइड टॉप"), ("SEAT TOP", "सीट टॉप"), ("FUZING", "फूजिंग"), ("BELT FUZING", "बेल्ट फूजिंग"),
    ("BELT", "बेल्ट"), ("LOOPS", "लूप्स"), ("BOTTOM", "बॉटम"), ("BELT PIPING", "बेल्ट पाइपिंग"),
    ("SF DF PIPING", "SF DF पाइपिंग"), ("SEAT PIPING", "सीट पाइपिंग"), ("OVER LOCK", "ओवर लॉक"),
    ("GAJ BARTEK", "गाज बरटेक"), ("FLAP GAJ", "फ्लैप गज"), ("FIVE THREAD", "फाइव थ्रेड"),
    ("JATI OVER LOCK", "जाती ओवर लॉक"), ("NUMBERING", "नंबरिंग"), ("SEAT FIVETHREAD", "सीट फाइवथ्रेड"),
    ("SIDE FIVETHREAD", "साइड फाइवथ्रेड"), ("INSIDE FIVETHREAD", "इनसाइड-फाइवथ्रेड"),
    ("SF DF OVERLOCK", "एसएफ डीएफ ओवरलॉक"), ("PU LABLE", "पी यू लेबल"), ("CUTTING", "कटिंग"),
    ("BELT FINISH", "बेल्ट फिनिश"),
]


@router.get("/work-types")
async def list_work_types(include_inactive: bool = False, user: dict = Depends(anyone)):
    f = {"company_id": user["company_id"]}
    if not include_inactive:
        f["is_active"] = True
    return outs([w async for w in get_db().work_types.find(f).sort([("sequence_no", 1), ("code", 1)])])


@router.post("/work-types")
async def create_work_type(body: WorkTypeIn, user: dict = Depends(staff)):
    db = get_db()
    doc = {"_id": new_id(), "company_id": user["company_id"], **body.model_dump(), "code": body.code.strip().upper(),
           "created_at": now(), "created_by": user["_id"]}
    try:
        await db.work_types.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, f"Work type {doc['code']} already exists")
    await audit(db, user, "work_type", doc["_id"], "CREATE", new=body.model_dump())
    return out(doc)


@router.post("/work-types/seed-defaults")
async def seed_work_types(user: dict = Depends(staff)):
    """Loads the 27 common trouser/bottom-wear operations with Hindi names."""
    db = get_db()
    added = 0
    for i, (code, hi) in enumerate(DEFAULT_WORK_TYPES):
        if await db.work_types.find_one({"company_id": user["company_id"], "code": code}):
            continue
        await db.work_types.insert_one({"_id": new_id(), "company_id": user["company_id"], "code": code,
                                        "name_en": code.title(), "name_hi": hi, "name_gu": "", "icon": "scissors",
                                        "sequence_no": i + 1, "is_active": True, "created_at": now()})
        added += 1
    return {"added": added}


@router.put("/work-types/{wid}")
async def update_work_type(wid: str, body: WorkTypeIn, user: dict = Depends(staff)):
    db = get_db()
    old = await db.work_types.find_one({"_id": wid, "company_id": user["company_id"]})
    if not old:
        raise HTTPException(404, "Work type not found")
    upd = {**body.model_dump(), "code": body.code.strip().upper()}
    try:
        await db.work_types.update_one({"_id": wid}, {"$set": upd})
    except DuplicateKeyError:
        raise HTTPException(409, f"Work type {upd['code']} already exists")
    await audit(db, user, "work_type", wid, "UPDATE", old={k: old.get(k) for k in upd}, new=upd)
    return out(await db.work_types.find_one({"_id": wid}))


@router.post("/work-types/reorder")
async def reorder_work_types(ids: list[str], user: dict = Depends(staff)):
    db = get_db()
    for i, wid in enumerate(ids):
        await db.work_types.update_one({"_id": wid, "company_id": user["company_id"]}, {"$set": {"sequence_no": i + 1}})
    return {"ok": True}


@router.get("/styles")
async def list_styles(user: dict = Depends(anyone)):
    return outs([s async for s in get_db().styles.find({"company_id": user["company_id"], "is_active": True})])


@router.post("/styles")
async def create_style(body: StyleIn, user: dict = Depends(staff)):
    db = get_db()
    doc = {"_id": new_id(), "company_id": user["company_id"], **body.model_dump(), "is_active": True, "created_at": now()}
    await db.styles.insert_one(doc)
    await audit(db, user, "style", doc["_id"], "CREATE", new=body.model_dump())
    return out(doc)


@router.put("/styles/{sid}")
async def update_style(sid: str, body: StyleIn, user: dict = Depends(staff)):
    db = get_db()
    res = await db.styles.update_one({"_id": sid, "company_id": user["company_id"]}, {"$set": body.model_dump()})
    if not res.matched_count:
        raise HTTPException(404, "Style not found")
    await audit(db, user, "style", sid, "UPDATE", new=body.model_dump())
    return out(await db.styles.find_one({"_id": sid}))
