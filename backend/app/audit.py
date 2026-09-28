"""Audit log + in-app notifications (+ optional Expo push)."""
import logging

import httpx

from .config import settings
from .utils import new_id, now

log = logging.getLogger("notify")


async def audit(db, user: dict | None, entity: str, entity_id: str, action: str, old=None, new=None, company_id=None):
    await db.audit_logs.insert_one(
        {
            "_id": new_id(),
            "company_id": company_id or (user or {}).get("company_id"),
            "entity": entity,
            "entity_id": entity_id,
            "action": action,
            "old_value": old,
            "new_value": new,
            "user_id": (user or {}).get("_id"),
            "user_name": (user or {}).get("name"),
            "at": now(),
        }
    )


async def notify(db, company_id: str, user_ids: list[str], kind: str, title: str, body: str, data: dict | None = None):
    """Stores a bell notification per user and fires an Expo push when enabled."""
    if not user_ids:
        return
    docs = [
        {"_id": new_id(), "company_id": company_id, "user_id": uid, "kind": kind, "title": title,
         "body": body, "data": data or {}, "read": False, "at": now()}
        for uid in set(user_ids)
    ]
    await db.notifications.insert_many(docs)
    if not settings.expo_push_enabled:
        return
    tokens = [u["expo_push_token"] async for u in db.users.find(
        {"_id": {"$in": list(set(user_ids))}, "expo_push_token": {"$exists": True, "$ne": None}})]
    if not tokens:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post("https://exp.host/--/api/v2/push/send",
                         json=[{"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"} for t in tokens])
    except Exception as e:  # push must never break the business action
        log.warning("push failed: %s", e)


async def users_with_role(db, company_id: str, role: str) -> list[str]:
    return [u["_id"] async for u in db.users.find({"company_id": company_id, "roles": role, "is_active": True}, {"_id": 1})]
