"""The payout engine. Pure functions only (no DB) so every rupee rule is unit-testable.

    job amount   = pieces(lot, colours) x rate(lot, work type)
    net payable  = gross approved - advance recovery - deductions
    balance      = approved job amounts - advances given - deductions - payments
"""
from dataclasses import dataclass

from .utils import money

ALL = "ALL"


class PayoutError(ValueError):
    pass


def lot_colour_map(lot: dict) -> dict[str, float]:
    return {c["code"].upper(): float(c.get("qty") or 0) for c in lot.get("colours", [])}


def normalise_colours(colour_codes: list[str], lot: dict) -> list[str]:
    """Upper-cases, de-dupes and validates codes. ALL stays ALL (it may not be mixed with codes)."""
    codes = []
    for c in colour_codes or []:
        c = str(c).strip().upper()
        if c and c not in codes:
            codes.append(c)
    if not codes:
        raise PayoutError("Pick at least one colour")
    if ALL in codes:
        if len(codes) > 1:
            raise PayoutError("Pick ALL or specific colours, not both")
        return [ALL]
    cmap = lot_colour_map(lot)
    bad = [c for c in codes if c not in cmap]
    if bad:
        raise PayoutError(f"Colour {', '.join(bad)} does not exist in lot {lot.get('lot_no')}")
    return sorted(codes)


def expand_colours(colour_codes: list[str], lot: dict) -> list[str]:
    """ALL -> every colour code of the lot."""
    if colour_codes == [ALL]:
        return sorted(lot_colour_map(lot).keys())
    return colour_codes


def pieces_for(lot: dict, colour_codes: list[str], split_pieces: float | None = None) -> float:
    if split_pieces is not None:
        return float(split_pieces)
    cmap = lot_colour_map(lot)
    if colour_codes == [ALL]:
        return float(sum(cmap.values()))
    return float(sum(cmap.get(c, 0) for c in colour_codes))


def job_amount(pieces: float, rate: float, rounding: str = "NONE") -> float:
    amt = money(float(pieces) * float(rate))
    if rounding == "NEAREST_1":
        amt = float(int(amt + 0.5))
    return amt


@dataclass
class CycleLine:
    worker_id: str
    gross: float
    advance_recovery: float
    deductions: float
    net_payable: float
    job_ids: list[str]
    deduction_ids: list[str]


def advance_recovery(open_advance: float, gross: float, max_recovery_percent: float) -> float:
    """Recover advances from this cycle's earnings, capped at X% of gross so the worker still takes money home."""
    cap = gross * max(0.0, min(100.0, max_recovery_percent)) / 100.0
    return money(max(0.0, min(open_advance, cap)))


def build_cycle_lines(
    approved_jobs: list[dict],
    deductions: list[dict],
    open_advance_by_worker: dict[str, float],
    max_recovery_percent: float,
) -> list[CycleLine]:
    workers: dict[str, dict] = {}
    for j in approved_jobs:
        w = workers.setdefault(j["worker_id"], {"gross": 0.0, "jobs": [], "ded": 0.0, "deds": []})
        w["gross"] += float(j["amount"])
        w["jobs"].append(j["_id"])
    for d in deductions:
        w = workers.setdefault(d["worker_id"], {"gross": 0.0, "jobs": [], "ded": 0.0, "deds": []})
        w["ded"] += float(d["amount"])
        w["deds"].append(d["_id"])
    lines = []
    for wid, w in workers.items():
        gross = money(w["gross"])
        ded = money(w["ded"])
        rec = advance_recovery(open_advance_by_worker.get(wid, 0.0), gross, max_recovery_percent)
        rec = money(min(rec, max(0.0, gross - ded)))  # never push net below zero via advance recovery
        lines.append(
            CycleLine(
                worker_id=wid,
                gross=gross,
                advance_recovery=rec,
                deductions=ded,
                net_payable=money(gross - rec - ded),
                job_ids=w["jobs"],
                deduction_ids=w["deds"],
            )
        )
    lines.sort(key=lambda l: -l.gross)
    return lines


def worker_balance(earned: float, advances: float, deductions: float, payments: float) -> float:
    return money(earned - advances - deductions - payments)
