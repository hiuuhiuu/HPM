"""
백그라운드 알림 체커 - 주기적으로 알림 규칙 평가
"""
import asyncio
import logging
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services.alerts_service import check_all_rules

logger = logging.getLogger(__name__)

_SCHEMA_READY = False  # 테이블 존재 확인 후 True로 전환


async def _wait_for_schema() -> bool:
    """alert_rules 테이블이 생성될 때까지 대기. 준비되면 True 반환."""
    from sqlalchemy import text
    for attempt in range(1, 31):  # 최대 5분 (10초 * 30)
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(text("SELECT 1 FROM alert_rules LIMIT 1"))
            logger.info("[AlertChecker] DB 스키마 확인 완료 — 알림 체크 시작")
            return True
        except Exception:
            if attempt == 1:
                logger.warning("[AlertChecker] alert_rules 테이블 미존재 — 스키마 초기화 대기 중...")
            await asyncio.sleep(10)
    logger.error("[AlertChecker] DB 스키마 준비 타임아웃 (5분). 알림 체커를 중단합니다.")
    return False


async def alert_checker_loop() -> None:
    """설정된 간격으로 모든 알림 규칙을 반복 평가"""
    global _SCHEMA_READY
    logger.info(f"[AlertChecker] 시작 (간격: {settings.alert_check_interval_s}초)")

    if not _SCHEMA_READY:
        _SCHEMA_READY = await _wait_for_schema()
    if not _SCHEMA_READY:
        return

    while True:
        await asyncio.sleep(settings.alert_check_interval_s)
        try:
            async with AsyncSessionLocal() as db:
                fired = await check_all_rules(db)
                if fired:
                    logger.info(f"[AlertChecker] {fired}개 알림 발화")
                    
                    try:
                        from app.core.websocket import manager
                        from app.services.metrics_service import get_overview
                        overview = await get_overview(db)
                        await manager.broadcast({
                            "type": "update",
                            "active_alerts": overview.get("active_alerts", 0)
                        })
                    except Exception as e:
                        logger.error(f"Failed to broadcast alert updates: {e}")
        except Exception as e:
            logger.error(f"[AlertChecker] 오류: {e}", exc_info=True)
