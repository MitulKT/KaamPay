"""OTP providers behind one interface so MSG91 / Twilio / Firebase can be swapped by env var."""
import hashlib
import logging
import secrets

import httpx

from .config import settings

log = logging.getLogger("otp")


def hash_otp(mobile: str, code: str) -> str:
    return hashlib.sha256(f"{mobile}:{code}:{settings.jwt_secret}".encode()).hexdigest()


class OTPProvider:
    def generate(self, mobile: str) -> str:
        return f"{secrets.randbelow(1_000_000):06d}"

    async def send(self, mobile: str, code: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class DevProvider(OTPProvider):
    """Always 123456 (configurable). Never use in production."""

    def generate(self, mobile: str) -> str:
        return settings.otp_dev_code

    async def send(self, mobile: str, code: str) -> None:
        log.warning("DEV OTP for %s is %s", mobile, code)


class Msg91Provider(OTPProvider):
    """MSG91 OTP API. Needs a DLT-approved template in India (takes a few days)."""

    async def send(self, mobile: str, code: str) -> None:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                "https://control.msg91.com/api/v5/otp",
                params={"template_id": settings.msg91_template_id, "mobile": f"91{mobile}", "otp": code},
                headers={"authkey": settings.msg91_auth_key},
            )
            r.raise_for_status()


class TwilioProvider(OTPProvider):
    async def send(self, mobile: str, code: str) -> None:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json",
                auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                data={"To": f"+91{mobile}", "From": settings.twilio_from_number,
                      "Body": f"{code} is your KaamPay login OTP. Valid 5 minutes."},
            )
            r.raise_for_status()


def get_provider() -> OTPProvider:
    return {"msg91": Msg91Provider, "twilio": TwilioProvider}.get(settings.otp_provider, DevProvider)()
