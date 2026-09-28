"""Request bodies. Responses are plain dicts (Mongo docs with `id`)."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Mobile = str
PayMode = Literal["CASH", "UPI", "BANK"]


def _mobile(v: str) -> str:
    v = "".join(ch for ch in str(v) if ch.isdigit())
    if len(v) == 12 and v.startswith("91"):
        v = v[2:]
    if len(v) != 10:
        raise ValueError("Mobile must be 10 digits")
    return v


DEFAULT_SETTINGS = {
    "payout_cycle": "MONTHLY",  # WEEKLY | MONTHLY
    "week_start_day": 0,  # 0 = Monday
    "supervisor_check_required": True,
    "photo_required_on_done": False,
    "allow_worker_self_claim": False,
    "show_amount_to_worker": True,
    "use_started_step": False,
    "max_advance_recovery_percent": 50,
    "jobs_per_day_warning": 25,
    "advance_alert_above": 5000,
    "rounding": "NONE",  # NONE | NEAREST_1
    "languages": ["hi", "gu", "en"],
}


class OTPRequest(BaseModel):
    mobile: Mobile
    _v = field_validator("mobile")(_mobile)


class OTPVerify(BaseModel):
    mobile: Mobile
    code: str
    company_id: Optional[str] = None  # when the same number is in 2 companies
    _v = field_validator("mobile")(_mobile)


class RefreshIn(BaseModel):
    refresh_token: str


class CompanySignup(BaseModel):
    company_name: str = Field(min_length=2)
    owner_name: str = Field(min_length=2)
    mobile: Mobile
    code: str  # OTP proves the owner owns the number
    _v = field_validator("mobile")(_mobile)


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    gstin: Optional[str] = None
    address: Optional[str] = None
    logo_url: Optional[str] = None
    settings: Optional[dict] = None


class UserIn(BaseModel):
    name: str
    name_local: str = ""
    mobile: Optional[Mobile] = None
    roles: list[Literal["WORKER", "SUPERVISOR", "ADMIN"]] = ["WORKER"]
    preferred_language: str = "hi"
    photo_url: Optional[str] = None
    # worker profile
    skill_work_type_ids: list[str] = []
    payment_mode: PayMode = "CASH"
    upi_id: Optional[str] = None
    bank_name: Optional[str] = None
    ifsc: Optional[str] = None
    account_last4: Optional[str] = None
    joining_date: Optional[date] = None
    notes: Optional[str] = None

    @field_validator("mobile")
    @classmethod
    def v_mobile(cls, v):
        return _mobile(v) if v else None

    @field_validator("account_last4")
    @classmethod
    def v_last4(cls, v):
        # Never store full account numbers.
        return v[-4:] if v else v


class UserPatch(BaseModel):
    name: Optional[str] = None
    name_local: Optional[str] = None
    mobile: Optional[Mobile] = None
    roles: Optional[list[Literal["WORKER", "SUPERVISOR", "ADMIN"]]] = None
    preferred_language: Optional[str] = None
    photo_url: Optional[str] = None
    is_active: Optional[bool] = None
    skill_work_type_ids: Optional[list[str]] = None
    payment_mode: Optional[PayMode] = None
    upi_id: Optional[str] = None
    bank_name: Optional[str] = None
    ifsc: Optional[str] = None
    account_last4: Optional[str] = None
    notes: Optional[str] = None
    expo_push_token: Optional[str] = None

    @field_validator("mobile")
    @classmethod
    def v_mobile(cls, v):
        return _mobile(v) if v else None


class WorkTypeIn(BaseModel):
    code: str
    name_en: str
    name_hi: str = ""
    name_gu: str = ""
    icon: str = "scissors"
    sequence_no: int = 0
    is_active: bool = True


class StyleIn(BaseModel):
    style_code: str
    name: str
    default_rates: list[dict] = []  # [{work_type_id, rate}]


class Colour(BaseModel):
    code: str
    name: str = ""
    qty: float = Field(ge=0)


class LotIn(BaseModel):
    lot_no: str
    item_name: str = ""
    style_id: Optional[str] = None
    colours: list[Colour] = []
    start_date: Optional[date] = None
    target_date: Optional[date] = None
    remarks: str = ""

    @field_validator("lot_no", mode="before")
    @classmethod
    def v_lot(cls, v):
        s = str(v).strip()
        return s[:-2] if s.endswith(".0") else s


class LotPatch(BaseModel):
    item_name: Optional[str] = None
    colours: Optional[list[Colour]] = None
    start_date: Optional[date] = None
    target_date: Optional[date] = None
    remarks: Optional[str] = None
    reason: str = ""


class RatesIn(BaseModel):
    rates: list[dict]  # [{work_type_id, rate}]
    reason: str = ""


class CopyRatesIn(BaseModel):
    from_lot_id: Optional[str] = None
    from_style_id: Optional[str] = None


class AssignIn(BaseModel):
    worker_id: str
    lot_id: str
    work_type_ids: list[str]
    colour_codes: list[str]  # ["A","C"] or ["ALL"]
    split_pieces: Optional[float] = Field(default=None, gt=0)  # only with one colour
    note: str = ""
    client_ref: Optional[str] = None  # offline-queue idempotency key


class SelfClaimIn(BaseModel):
    lot_id: str
    work_type_ids: list[str]
    colour_codes: list[str]
    photo_url: Optional[str] = None
    client_ref: Optional[str] = None


class JobAction(BaseModel):
    note: str = ""
    photo_url: Optional[str] = None
    reason: Optional[str] = None


class BulkAction(BaseModel):
    job_ids: list[str]
    note: str = ""
    reason: Optional[str] = None


class JobEdit(BaseModel):
    pieces: Optional[float] = Field(default=None, ge=0)
    rate: Optional[float] = Field(default=None, ge=0)
    reason: str = Field(min_length=3)


class ReassignIn(BaseModel):
    worker_id: str
    reason: str = ""


class AdvanceIn(BaseModel):
    worker_id: str
    amount: float = Field(gt=0)
    date: Optional[date] = None
    mode: PayMode = "CASH"
    reason: str = ""


class DeductionIn(BaseModel):
    worker_id: str
    amount: float = Field(gt=0)
    date: Optional[date] = None
    reason: Literal["DAMAGE", "REWORK", "OTHER"] = "OTHER"
    note: str = ""
    job_id: Optional[str] = None


class CycleIn(BaseModel):
    from_date: date
    to_date: date
    period_type: Literal["WEEKLY", "MONTHLY", "CUSTOM"] = "CUSTOM"


class CycleLinePatch(BaseModel):
    advance_recovery: Optional[float] = Field(default=None, ge=0)
    excluded: Optional[bool] = None
    exclude_job_ids: list[str] = []


class PaymentIn(BaseModel):
    worker_id: str
    amount: float = Field(gt=0)
    mode: PayMode = "CASH"
    reference_no: str = ""
    date: Optional[date] = None
    payout_cycle_id: Optional[str] = None
    confirm_duplicate: bool = False


class PayAllIn(BaseModel):
    mode: Literal["AUTO", "CASH", "UPI", "BANK"] = "AUTO"  # AUTO = each worker's own payment mode
    date: Optional[date] = None
    reference_no: str = ""
