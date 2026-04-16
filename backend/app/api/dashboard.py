from typing import List, Literal, Optional, Union
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core import active_transactions
from app.services import dashboard_service

router = APIRouter(prefix="/api/dashboard")

RangeKey = Literal["10m", "1h", "6h", "24h", "7d"]


@router.get("/request-rate")
async def request_rate(
    service:  Optional[str] = Query(None),
    instance: Optional[str] = Query(None),
    range:    RangeKey      = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """시간대별 요청 수 / 에러율 차트 데이터"""
    return await dashboard_service.get_request_rate(db, service, range, instance)


@router.get("/top-endpoints")
async def top_endpoints(
    service:  Optional[str] = Query(None),
    instance: Optional[str] = Query(None),
    range:    RangeKey      = Query("1h"),
    limit:    int           = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """응답시간 기준 느린 엔드포인트 Top N"""
    return await dashboard_service.get_top_endpoints(db, service, range, limit, instance)


@router.get("/recent-errors")
async def recent_errors(
    service: Optional[str] = Query(None),
    limit:   int           = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """최근 미해결 에러"""
    return await dashboard_service.get_recent_errors(db, service, limit)


@router.get("/scatter")
async def scatter(
    service:  Optional[str] = Query(None),
    instance: Optional[str] = Query(None),
    range:    RangeKey      = Query("1h"),
    limit:    int           = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
):
    """트랜잭션 산점도: X=시간, Y=응답시간"""
    return await dashboard_service.get_scatter(db, service, range, limit, instance)


@router.get("/service-activity")
async def service_activity(
    range: RangeKey = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """서비스별 요청 수 + 에러율 (대시보드 서비스 패널용)"""
    return await dashboard_service.get_service_activity(db, range)


@router.get("/instance-activity")
async def instance_activity(
    range: RangeKey = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """인스턴스별 요청 수 + 에러율 (대시보드 인스턴스 패널용)"""
    return await dashboard_service.get_instance_activity(db, range)


TopoLevel = Literal["service", "instance"]

@router.get("/topology")
async def get_topology(
    range: RangeKey  = Query("1h"),
    level: TopoLevel = Query("service"),
    db: AsyncSession = Depends(get_db),
):
    """서비스/인스턴스 토폴로지 맵 데이터 (노드 + 엣지)
    level=service  : 서비스 단위 (기본값)
    level=instance : WAS 인스턴스 단위
    """
    if level == "instance":
        return await dashboard_service.get_instance_topology(db, range)
    return await dashboard_service.get_service_topology(db, range)


@router.get("/active-summary")
async def active_summary():
    """에이전트 비콘 기반 현재 활성 거래 요약"""
    return active_transactions.get_active_summary()


class ActiveTransactionItem(BaseModel):
    trace_id:   str
    span_name:  str
    duration_ms: float
    status:     str = "OK"
    started_at: Optional[str] = None


class BeaconPayload(BaseModel):
    service:      str
    instance:     str
    transactions: List[ActiveTransactionItem] = Field(default_factory=list)


@router.post("/active-transactions/beacon")
async def receive_beacon(payload: BeaconPayload):
    """에이전트가 주기적으로 보내는 활성 거래 비콘.
    에이전트는 현재 처리 중인 root SERVER 스팬 목록을 3초 주기로 전송한다."""
    active_transactions.receive_beacon(
        service=payload.service,
        instance=payload.instance,
        transactions=[t.model_dump() for t in payload.transactions],
    )
    return {"status": "ok"}
