import logging
from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)

_DEFAULT_SETTINGS = {
    "retention_traces_days":  ("14", "트레이스 데이터 보존 기간(일)"),
    "retention_metrics_days": ("30", "메트릭 데이터 보존 기간(일)"),
    "retention_logs_days":    ("30", "로그 데이터 보존 기간(일)"),
}


async def _ensure_settings_table(db: AsyncSession) -> None:
    """system_settings 테이블이 없으면 생성하고 기본값을 삽입합니다 (기존 설치 호환)."""
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            description TEXT,
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    for key, (value, description) in _DEFAULT_SETTINGS.items():
        await db.execute(
            text("""
                INSERT INTO system_settings (key, value, description)
                VALUES (:key, :value, :description)
                ON CONFLICT (key) DO NOTHING
            """),
            {"key": key, "value": value, "description": description},
        )
    await db.commit()


async def get_all_settings(db: AsyncSession) -> Dict[str, str]:
    """모든 시스템 설정 조회. 테이블이 없으면 자동 생성합니다."""
    try:
        result = await db.execute(text("SELECT key, value FROM system_settings"))
        return {row["key"]: row["value"] for row in result.mappings().all()}
    except Exception:
        await db.rollback()
        await _ensure_settings_table(db)
        result = await db.execute(text("SELECT key, value FROM system_settings"))
        return {row["key"]: row["value"] for row in result.mappings().all()}

async def update_settings(db: AsyncSession, settings: Dict[str, str]) -> None:
    """시스템 설정 일괄 갱신 및 보존 정책 업데이트"""
    # 테이블이 없을 경우 자동 생성 (기존 설치 호환)
    await _ensure_settings_table(db)

    # DB 설정 업데이트
    for key, value in settings.items():
        await db.execute(
            text("""
                INSERT INTO system_settings (key, value)
                VALUES (:key, :value)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """),
            {"key": key, "value": str(value)}
        )

    await db.commit()

    # 2. 보존 정책(Retention Policy) 갱신 적용 로직
    # retention_traces_days, retention_metrics_days, retention_logs_days 항목 확인
    if "retention_traces_days" in settings:
        await _apply_retention_policy(db, "traces", int(settings["retention_traces_days"]))
    if "retention_metrics_days" in settings:
        await _apply_retention_policy(db, "metrics", int(settings["retention_metrics_days"]))
    if "retention_logs_days" in settings:
        await _apply_retention_policy(db, "logs", int(settings["retention_logs_days"]))


async def _apply_retention_policy(db: AsyncSession, table_name: str, days: int) -> None:
    """특정 테이블에 대한 TimescaleDB 보존 정책 갱신"""
    if days <= 0:
        return

    try:
        await db.execute(text(f"SELECT remove_retention_policy('{table_name}', if_exists => true)"))
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.warning("보존 정책 제거 실패(table=%s): %s", table_name, e)

    try:
        await db.execute(text(f"SELECT add_retention_policy('{table_name}', INTERVAL '{days} days', if_not_exists => true)"))
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.warning("보존 정책 추가 실패(table=%s, days=%s): %s", table_name, days, e)

async def initialize_retention_policies(db: AsyncSession) -> None:
    """서버 구동 시 초기 보존 정책(시스템 설정값 기준) 반영"""
    settings = await get_all_settings(db)
    
    traces_days = int(settings.get("retention_traces_days", "14"))
    metrics_days = int(settings.get("retention_metrics_days", "30"))
    logs_days = int(settings.get("retention_logs_days", "30"))
    
    await _apply_retention_policy(db, "traces", traces_days)
    await _apply_retention_policy(db, "metrics", metrics_days)
    await _apply_retention_policy(db, "logs", logs_days)
