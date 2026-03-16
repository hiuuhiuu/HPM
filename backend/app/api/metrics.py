from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import metrics_service, baseline_service

router = APIRouter(prefix="/api")

RangeKey = Literal["1h", "6h", "24h", "7d"]


@router.get("/services")
async def list_services(db: AsyncSession = Depends(get_db)):
    """등록된 서비스 목록"""
    return await metrics_service.get_services(db)


@router.get("/services/health")
async def services_health(db: AsyncSession = Depends(get_db)):
    """서비스 상태 목록 (대시보드 테이블용)"""
    return await metrics_service.get_services_health(db)


@router.get("/metrics/overview")
async def overview(db: AsyncSession = Depends(get_db)):
    """전체 현황 요약 (대시보드 상단 카드)"""
    return await metrics_service.get_overview(db)


@router.get("/metrics/{service}/summary")
async def service_summary(service: str, db: AsyncSession = Depends(get_db)):
    """서비스 최신 메트릭 요약"""
    return await metrics_service.get_service_summary(db, service)


@router.get("/metrics/{service}/timeseries")
async def timeseries(
    service: str,
    metric: str = Query(..., description="메트릭 이름 (예: jvm.memory.used)"),
    range: RangeKey = Query("1h", description="조회 범위: 1h / 6h / 24h / 7d"),
    db: AsyncSession = Depends(get_db),
):
    """시계열 데이터 조회 (차트용)"""
    if range not in metrics_service.RANGE_CONFIG:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 범위: {range}")
    return await metrics_service.get_timeseries(db, service, metric, range)


@router.get("/metrics/{service}/available")
async def available_metrics(service: str, db: AsyncSession = Depends(get_db)):
    """서비스에서 수집된 메트릭 이름 목록"""
    return await metrics_service.get_available_metrics(db, service)


@router.get("/metrics/{service}/baselines")
async def get_baselines(
    service: str,
    metrics: str = Query(..., description="쉼표 구분 메트릭 키 목록"),
    db: AsyncSession = Depends(get_db),
):
    """
    복수 메트릭의 통계적 베이스라인 일괄 조회.
    과거 7일 동일 시간대 데이터로 μ ± 2σ 정상 범위를 반환.
    샘플이 부족하면 해당 키의 값이 null.
    """
    metric_list = [m.strip() for m in metrics.split(",") if m.strip()]
    return await baseline_service.get_service_baselines(db, service, metric_list)


@router.get("/metrics/{service}/jvm-pools")
async def jvm_pools(
    service: str,
    range: RangeKey = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """JVM 힙 메모리 세부 풀 시계열 데이터"""
    return await metrics_service.get_jvm_memory_pools(db, service, range)
