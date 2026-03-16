from datetime import datetime, timezone
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.services import stats_service

router = APIRouter(prefix="/api/stats")


class StatPoint(BaseModel):
    time: str
    request_count: int
    error_count: int
    error_rate_pct: float
    avg_ms: float
    tps: float


class StatsSummary(BaseModel):
    total_requests: int
    total_errors: int
    avg_response_ms: float
    error_rate_percent: float
    peak_tps: float
    data_points: int
    truncated: bool


class StatsResponse(BaseModel):
    summary: StatsSummary
    data: List[StatPoint]


@router.get("", response_model=StatsResponse)
async def get_stats(
    granularity: Literal["minute", "hour", "day"] = Query("hour"),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    service: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        from_dt = datetime.fromisoformat(from_) if from_ else None
        to_dt   = datetime.fromisoformat(to)    if to    else None
    except ValueError as e:
        raise HTTPException(400, f"날짜 형식 오류: {e}")

    def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
        if dt is None:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    return await stats_service.get_stats(
        db, granularity, ensure_utc(from_dt), ensure_utc(to_dt), service
    )
