"""
트레이스 조회 서비스
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

RANGE_INTERVAL = {
    "15m": "15 minutes",
    "1h":  "1 hour",
    "6h":  "6 hours",
    "24h": "24 hours",
    "7d":  "7 days",
}


async def get_trace_list(
    db: AsyncSession,
    service: Optional[str] = None,
    status: Optional[str] = None,
    range_key: str = "1h",
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """트레이스 목록 조회 (그룹: trace_id)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")
    offset = (page - 1) * limit

    # 동적 WHERE 절
    filters = [f"t.start_time > NOW() - INTERVAL '{interval}'"]
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if service:
        filters.append("t.service = :service")
        params["service"] = service

    where_clause = " AND ".join(filters)

    # 트레이스 요약 쿼리 (status 필터는 집계 후 적용)
    having_clause = ""
    if status == "ERROR":
        having_clause = "HAVING BOOL_OR(t.status = 'ERROR')"
    elif status == "OK":
        having_clause = "HAVING NOT BOOL_OR(t.status = 'ERROR')"

    sql = f"""
        SELECT
            t.trace_id,
            MIN(t.start_time)  AS start_time,
            EXTRACT(EPOCH FROM (MAX(t.end_time) - MIN(t.start_time))) * 1000 AS duration_ms,
            COUNT(*)           AS span_count,
            COALESCE(MAX(t.name)    FILTER (WHERE t.parent_span_id IS NULL), MAX(t.name))    AS root_name,
            COALESCE(MAX(t.service) FILTER (WHERE t.parent_span_id IS NULL), MAX(t.service)) AS service,
            CASE WHEN BOOL_OR(t.status = 'ERROR') THEN 'ERROR' ELSE 'OK' END AS status
        FROM traces t
        WHERE {where_clause}
        GROUP BY t.trace_id
        {having_clause}
        ORDER BY MIN(t.start_time) DESC
        LIMIT :limit OFFSET :offset
    """

    count_sql = f"""
        SELECT COUNT(*) FROM (
            SELECT t.trace_id
            FROM traces t
            WHERE {where_clause}
            GROUP BY t.trace_id
            {having_clause}
        ) sub
    """

    result = await db.execute(text(sql), params)
    rows = result.mappings().all()

    count_result = await db.execute(text(count_sql), params)
    total = count_result.scalar() or 0

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "items": [
            {
                "trace_id":   row["trace_id"],
                "start_time": row["start_time"].isoformat(),
                "duration_ms": round(row["duration_ms"] or 0, 2),
                "span_count": row["span_count"],
                "root_name":  row["root_name"] or "unknown",
                "service":    row["service"] or "",
                "status":     row["status"],
            }
            for row in rows
        ],
    }


async def get_slow_queries(
    db: AsyncSession,
    service: Optional[str],
    range_key: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """DB 슬로우 쿼리 집계 (db.statement 속성 기준)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")
    svc_filter = "AND service = :service" if service else ""
    params: Dict[str, Any] = {}
    if service:
        params["service"] = service

    sql = f"""
        SELECT
            SUBSTRING(attributes->>'db.statement', 1, 300) AS statement,
            COALESCE(attributes->>'db.system', 'unknown') AS db_system,
            service,
            COUNT(*)                           AS call_count,
            AVG(duration_ms)                   AS avg_ms,
            MAX(duration_ms)                   AS max_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
            SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) AS error_count
        FROM traces
        WHERE start_time > NOW() - INTERVAL '{interval}'
          AND attributes->>'db.statement' IS NOT NULL
          {svc_filter}
        GROUP BY 1, 2, 3
        ORDER BY avg_ms DESC
        LIMIT {limit}
    """
    result = await db.execute(text(sql), params)
    rows = result.fetchall()
    return [
        {
            "statement":  r[0] or "",
            "db_system":  r[1],
            "service":    r[2],
            "call_count": int(r[3]),
            "avg_ms":     round(float(r[4]), 1) if r[4] else 0.0,
            "max_ms":     round(float(r[5]), 1) if r[5] else 0.0,
            "p95_ms":     round(float(r[6]), 1) if r[6] else 0.0,
            "error_count": int(r[7]) if r[7] else 0,
        }
        for r in rows
    ]


async def get_trace_detail(db: AsyncSession, trace_id: str) -> Optional[Dict[str, Any]]:
    """특정 트레이스의 모든 스팬 조회 (Waterfall용)"""
    result = await db.execute(
        text("""
            SELECT
                span_id,
                parent_span_id,
                service,
                instance,
                name,
                start_time,
                end_time,
                duration_ms,
                status,
                COALESCE(span_kind, 'INTERNAL') AS span_kind,
                attributes,
                events,
                EXTRACT(EPOCH FROM (
                    start_time - MIN(start_time) OVER ()
                )) * 1000 AS start_offset_ms
            FROM traces
            WHERE trace_id = :trace_id
            ORDER BY start_time ASC
        """),
        {"trace_id": trace_id},
    )
    rows = result.mappings().all()
    if not rows:
        return None

    total_duration = max(
        float(r["start_offset_ms"] or 0) + float(r["duration_ms"] or 0) for r in rows
    )

    return {
        "trace_id":    trace_id,
        "start_time":  rows[0]["start_time"].isoformat(),
        "duration_ms": round(total_duration, 2),
        "span_count":  len(rows),
        "spans": [
            {
                "span_id":         row["span_id"],
                "parent_span_id":  row["parent_span_id"],
                "service":         row["service"],
                "instance":        row["instance"],
                "name":            row["name"],
                "start_time":      row["start_time"].isoformat(),
                "end_time":        row["end_time"].isoformat(),
                "start_offset_ms": round(float(row["start_offset_ms"] or 0), 2),
                "duration_ms":     round(float(row["duration_ms"] or 0), 2),
                "status":          row["status"],
                "span_kind":       row["span_kind"],
                "attributes":      row["attributes"] or {},
                "events":          row["events"] or [],
            }
            for row in rows
        ],
    }


async def get_trace_stats(
    db: AsyncSession,
    service: str,
    range_key: str = "1h",
) -> Dict[str, Any]:
    """루트 스팬 기준 응답시간 통계 (p50/p95/p99)"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    result = await db.execute(
        text(f"""
            SELECT
                percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
                AVG(duration_ms)  AS avg_ms,
                COUNT(*)          AS total,
                COUNT(*) FILTER (WHERE status = 'ERROR') AS errors
            FROM traces
            WHERE service = :service
              AND parent_span_id IS NULL
              AND start_time > NOW() - INTERVAL '{interval}'
        """),
        {"service": service},
    )
    row = result.mappings().one()

    total = row["total"] or 1
    return {
        "service":             service,
        "p50_ms":              round(row["p50"] or 0, 2),
        "p95_ms":              round(row["p95"] or 0, 2),
        "p99_ms":              round(row["p99"] or 0, 2),
        "avg_ms":              round(row["avg_ms"] or 0, 2),
        "total_count":         int(row["total"] or 0),
        "error_count":         int(row["errors"] or 0),
        "error_rate_percent":  round((row["errors"] or 0) / total * 100, 2),
    }
