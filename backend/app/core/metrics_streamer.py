"""
메트릭 실시간 스트리밍 — 주기적으로 WebSocket broadcast
"""
import asyncio
import logging
import time
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# 스트리밍 간격(초). 짧을수록 실시간 체감이 크지만 DB 부하가 증가한다.
# 쿼리 3건(services + metrics + traces)은 ms 단위라 2초면 부하 여유.
STREAM_INTERVAL_S = 2

_CPU_NAMES    = ["jvm.cpu.usage", "process.cpu.usage", "jvm.process.cpu.usage"]
_MEM_USED     = ["jvm.memory.used", "jvm.memory.heap.used"]
_THREAD_NAMES = ["jvm.threads.count", "jvm.thread.count"]


_MEM_MAX = ["jvm.memory.max", "jvm.memory.heap.max"]
_ALL_METRIC_NAMES = _CPU_NAMES + _MEM_USED + _MEM_MAX + _THREAD_NAMES


async def _snapshot(db) -> dict:
    """활성 서비스별 최신 지표 한 번에 수집 (쿼리 3개로 N+1 제거)"""
    r = await db.execute(text(
        "SELECT name FROM services WHERE last_seen > NOW() - INTERVAL '2 minutes' ORDER BY name"
    ))
    services = [row[0] for row in r.fetchall()]
    if not services:
        return {}

    # ─── 쿼리 A: 서비스별 최신 메트릭 값 (GROUP BY 단일 쿼리) ───
    r = await db.execute(text("""
        SELECT DISTINCT ON (service, name) service, name, value
        FROM metrics
        WHERE service = ANY(:svcs)
          AND name    = ANY(:names)
          AND time    > NOW() - INTERVAL '10 minutes'
        ORDER BY service, name, time DESC
    """), {"svcs": services, "names": _ALL_METRIC_NAMES})
    metric_map: dict = {}
    for svc, name, val in r.fetchall():
        metric_map.setdefault(svc, {})[name] = val

    # ─── 쿼리 B: 서비스별 5분 트레이스 집계 ───
    r = await db.execute(text("""
        SELECT
            service,
            ROUND(CAST(AVG(duration_ms) AS numeric), 2) AS avg_ms,
            COUNT(*)                                     AS total,
            COUNT(*) FILTER (WHERE status = 'ERROR')    AS errors
        FROM traces
        WHERE service = ANY(:svcs)
          AND parent_span_id IS NULL
          AND start_time > NOW() - INTERVAL '5 minutes'
        GROUP BY service
    """), {"svcs": services})
    trace_map = {
        row[0]: (float(row[1] or 0), int(row[2] or 0), int(row[3] or 0))
        for row in r.fetchall()
    }

    result = {}
    for svc in services:
        m = metric_map.get(svc, {})
        cpu      = next((m[n] for n in _CPU_NAMES   if n in m), None)
        mem_used = next((m[n] for n in _MEM_USED     if n in m), None)
        mem_max  = next((m[n] for n in _MEM_MAX      if n in m), None)
        threads  = next((m[n] for n in _THREAD_NAMES if n in m), None)

        avg_ms, total, errors = trace_map.get(svc, (0.0, 0, 0))
        error_rate = round(errors / total * 100, 2) if total else 0.0
        tps        = round(total / 300, 2)  # 5분 = 300초

        result[svc] = {
            "cpu":              round(float(cpu) * 100, 2) if cpu is not None else None,
            "memory_used_mb":   round(float(mem_used) / 1048576, 1) if mem_used else None,
            "memory_max_mb":    round(float(mem_max)  / 1048576, 1) if mem_max  else None,
            "threads":          int(threads) if threads is not None else None,
            "avg_response_ms":  avg_ms,
            "tps":              tps,
            "error_rate":       error_rate,
            "request_count_5m": total,
            "error_count_5m":   errors,
        }

    return result


async def metrics_stream_loop() -> None:
    """STREAM_INTERVAL_S 간격으로 메트릭 스냅샷을 수집하여 /ws/metrics 구독자에게 broadcast"""
    from app.core.websocket import metrics_manager
    logger.info("[MetricsStreamer] 시작 (간격: %s초)", STREAM_INTERVAL_S)

    while True:
        await asyncio.sleep(STREAM_INTERVAL_S)

        if not metrics_manager.active_connections:
            continue

        try:
            async with AsyncSessionLocal() as db:
                snapshot = await _snapshot(db)
            if snapshot:
                await metrics_manager.broadcast({
                    "type": "metrics_snapshot",
                    "ts":   int(time.time() * 1000),
                    "services": snapshot,
                })
        except Exception as e:
            logger.error(f"[MetricsStreamer] 오류: {e}", exc_info=True)
