import asyncio
import json
import time
from typing import Literal, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import metrics_service, baseline_service

router = APIRouter(prefix="/api")

RangeKey = Literal["1h", "6h", "24h", "7d"]


@router.get("/metrics/stream")
async def metrics_sse():
    """Server-Sent Events — WebSocket 미지원 프록시 환경을 위한 폴백.

    중간 프록시가 WebSocket Upgrade 헤더를 제거하는 경우
    프론트엔드가 /ws/metrics 대신 이 엔드포인트로 자동 전환한다.
    5초마다 metrics_snapshot 이벤트를 push 한다.
    """
    async def generate() -> AsyncGenerator[str, None]:
        from app.core.metrics_streamer import _snapshot
        from app.core.database import AsyncSessionLocal

        while True:
            try:
                async with AsyncSessionLocal() as db:
                    snapshot = await _snapshot(db)
                data = {
                    "type": "metrics_snapshot",
                    "ts":   int(time.time() * 1000),
                    "services": snapshot or {},
                }
                yield f"data: {json.dumps(data)}\n\n"
            except Exception:
                # 오류 시 빈 snapshot 전송 후 계속 유지
                yield f"data: {json.dumps({'type': 'metrics_snapshot', 'ts': int(time.time() * 1000), 'services': {}})}\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",   # nginx 버퍼링 비활성화 (SSE 즉시 전달)
        },
    )


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
