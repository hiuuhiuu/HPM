from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    debug: bool = False

    # OTLP 수신 설정
    otlp_http_port: int = 4318
    otlp_grpc_port: int = 4317

    # 알림 설정
    alert_check_interval_s: int = 30

    class Config:
        env_file = ".env"


settings = Settings()
