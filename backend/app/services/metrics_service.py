"""
메트릭 조회 서비스 - TimescaleDB time_bucket 활용
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.constants import RANGE_CONFIG, WAS_THREAD_ACTIVE

# ── JVM 공통 메트릭 (JEUS / Tomcat / WebLogic 모두 동일) ──────────────────
CPU_METRICS    = ["jvm.cpu.usage", "process.cpu.usage", "jvm.process.cpu.usage"]
MEMORY_METRICS = ["jvm.memory.used", "jvm.memory.heap.used"]
THREAD_METRICS = ["jvm.threads.count", "jvm.thread.count"]
HTTP_DURATION  = ["http.server.request.duration", "http.server.duration"]

# ── JVM 상세 메트릭 (GC, Memory Pool) ───────────────────────────────────
GC_DURATION     = ["jvm.gc.duration", "jvm.gc.pause"]
GC_COUNT        = ["jvm.gc.count", "jvm.gc.collections"]
MEMORY_POOL_USED = ["jvm.memory.used", "jvm.memory.heap.used"] # attributes filter 필요

# ── WAS 스레드풀 메트릭 (WAS별 이름 통합) ─────────────────────────────────
# JEUS     : jeus.threadpool.active / jeus.threadpool.max
# Tomcat   : tomcat.threads.busy / tomcat.threads.current
# WebLogic : weblogic.threadpool.execute_thread_total_count
# WAS_THREAD_ACTIVE: app.core.constants 에서 임포트
WAS_THREAD_TOTAL = [
    "jeus.threadpool.max",
    "tomcat.threads.current",
    "weblogic.threadpool.thread_total_count",
]
WAS_THREAD_IDLE = [
    "jeus.threadpool.idle",
    # Tomcat: current - busy 로 계산 (직접 메트릭 없음)
    # WebLogic: 직접 메트릭 없음
]

# ── DB 커넥션풀 메트릭 (WAS별 이름 통합) ──────────────────────────────────
# JEUS     : jeus.jcp.active / jeus.jcp.idle / jeus.jcp.wait
# Tomcat   : db.client.connections.usage (OTel 표준), tomcat.jdbc.connections.active
# WebLogic : weblogic.jdbc.connection_pool.active_count
WAS_JDBC_ACTIVE = [
    "jeus.jcp.active",
    "db.client.connections.usage",
    "tomcat.jdbc.connections.active",
    "weblogic.jdbc.connection_pool.active_count",
]
WAS_JDBC_IDLE = [
    "jeus.jcp.idle",
    "db.client.connections.idle",
    "tomcat.jdbc.connections.idle",
]
WAS_JDBC_WAIT = [
    "jeus.jcp.wait",
    "db.client.connections.pending_requests",
    "weblogic.jdbc.connection_pool.waiting_for_connection_current_count",
]

# ── 프론트엔드 요청명 → DB 실제 메트릭명 매핑 ────────────────────────────
# 프론트엔드는 항상 논리적인 이름으로 요청하고, 여기서 WAS별 실제 이름으로 확장
METRIC_ALIASES: Dict[str, List[str]] = {
    # JVM 공통
    "jvm.memory.used":              ["jvm.memory.used", "jvm.memory.heap.used"],
    "jvm.memory.max":               ["jvm.memory.max",  "jvm.memory.heap.max"],
    "jvm.cpu.usage":                CPU_METRICS,
    "jvm.threads.count":            THREAD_METRICS,
    "http.server.request.duration": HTTP_DURATION,
    # WAS 스레드풀 (JEUS / Tomcat / WebLogic 통합)
    "was.threadpool.active":        WAS_THREAD_ACTIVE,
    "was.threadpool.total":         WAS_THREAD_TOTAL,
    "was.threadpool.idle":          WAS_THREAD_IDLE,
    # DB 커넥션풀 (JEUS / Tomcat / WebLogic 통합)
    "was.jdbc.active":              WAS_JDBC_ACTIVE,
    "was.jdbc.idle":                WAS_JDBC_IDLE,
    "was.jdbc.wait":                WAS_JDBC_WAIT,
    # JVM 상세
    "jvm.gc.duration":              GC_DURATION,
    "jvm.gc.count":                 GC_COUNT,
    # JEUS 직접 이름도 그대로 수용 (하위 호환)
    "jeus.threadpool.active":       ["jeus.threadpool.active"],
    "jeus.threadpool.idle":         ["jeus.threadpool.idle"],
    "jeus.threadpool.max":          ["jeus.threadpool.max"],
    "jeus.jcp.active":              ["jeus.jcp.active"],
    "jeus.jcp.idle":                ["jeus.jcp.idle"],
    "jeus.jcp.wait":                ["jeus.jcp.wait"],
}


async def get_services(db: AsyncSession) -> List[Dict]:
    result = await db.execute(
        text("SELECT id, name, description, last_seen FROM services ORDER BY name")
    )
    return [dict(r._mapping) for r in result]


async def get_overview(db: AsyncSession) -> Dict[str, Any]:
    """대시보드 상단 요약: 서비스 수, 평균 응답시간, 에러율, 활성 알림"""
    # 서비스 수
    r = await db.execute(text("SELECT COUNT(*) FROM services"))
    services_count = r.scalar()

    # 최근 5분 평균 응답시간 (ms) - traces 테이블 루트 스팬 기준
    r = await db.execute(text("""
        SELECT AVG(duration_ms)
        FROM traces
        WHERE parent_span_id IS NULL
          AND start_time > NOW() - INTERVAL '5 minutes'
    """))
    avg_ms = r.scalar()

    # 최근 5분 에러 수 / 전체 스팬 수 → 에러율
    r = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'ERROR') AS errors,
            COUNT(*) AS total
        FROM traces
        WHERE start_time > NOW() - INTERVAL '5 minutes'
    """))
    row = r.mappings().one()
    total = row["total"] or 1
    error_rate = round((row["errors"] / total) * 100, 2)

    # 활성 알림 수
    r = await db.execute(
        text("SELECT COUNT(*) FROM alert_events WHERE status = 'firing'")
    )
    active_alerts = r.scalar()

    return {
        "services_count": services_count,
        "avg_response_time_ms": round(avg_ms, 2) if avg_ms else None,
        "error_rate_percent": error_rate,
        "active_alerts": active_alerts,
    }


async def get_service_summary(db: AsyncSession, service: str) -> Dict[str, Any]:
    """서비스 요약 카드: 최신 CPU/메모리/응답시간/스레드"""

    async def latest_metric(names: List[str], attr_filter: str = "") -> Optional[float]:
        sql = f"""
            SELECT value FROM metrics
            WHERE service = :service
              AND name = ANY(:names)
              {attr_filter}
            ORDER BY time DESC LIMIT 1
        """
        r = await db.execute(text(sql), {"service": service, "names": names})
        return r.scalar()

    cpu = await latest_metric(CPU_METRICS)
    memory_used = await latest_metric(
        MEMORY_METRICS,
        "AND (name = 'jvm.memory.heap.used' OR attributes->>'jvm.memory.type' = 'heap' OR attributes->>'jvm.memory.pool.name' ILIKE '%heap%')"
    )
    memory_max_r = await db.execute(text("""
        SELECT value FROM metrics
        WHERE service = :service
          AND name IN ('jvm.memory.max', 'jvm.memory.heap.max')
        ORDER BY time DESC LIMIT 1
    """), {"service": service})
    memory_max = memory_max_r.scalar()

    threads = await latest_metric(THREAD_METRICS)

    # 최근 5분 평균 응답시간 - traces 루트 스팬 기준
    r = await db.execute(text("""
        SELECT ROUND(CAST(AVG(duration_ms) AS numeric), 2)
        FROM traces
        WHERE service = :service
          AND parent_span_id IS NULL
          AND start_time > NOW() - INTERVAL '5 minutes'
    """), {"service": service})
    avg_response_ms = r.scalar()

    # 최근 5분 요청 수 - traces 루트 스팬 기준
    r = await db.execute(text("""
        SELECT COUNT(*)
        FROM traces
        WHERE service = :service
          AND parent_span_id IS NULL
          AND start_time > NOW() - INTERVAL '5 minutes'
    """), {"service": service})
    request_count = r.scalar()

    # 최근 5분 에러 수
    r = await db.execute(text("""
        SELECT COUNT(*) FROM errors
        WHERE service = :service
          AND time > NOW() - INTERVAL '5 minutes'
    """), {"service": service})
    error_count = r.scalar()

    def mb(v): return round(v / 1024 / 1024, 1) if v else None

    return {
        "service": service,
        "cpu_usage_percent": round(cpu * 100, 1) if cpu is not None else None,
        "memory_used_mb": mb(memory_used),
        "memory_max_mb": mb(memory_max),
        "memory_used_percent": (
            round(memory_used / memory_max * 100, 1)
            if memory_used and memory_max else None
        ),
        "avg_response_time_ms": round(avg_response_ms, 2) if avg_response_ms else None,
        "request_count_5m": int(request_count) if request_count else 0,
        "error_count_5m": int(error_count),
        "thread_count": int(threads) if threads else None,
    }


async def get_timeseries(
    db: AsyncSession,
    service: str,
    metric: str,
    range_key: str = "1h",
) -> Dict[str, Any]:
    """시계열 데이터 반환 (time_bucket 다운샘플링)"""
    cfg = RANGE_CONFIG.get(range_key, RANGE_CONFIG["1h"])
    interval = cfg["interval"]
    step = cfg["step"]

    metric_names = METRIC_ALIASES.get(metric, [metric])

    r = await db.execute(text(f"""
        SELECT
            time_bucket(INTERVAL '{step}', time) AS bucket,
            AVG(value)               AS value,
            MIN(value)               AS min_val,
            MAX(value)               AS max_val
        FROM metrics
        WHERE service = :service
          AND name    = ANY(:metrics)
          AND time    > NOW() - INTERVAL '{interval}'
        GROUP BY bucket
        ORDER BY bucket ASC
    """), {
        "service": service,
        "metrics": metric_names,
    })

    rows = r.mappings().all()

    # http.server.request.duration 계열 데이터가 없으면 traces 테이블로 폴백
    is_http_metric = metric in METRIC_ALIASES.get("http.server.request.duration", []) \
                     or metric == "http.server.request.duration"
    if not rows and is_http_metric:
        tr = await db.execute(text(f"""
            SELECT
                time_bucket(INTERVAL '{step}', start_time) AS bucket,
                AVG(duration_ms) / 1000                    AS value,
                MIN(duration_ms) / 1000                    AS min_val,
                MAX(duration_ms) / 1000                    AS max_val
            FROM traces
            WHERE service = :service
              AND parent_span_id IS NULL
              AND start_time > NOW() - INTERVAL '{interval}'
            GROUP BY bucket
            ORDER BY bucket ASC
        """), {"service": service})
        rows = tr.mappings().all()
        unit = "s"
    else:
        # 단위 조회
        unit_r = await db.execute(text("""
            SELECT unit FROM metrics
            WHERE service = :service AND name = ANY(:metrics)
            LIMIT 1
        """), {"service": service, "metrics": metric_names})
        unit = unit_r.scalar() or ""

    return {
        "metric":   metric,
        "service":  service,
        "unit":     unit,
        "range":    range_key,
        "data": [
            {
                "time":    row["bucket"].isoformat(),
                "value":   round(row["value"], 4) if row["value"] is not None else None,
                "min":     round(row["min_val"], 4) if row["min_val"] is not None else None,
                "max":     round(row["max_val"], 4) if row["max_val"] is not None else None,
            }
            for row in rows
        ],
    }


async def get_jvm_memory_pools(
    db: AsyncSession,
    service: str,
    range_key: str = "1h",
) -> Dict[str, Any]:
    """JVM 힙 메모리 세부 풀(Eden, Old, Survivor) 시계열 데이터"""
    cfg = RANGE_CONFIG.get(range_key, RANGE_CONFIG["1h"])
    interval = cfg["interval"]
    step = cfg["step"]

    # G1, CMS 등 다양한 이름 대응을 위한 ILIKE 필터링
    sql = f"""
        SELECT
            time_bucket(INTERVAL '{step}', time) AS bucket,
            attributes->>'jvm.memory.pool.name'   AS pool_name,
            AVG(value)                            AS value
        FROM metrics
        WHERE service = :service
          AND name IN ('jvm.memory.used', 'jvm.memory.heap.used')
          AND (
               attributes->>'jvm.memory.pool.name' ILIKE '%eden%'
            OR attributes->>'jvm.memory.pool.name' ILIKE '%old%'
            OR attributes->>'jvm.memory.pool.name' ILIKE '%survivor%'
          )
          AND time > NOW() - INTERVAL '{interval}'
        GROUP BY bucket, pool_name
        ORDER BY bucket ASC
    """
    
    r = await db.execute(text(sql), {"service": service})
    rows = r.mappings().all()

    # 데이터를 { pool_name: [points] } 형태로 재구성
    pools = {}
    for row in rows:
        p_name = row["pool_name"]
        if p_name not in pools:
            pools[p_name] = []
        pools[p_name].append({
            "time":  row["bucket"].isoformat(),
            "value": round(row["value"], 0)
        })

    return {
        "service": service,
        "range":   range_key,
        "pools":   pools
    }


async def get_available_metrics(db: AsyncSession, service: str) -> List[str]:
    """서비스에 수집된 메트릭 이름 목록"""
    r = await db.execute(text("""
        SELECT DISTINCT name FROM metrics
        WHERE service = :service
        ORDER BY name
    """), {"service": service})
    return [row[0] for row in r]


async def get_services_health(db: AsyncSession) -> List[Dict]:
    """서비스 목록 + 최근 상태 (대시보드 테이블용)"""
    r = await db.execute(text("""
        SELECT
            s.name,
            s.last_seen,
            (SELECT AVG(value) * 1000
             FROM metrics m
             WHERE m.service = s.name
               AND m.name = ANY(:http_names)
               AND m.time > NOW() - INTERVAL '5 minutes')  AS avg_response_ms,
            (SELECT COUNT(*)
             FROM errors e
             WHERE e.service = s.name
               AND e.time > NOW() - INTERVAL '5 minutes')  AS error_count_5m,
            (EXTRACT(EPOCH FROM (NOW() - s.last_seen)) < 120) AS is_alive
        FROM services s
        ORDER BY s.name
    """), {"http_names": HTTP_DURATION})

    rows = r.mappings().all()
    return [
        {
            "name":            row["name"],
            "last_seen":       row["last_seen"].isoformat() if row["last_seen"] else None,
            "avg_response_ms": round(row["avg_response_ms"], 1) if row["avg_response_ms"] else None,
            "error_count_5m":  int(row["error_count_5m"]),
            "is_alive":        bool(row["is_alive"]),
        }
        for row in rows
    ]
