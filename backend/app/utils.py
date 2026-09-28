"""Small shared helpers: ids, time, counters, money, serialisation."""
import re
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from pymongo import ReturnDocument

from .config import settings

IST = ZoneInfo(settings.timezone)


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    """UTC now, naive (Mongo stores naive UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_ist(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(IST)


def ist_day_bounds(day: datetime | None = None) -> tuple[datetime, datetime]:
    """UTC-naive [start, end) of an IST calendar day."""
    d = (day.replace(tzinfo=timezone.utc).astimezone(IST) if day else datetime.now(IST)).date()
    start = datetime(d.year, d.month, d.day, tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
    return start, start + timedelta(days=1)


def as_dt(d) -> datetime | None:
    """date -> naive datetime at midnight (Mongo can't store `date`). None -> now."""
    if d is None:
        return now()
    if isinstance(d, datetime):
        return d
    return datetime(d.year, d.month, d.day)


def money(x) -> float:
    """Round to 2 decimals with half-up (how accountants round, not banker's rounding)."""
    return float(Decimal(str(x or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def inr(x) -> str:
    """Indian digit grouping: 123456.5 -> '1,23,456.50'."""
    neg = x < 0
    s = f"{abs(money(x)):.2f}"
    whole, frac = s.split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        whole = f"{head},{tail}"
    return f"{'-' if neg else ''}₹{whole}.{frac}"


async def next_number(db, company_id: str, name: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"company_id": company_id, "name": name},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["value"]


def out(doc: dict | None) -> dict | None:
    """Mongo doc -> API dict (`_id` -> `id`)."""
    if doc is None:
        return None
    d = dict(doc)
    d["id"] = d.pop("_id")
    return d


def outs(docs) -> list[dict]:
    return [out(d) for d in docs]


def split_bilingual(text: str) -> tuple[str, str]:
    """'सूरज (SURAJ)' -> ('SURAJ', 'सूरज').  'Gulam' -> ('Gulam', '')."""
    text = (text or "").strip()
    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", text)
    if m:
        return m.group(2).strip(), m.group(1).strip()
    return text, ""
