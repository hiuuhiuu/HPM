"""
대시보드 전용 서비스 - 종합 현황 데이터 제공
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

RANGE_INTERVAL = {
    "10m": "10 minutes",
    "1h": "1 hour", "6h": "6 hours", "24h": "24 hours", "7d": "7 days",
}
RANGE_STEP = {
    "1h": "1 minute", "6h": "5 minutes", "24h": "15 minutes", "7d": "1 hour",
}
RANGE_STEP_SECONDS = {
    "10m": 60, "1h": 60, "6h": 300, "24h": 900, "7d": 3600,
}

WAS_THREAD_ACTIVE = [
    "was.threadpool.active",
    "jeus.threadpool.active",
    "tomcat.threads.busy",
    "weblogic.threadpool.execute_thread_total_count"
]


async def get_request_rate(
    db: AsyncSession,
    service: Optional[str] = None,
    range_key: str = "1h",
    instance: Optional[str] = None,
) -> List[Dict]:
    """시간대별 요청 수 + 에러 수 + TPS (루트 스팬 기준)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")
    step = RANGE_STEP.get(range_key, "1 minute")
    step_seconds = RANGE_STEP_SECONDS.get(range_key, 60)

    cond = f"parent_span_id IS NULL AND start_time > NOW() - INTERVAL '{interval}'"
    params: Dict[str, Any] = {}
    if instance:
        cond += " AND instance = :instance"
        params["instance"] = instance
    elif service:
        cond += " AND service = :service"
        params["service"] = service

    r = await db.execute(text(f"""
        SELECT
            time_bucket(INTERVAL '{step}', start_time)                           AS bucket,
            COUNT(*)                                                             AS request_count,
            COUNT(*) FILTER (WHERE status = 'ERROR')                            AS error_count,
            ROUND(
                COUNT(*) FILTER (WHERE status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2
            )                                                                    AS error_rate_pct,
            ROUND(CAST(AVG(duration_ms) AS numeric), 1)                         AS avg_ms
        FROM traces
        WHERE {cond}
        GROUP BY bucket
        ORDER BY bucket ASC
    """), params)

    rows = r.mappings().all()
    return [
        {
            "time":           row["bucket"].isoformat(),
            "request_count":  int(row["request_count"] or 0),
            "error_count":    int(row["error_count"] or 0),
            "error_rate_pct": float(row["error_rate_pct"] or 0),
            "avg_ms":         float(row["avg_ms"] or 0),
            "tps":            round(int(row["request_count"] or 0) / step_seconds, 3),
        }
        for row in rows
    ]


async def get_top_endpoints(
    db: AsyncSession,
    service: Optional[str] = None,
    range_key: str = "1h",
    limit: int = 10,
    instance: Optional[str] = None,
) -> List[Dict]:
    """응답시간 기준 상위 느린 엔드포인트 (루트 스팬)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    cond = f"parent_span_id IS NULL AND start_time > NOW() - INTERVAL '{interval}'"
    params: Dict[str, Any] = {"limit": limit}
    if instance:
        cond += " AND instance = :instance"
        params["instance"] = instance
    elif service:
        cond += " AND service = :service"
        params["service"] = service

    r = await db.execute(text(f"""
        SELECT
            name,
            service,
            COUNT(*)                                                              AS request_count,
            ROUND(CAST(AVG(duration_ms) AS numeric), 1)                          AS avg_ms,
            ROUND(
                CAST(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS numeric), 1
            )                                                                     AS p95_ms,
            COUNT(*) FILTER (WHERE status = 'ERROR')                             AS error_count,
            ROUND(
                COUNT(*) FILTER (WHERE status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2
            )                                                                     AS error_rate_pct
        FROM traces
        WHERE {cond}
        GROUP BY name, service
        ORDER BY avg_ms DESC
        LIMIT :limit
    """), params)

    rows = r.mappings().all()
    return [
        {
            "name":           row["name"],
            "service":        row["service"],
            "request_count":  int(row["request_count"] or 0),
            "avg_ms":         float(row["avg_ms"] or 0),
            "p95_ms":         float(row["p95_ms"] or 0),
            "error_count":    int(row["error_count"] or 0),
            "error_rate_pct": float(row["error_rate_pct"] or 0),
        }
        for row in rows
    ]


async def get_recent_errors(
    db: AsyncSession,
    service: Optional[str] = None,
    limit: int = 5,
) -> List[Dict]:
    """최근 미해결 에러 목록"""
    cond = "NOT resolved"
    params: Dict[str, Any] = {"limit": limit}
    if service:
        cond += " AND service = :service"
        params["service"] = service

    r = await db.execute(text(f"""
        SELECT id, time, service, error_type, message, trace_id,
               COALESCE(count, 1) AS count
        FROM errors
        WHERE {cond}
        ORDER BY time DESC
        LIMIT :limit
    """), params)

    rows = r.mappings().all()
    return [
        {
            "id":         row["id"],
            "time":       row["time"].isoformat(),
            "service":    row["service"],
            "error_type": row["error_type"],
            "message":    row["message"],
            "trace_id":   row["trace_id"],
            "count":      int(row["count"]),
        }
        for row in rows
    ]


async def get_scatter(
    db: AsyncSession,
    service: Optional[str] = None,
    range_key: str = "1h",
    limit: int = 500,
    instance: Optional[str] = None,
) -> List[Dict]:
    """트랜잭션 산점도: X=시간(epoch ms), Y=응답시간(ms), 루트 스팬 기준"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    cond = f"parent_span_id IS NULL AND start_time > NOW() - INTERVAL '{interval}'"
    params: Dict[str, Any] = {"limit": limit}
    if instance:
        cond += " AND instance = :instance"
        params["instance"] = instance
    elif service:
        cond += " AND service = :service"
        params["service"] = service

    r = await db.execute(text(f"""
        SELECT
            EXTRACT(EPOCH FROM start_time) * 1000 AS ts,
            duration_ms,
            trace_id,
            service,
            name AS root_name,
            status
        FROM traces
        WHERE {cond}
        ORDER BY start_time DESC
        LIMIT :limit
    """), params)

    rows = r.mappings().all()
    return [
        {
            "ts":          int(row["ts"] or 0),
            "duration_ms": round(row["duration_ms"] or 0, 2),
            "trace_id":    row["trace_id"],
            "service":     row["service"],
            "root_name":   row["root_name"] or "unknown",
            "status":      row["status"],
        }
        for row in rows
    ]


async def get_service_activity(
    db: AsyncSession,
    range_key: str = "1h",
) -> List[Dict]:
    """서비스별 요청 수 + 에러율 요약 (대시보드 서비스 패널용)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    # 1. 기간 내 통계 집계 (한 번의 스캔으로 root/all 동시 계산)
    stats_sql = f"""
        SELECT 
            service,
            MAX(start_time)                                                      AS last_trace,
            COUNT(*) FILTER (WHERE parent_span_id IS NULL)                       AS request_count,
            COUNT(*) FILTER (WHERE parent_span_id IS NULL AND status = 'ERROR')   AS error_count,
            ROUND(CAST(AVG(duration_ms) AS numeric), 1)                         AS avg_ms
        FROM traces
        WHERE start_time > NOW() - INTERVAL '{interval}'
        GROUP BY service
    """
    
    # 2. 서비스 목록과 조인
    # is_alive 판단을 위한 최신 시간(최근 24시간 내)도 함께 가져옴
    sql = f"""
        SELECT 
            s.name                                                               AS service,
            s.last_seen                                                          AS service_last_seen,
            COALESCE(st.last_trace, (
                SELECT MAX(start_time) FROM traces 
                WHERE service = s.name AND start_time > NOW() - INTERVAL '24 hours'
            ))                                                                   AS last_seen,
            st.request_count,
            st.error_count,
            st.avg_ms
        FROM services s
        LEFT JOIN ({stats_sql}) st ON st.service = s.name
        ORDER BY s.name
    """

    r = await db.execute(text(sql))
    rows = r.mappings().all()

    items = []
    for row in rows:
        last_seen = row["last_seen"]
        is_alive = False
        if last_seen:
            # 최근 2분 내 트레이스가 있으면 살아있는 것으로 간주
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc)
            is_alive = (now - last_seen).total_seconds() < 120

        items.append({
            "service":       row["service"],
            "last_seen":     last_seen.isoformat() if last_seen else None,
            "is_alive":      is_alive,
            "request_count": int(row["request_count"] or 0),
            "error_count":   int(row["error_count"] or 0),
            "avg_ms":        float(row["avg_ms"]) if row["avg_ms"] else None,
        })
    return items


async def get_instance_activity(
    db: AsyncSession,
    range_key: str = "1h",
) -> List[Dict]:
    """인스턴스별 요청 수 + 에러율 요약 (대시보드 인스턴스 패널용)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    # 인스턴스별 통계와 최신 트레이스 시간을 한 번에 집계
    # 최근 24시간 내 트레이스가 있는 인스턴스들 대상
    sql = f"""
        SELECT
            instance,
            service,
            MAX(start_time)                                                      AS last_seen,
            COUNT(*) FILTER (WHERE parent_span_id IS NULL 
                             AND start_time > NOW() - INTERVAL '{interval}')     AS request_count,
            COUNT(*) FILTER (WHERE parent_span_id IS NULL AND status = 'ERROR' 
                             AND start_time > NOW() - INTERVAL '{interval}')     AS error_count,
            ROUND(CAST(AVG(duration_ms) FILTER (WHERE start_time > NOW() - INTERVAL '{interval}') 
                       AS numeric), 1)                                           AS avg_ms
        FROM traces
        WHERE start_time > NOW() - INTERVAL '24 hours'
          AND instance IS NOT NULL
        GROUP BY instance, service
        HAVING MAX(start_time) > NOW() - INTERVAL '24 hours' -- 혹은 전체 기간 유지
        ORDER BY service, instance
    """

    r = await db.execute(text(sql))
    rows = r.mappings().all()

    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)

    return [
        {
            "instance":      row["instance"],
            "service":       row["service"],
            "last_seen":     row["last_seen"].isoformat() if row["last_seen"] else None,
            "is_alive":      (now - row["last_seen"]).total_seconds() < 120 if row["last_seen"] else False,
            "request_count": int(row["request_count"] or 0),
            "error_count":   int(row["error_count"] or 0),
            "avg_ms":        float(row["avg_ms"]) if row["avg_ms"] else None,
        }
        for row in rows
    ]


async def get_service_topology(
    db: AsyncSession,
    range_key: str = "1h",
) -> Dict[str, List]:
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    # 엣지: parent.span_id = child.parent_span_id self-join으로 서비스 간 호출 추출
    er = await db.execute(text(f"""
        SELECT
            parent.service                                                    AS source,
            child.service                                                     AS target,
            COUNT(*)                                                          AS call_count,
            ROUND(CAST(AVG(child.duration_ms) AS numeric), 1)                AS avg_ms,
            COUNT(*) FILTER (WHERE child.status = 'ERROR')                   AS error_count,
            ROUND(COUNT(*) FILTER (WHERE child.status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2)                                    AS error_rate_pct
        FROM traces child
        JOIN traces parent
            ON child.trace_id      = parent.trace_id
           AND child.parent_span_id = parent.span_id
        WHERE child.start_time > NOW() - INTERVAL '{interval}'
          AND parent.service != child.service
        GROUP BY parent.service, child.service
        ORDER BY call_count DESC
    """), {})
    edges = [
        {
            "source":         row["source"],
            "target":         row["target"],
            "call_count":     int(row["call_count"] or 0),
            "avg_ms":         float(row["avg_ms"] or 0),
            "error_count":    int(row["error_count"] or 0),
            "error_rate_pct": float(row["error_rate_pct"] or 0),
        }
        for row in er.mappings().all()
        if row["source"] != row["target"]
    ]

    # 노드: 기간 내 등장한 모든 서비스 집계
    nr = await db.execute(text(f"""
        SELECT
            service,
            COUNT(*)                                                          AS span_count,
            COUNT(*) FILTER (WHERE parent_span_id IS NULL)                   AS request_count,
            ROUND(CAST(AVG(duration_ms) AS numeric), 1)                      AS avg_ms,
            COUNT(*) FILTER (WHERE status = 'ERROR')                         AS error_count,
            ROUND(COUNT(*) FILTER (WHERE status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2)                                    AS error_rate_pct
        FROM traces
        WHERE start_time > NOW() - INTERVAL '{interval}'
        GROUP BY service
        ORDER BY span_count DESC
    """), {})
    nodes = [
        {
            "id":             row["service"],
            "span_count":     int(row["span_count"] or 0),
            "request_count":  int(row["request_count"] or 0),
            "avg_ms":         float(row["avg_ms"] or 0),
            "error_count":    int(row["error_count"] or 0),
            "error_rate_pct": float(row["error_rate_pct"] or 0),
        }
        for row in nr.mappings().all()
    ]

    return {"nodes": nodes, "edges": edges}


async def get_instance_topology(
    db: AsyncSession,
    range_key: str = "1h",
) -> Dict[str, List]:
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    # 엣지: 인스턴스 간 호출 관계 (같은 인스턴스 내부 호출 제외)
    er = await db.execute(text(f"""
        SELECT
            parent.instance                                                   AS source,
            child.instance                                                    AS target,
            parent.service                                                    AS source_service,
            child.service                                                     AS target_service,
            COUNT(*)                                                          AS call_count,
            ROUND(CAST(AVG(child.duration_ms) AS numeric), 1)                AS avg_ms,
            COUNT(*) FILTER (WHERE child.status = 'ERROR')                   AS error_count,
            ROUND(COUNT(*) FILTER (WHERE child.status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2)                                    AS error_rate_pct
        FROM traces child
        JOIN traces parent
            ON child.trace_id      = parent.trace_id
           AND child.parent_span_id = parent.span_id
        WHERE child.start_time > NOW() - INTERVAL '{interval}'
          AND parent.instance IS NOT NULL
          AND child.instance  IS NOT NULL
          AND parent.instance != child.instance
        GROUP BY parent.instance, child.instance, parent.service, child.service
        ORDER BY call_count DESC
    """), {})
    edges = [
        {
            "source":         row["source"],
            "target":         row["target"],
            "source_service": row["source_service"],
            "target_service": row["target_service"],
            "call_count":     int(row["call_count"] or 0),
            "avg_ms":         float(row["avg_ms"] or 0),
            "error_count":    int(row["error_count"] or 0),
            "error_rate_pct": float(row["error_rate_pct"] or 0),
        }
        for row in er.mappings().all()
        if row["source"] != row["target"]
    ]

    # 노드: 인스턴스별 집계 (소속 서비스 포함)
    nr = await db.execute(text(f"""
        SELECT
            instance,
            service,
            COUNT(*)                                                          AS span_count,
            COUNT(*) FILTER (WHERE parent_span_id IS NULL)                   AS request_count,
            ROUND(CAST(AVG(duration_ms) AS numeric), 1)                      AS avg_ms,
            COUNT(*) FILTER (WHERE status = 'ERROR')                         AS error_count,
            ROUND(COUNT(*) FILTER (WHERE status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2)                                    AS error_rate_pct
        FROM traces
        WHERE start_time > NOW() - INTERVAL '{interval}'
          AND instance IS NOT NULL
        GROUP BY instance, service
        ORDER BY span_count DESC
    """), {})
    nodes = [
        {
            "id":             row["instance"],
            "service":        row["service"],
            "span_count":     int(row["span_count"] or 0),
            "request_count":  int(row["request_count"] or 0),
            "avg_ms":         float(row["avg_ms"] or 0),
            "error_count":    int(row["error_count"] or 0),
            "error_rate_pct": float(row["error_rate_pct"] or 0),
        }
        for row in nr.mappings().all()
    ]

    return {"nodes": nodes, "edges": edges}


async def get_active_summary(db: AsyncSession) -> List[Dict]:
    """인스턴스별 현재 수행 중인 거래(root span, end_time IS NULL) 목록.
    hang 감지를 위해 최대 60초 이내에 시작된 span만 포함한다."""
    sql = """
        SELECT
            service,
            instance,
            trace_id,
            name AS span_name,
            EXTRACT(EPOCH FROM (NOW() - start_time)) * 1000 AS duration_ms,
            status,
            start_time
        FROM traces
        WHERE parent_span_id IS NULL
          AND end_time IS NULL
          AND start_time > NOW() - INTERVAL '60 seconds'
        ORDER BY service, instance, start_time ASC
        LIMIT 200
    """
    r = await db.execute(text(sql))
    rows = r.mappings().all()

    groups: Dict[tuple, list] = {}
    for row in rows:
        key = (row["service"], row["instance"] or "")
        if key not in groups:
            groups[key] = []
        groups[key].append({
            "trace_id":   row["trace_id"],
            "span_name":  row["span_name"],
            "duration_ms": round(float(row["duration_ms"] or 0), 1),
            "status":     row["status"],
            "started_at": row["start_time"].isoformat() if row["start_time"] else None,
        })

    return sorted(
        [{"service": k[0], "instance": k[1], "transactions": v} for k, v in groups.items()],
        key=lambda x: (x["service"], x["instance"])
    )
