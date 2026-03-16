from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import traces_service

router = APIRouter(prefix="/api")

RangeKey = Literal["15m", "1h", "6h", "24h", "7d"]


@router.get("/traces")
async def list_traces(
    service: Optional[str] = Query(None),
    status:  Optional[Literal["OK", "ERROR"]] = Query(None),
    range:   RangeKey = Query("1h"),
    page:    int = Query(1, ge=1),
    limit:   int = Query(20, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """트레이스 목록 (필터: service, status, range)"""
    return await traces_service.get_trace_list(db, service, status, range, page, limit)


@router.get("/traces/{trace_id}")
async def get_trace(trace_id: str, db: AsyncSession = Depends(get_db)):
    """트레이스 상세 (Waterfall용 전체 스팬)"""
    detail = await traces_service.get_trace_detail(db, trace_id)
    if not detail:
        raise HTTPException(status_code=404, detail="트레이스를 찾을 수 없습니다.")
    return detail


@router.get("/traces/stats/{service}")
async def trace_stats(
    service: str,
    range: RangeKey = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """서비스 트레이스 통계 (p50/p95/p99)"""
    return await traces_service.get_trace_stats(db, service, range)


@router.get("/slow-queries")
async def slow_queries(
    service: Optional[str] = Query(None),
    range: RangeKey = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """DB 슬로우 쿼리 집계 (db.statement 속성 기준, 응답시간 내림차순)"""
    return await traces_service.get_slow_queries(db, service, range)
