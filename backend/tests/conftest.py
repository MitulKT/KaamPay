import os
import sys

import httpx
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("OTP_PROVIDER", "dev")

from app.db import ensure_indexes, set_db  # noqa: E402
from app.main import app  # noqa: E402

SAMPLE = os.path.join(os.path.dirname(__file__), "sample_data.xlsx")


@pytest_asyncio.fixture
async def db():
    d = AsyncMongoMockClient()["kaampay_test"]
    set_db(d)
    await ensure_indexes(d)
    yield d


@pytest_asyncio.fixture
async def client(db):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t/api") as c:
        yield c


class Api:
    """Tiny helper: logged-in client per user."""

    def __init__(self, client, token):
        self.c, self.h = client, {"Authorization": f"Bearer {token}"}

    async def get(self, url, **kw):
        return await self.c.get(url, headers=self.h, **kw)

    async def post(self, url, json=None, **kw):
        return await self.c.post(url, json=json, headers=self.h, **kw)

    async def put(self, url, json=None, **kw):
        return await self.c.put(url, json=json, headers=self.h, **kw)

    async def patch(self, url, json=None, **kw):
        return await self.c.patch(url, json=json, headers=self.h, **kw)

    async def delete(self, url, **kw):
        return await self.c.delete(url, headers=self.h, **kw)


async def login(client, mobile) -> Api:
    r = await client.post("/auth/otp/request", json={"mobile": mobile})
    assert r.status_code == 200, r.text
    r = await client.post("/auth/otp/verify", json={"mobile": mobile, "code": "123456"})
    assert r.status_code == 200, r.text
    return Api(client, r.json()["access_token"])


@pytest_asyncio.fixture
async def admin(client):
    await client.post("/auth/otp/request", json={"mobile": "9000000001"})
    r = await client.post("/auth/signup", json={"company_name": "Demo Garments", "owner_name": "Mitul",
                                                "mobile": "9000000001", "code": "123456"})
    assert r.status_code == 200, r.text
    return Api(client, r.json()["access_token"])
