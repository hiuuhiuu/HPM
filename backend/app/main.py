import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import health, otlp, metrics, traces, errors, logs, dashboard, alerts, stats, thread_dumps, insights, ws, services, agents, deployments
from app.core.config import settings
from app.core.alert_checker import alert_checker_loop
from app.core.metrics_streamer import metrics_stream_loop
from app.core.websocket import manager, metrics_manager
from app.core.database import AsyncSessionLocal, ensure_indexes, ensure_errors_migration, ensure_agent_configs_table, ensure_deployments_table
from app.services import settings_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)


async def _ws_ping_loop() -> None:
    """30초마다 WebSocket 연결 상태를 확인하여 좀비 연결 제거"""
    while True:
        await asyncio.sleep(30)
        await manager.ping_all()
        await metrics_manager.ping_all()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 앱 시작: 시스템 설정에 따른 데이터 보존 정책 초기화 (에러 무시)
    try:
        async with AsyncSessionLocal() as session:
            await settings_service.initialize_retention_policies(session)
    except Exception as e:
        logging.warning(f"데이터 보존 정책 초기화 실패: {e}")

    # DB 인덱스 보장 (기존 설치 호환)
    await ensure_indexes()
    # errors 테이블 마이그레이션 (count/first_seen/dedup/unique index)
    await ensure_errors_migration()
    # agent_configs 테이블 생성 (에이전트별 설정 저장)
    await ensure_agent_configs_table()
    # deployments 테이블 생성 (배포 마커)
    await ensure_deployments_table()

    # 스팬 노이즈 필터 활성 카테고리 로그
    from app.core.span_filter import is_enabled, active_categories
    active = [k for k, v in active_categories().items() if v]
    logging.getLogger(__name__).info(
        "[SpanFilter] enabled=%s active=%s", is_enabled(), ",".join(active) or "—",
    )

    # 앱 시작: 백그라운드 태스크 실행
    checker_task  = asyncio.create_task(alert_checker_loop())
    streamer_task = asyncio.create_task(metrics_stream_loop())
    ping_task     = asyncio.create_task(_ws_ping_loop())
    yield
    # 앱 종료: 태스크 취소
    for task in (checker_task, streamer_task, ping_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="APM Server",
    description="Application Performance Monitoring - Custom APM Backend",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

_cors_origins = settings.allowed_origins if settings.allowed_origins else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=bool(settings.allowed_origins),  # wildcard + credentials 조합 금지
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(health.router, tags=["health"])
app.include_router(otlp.router, prefix="/otlp", tags=["otlp"])
app.include_router(metrics.router, tags=["metrics"])
app.include_router(traces.router, tags=["traces"])
app.include_router(errors.router, tags=["errors"])
app.include_router(logs.router, tags=["logs"])
app.include_router(dashboard.router, tags=["dashboard"])
app.include_router(alerts.router, tags=["alerts"])
app.include_router(stats.router, tags=["stats"])
app.include_router(thread_dumps.router, tags=["thread-dumps"])
app.include_router(insights.router, tags=["insights"])
app.include_router(ws.router, tags=["websocket"])
app.include_router(services.router, tags=["services"])
app.include_router(agents.router, tags=["agents"])
app.include_router(deployments.router, tags=["deployments"])
from app.api import settings as settings_api
app.include_router(settings_api.router, prefix="/api/settings", tags=["settings"])

@app.get("/")
async def root():
    return {"message": "APM Server is running", "version": "0.1.0"}
