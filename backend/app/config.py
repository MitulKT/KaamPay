"""App settings, read from environment variables (or a .env file)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "KaamPay"
    mongo_url: str = "mongodb://localhost:27017"
    db_name: str = "kaampay"

    jwt_secret: str = "change-me-in-production-please-32chars"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 12
    worker_refresh_days: int = 90
    staff_refresh_days: int = 30

    # OTP
    otp_provider: str = "dev"  # dev | msg91 | twilio
    otp_dev_code: str = "123456"
    otp_valid_minutes: int = 5
    otp_max_attempts: int = 5
    otp_max_per_hour: int = 5
    msg91_auth_key: str = ""
    msg91_template_id: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    # uploads (job-done photos) are stored in MongoDB
    max_upload_kb: int = 600

    # folder with the exported Expo web app; served at "/" when present
    web_dir: str = "web"

    # push notifications through Expo push service
    expo_push_enabled: bool = False

    timezone: str = "Asia/Kolkata"


settings = Settings()
