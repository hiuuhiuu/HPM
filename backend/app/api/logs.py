from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import logs_service

router = APIRouter(prefix="/api")

RangeKey = Literal["1h", "6h", "24h", "7d"]
LogLevel = Literal["ALL", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]


@router.get("/logs")
async def list_logs(
    service:  Optional[str]  = Query(None),
    level:    Optional[LogLevel] = Query("ALL"),
    search:   Optional[str]  = Query(None, description="메시지 검색 (부분 일치)"),
    trace_id: Optional[str]  = Query(None, description="특정 트레이스의 로그만"),
    range:    RangeKey        = Query("1h"),
    page:     int             = Query(1, ge=1),
    limit:    int             = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """로그 목록 조회"""
    return await logs_service.get_log_list(
        db, service, level, search, trace_id, range, page, limit
    )


@router.get("/logs/stats")
async def log_stats(
    service: Optional[str] = Query(None),
    range:   RangeKey      = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """로그 통계 (레벨별 카운트, 시간대별 추이)"""
    return await logs_service.get_log_stats(db, service, range)
