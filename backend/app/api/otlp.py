"""
OTLP (OpenTelemetry Protocol) HTTP 수신 엔드포인트

Java Agent 설정 예시:
  -javaagent:/path/to/opentelemetry-javaagent.jar
  -Dotel.exporter.otlp.endpoint=http://<APM_HOST>:8000/otlp
  -Dotel.exporter.otlp.protocol=http/protobuf
"""
import logging

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import otlp_processor

logger = logging.getLogger(__name__)
router = APIRouter()

# OTLP HTTP 표준 응답: 빈 protobuf ExportXxxServiceResponse (HTTP 200)
_EMPTY_RESPONSE = Response(status_code=200, media_type="application/x-protobuf")


@router.post("/v1/metrics")
async def receive_metrics(request: Request, db: AsyncSession = Depends(get_db)):
    """OTLP HTTP Metrics 수신 (application/x-protobuf)"""
    body = await request.body()
    if not body:
        return _EMPTY_RESPONSE
    try:
        count = await otlp_processor.process_metrics(db, body)
        logger.debug(f"Metrics 처리 완료: {count}개")
    except Exception as e:
        logger.error(f"Metrics 처리 실패: {e}", exc_info=True)
    return _EMPTY_RESPONSE


@router.post("/v1/traces")
async def receive_traces(request: Request, db: AsyncSession = Depends(get_db)):
    """OTLP HTTP Traces 수신 (application/x-protobuf)"""
    body = await request.body()
    if not body:
        return _EMPTY_RESPONSE
    try:
        count = await otlp_processor.process_traces(db, body)
        logger.debug(f"Traces 처리 완료: {count}개")
    except Exception as e:
        logger.error(f"Traces 처리 실패: {e}", exc_info=True)
    return _EMPTY_RESPONSE


@router.post("/v1/logs")
async def receive_logs(request: Request, db: AsyncSession = Depends(get_db)):
    """OTLP HTTP Logs 수신 (application/x-protobuf)"""
    body = await request.body()
    if not body:
        return _EMPTY_RESPONSE
    try:
        count = await otlp_processor.process_logs(db, body)
        logger.debug(f"Logs 처리 완료: {count}개")
    except Exception as e:
        logger.error(f"Logs 처리 실패: {e}", exc_info=True)
    return _EMPTY_RESPONSE
