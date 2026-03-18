import logging
from typing import List
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

_DEFAULT_SECRET = "apm-secret-key-change-in-production"


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://apm:apm1234@localhost:5432/apmdb"
    secret_key: str = _DEFAULT_SECRET
    debug: bool = False

    # CORS — 쉼표 구분 허용 오리진 목록 (.env: ALLOWED_ORIGINS=http://host1,http://host2)
    allowed_origins: List[str] = []

    # OTLP 수신 설정
    otlp_http_port: int = 4318
    otlp_grpc_port: int = 4317

    # 알림 설정
    alert_check_interval_s: int = 30

    class Config:
        env_file = ".env"


settings = Settings()

if settings.secret_key == _DEFAULT_SECRET:
    logger.warning(
        "[Config] SECRET_KEY가 기본값입니다. 운영 환경에서는 반드시 .env에서 변경하세요."
    )
