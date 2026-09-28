"""JWT sessions + role guards. Every request carries company_id inside the token; routes never trust it from the body."""
from datetime import timedelta
from typing import Iterable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import get_db
from .utils import now

WORKER, SUPERVISOR, ADMIN = "WORKER", "SUPERVISOR", "ADMIN"
ROLES = (WORKER, SUPERVISOR, ADMIN)

bearer = HTTPBearer(auto_error=False)


def make_token(user: dict, kind: str = "access") -> str:
    if kind == "access":
        exp = now() + timedelta(minutes=settings.access_token_minutes)
    else:
        staff = any(r in user["roles"] for r in (SUPERVISOR, ADMIN))
        exp = now() + timedelta(days=settings.staff_refresh_days if staff else settings.worker_refresh_days)
    payload = {
        "sub": user["_id"],
        "cid": user["company_id"],
        "roles": user["roles"],
        "kind": kind,
        "sv": user.get("session_version", 0),
        "exp": exp,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode(token: str, kind: str) -> dict:
    try:
        data = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please log in again")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    if data.get("kind") != kind:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return data


async def load_user(data: dict) -> dict:
    user = await get_db().users.find_one({"_id": data["sub"], "company_id": data["cid"]})
    # Deactivating a user or changing their number bumps session_version -> old tokens die.
    if not user or not user.get("is_active", True) or user.get("session_version", 0) != data.get("sv", 0):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account inactive or session revoked")
    return user


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login required")
    return await load_user(decode(creds.credentials, "access"))


def require(*roles: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if not any(r in user["roles"] for r in roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission for this")
        return user

    return dep


def has(user: dict, *roles: Iterable[str]) -> bool:
    return any(r in user["roles"] for r in roles)


staff = require(SUPERVISOR, ADMIN)
admin_only = require(ADMIN)
anyone = require(*ROLES)
