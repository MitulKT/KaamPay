"""Mongo connection + indexes. `set_db` lets tests inject an in-memory mongomock database."""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import settings

_db: AsyncIOMotorDatabase | None = None


def get_db() -> AsyncIOMotorDatabase:
    global _db
    if _db is None:
        if settings.mongo_url.startswith("mongomock"):
            # In-memory database for demos/tests: `MONGO_URL=mongomock://` (data is lost on restart).
            from mongomock_motor import AsyncMongoMockClient

            _db = AsyncMongoMockClient()[settings.db_name]
        else:
            _db = AsyncIOMotorClient(settings.mongo_url)[settings.db_name]
    return _db


def set_db(db) -> None:
    global _db
    _db = db


async def ensure_indexes(db) -> None:
    await db.users.create_index([("company_id", 1), ("mobile", 1)], unique=True)
    await db.users.create_index("mobile")
    await db.work_types.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.lots.create_index([("company_id", 1), ("lot_no", 1)], unique=True)
    await db.lot_rates.create_index([("company_id", 1), ("lot_id", 1), ("work_type_id", 1)], unique=True)
    # The anti-double-claim guard: one active holder per lot x work type x colour x slot.
    await db.job_coverage.create_index(
        [("company_id", 1), ("lot_id", 1), ("work_type_id", 1), ("colour_code", 1), ("slot", 1)], unique=True
    )
    await db.jobs.create_index([("company_id", 1), ("status", 1)])
    await db.jobs.create_index([("company_id", 1), ("worker_id", 1), ("approved_at", 1)])
    await db.jobs.create_index([("company_id", 1), ("lot_id", 1)])
    await db.audit_logs.create_index([("company_id", 1), ("at", -1)])
    await db.notifications.create_index([("company_id", 1), ("user_id", 1), ("at", -1)])
    await db.counters.create_index([("company_id", 1), ("name", 1)], unique=True)
