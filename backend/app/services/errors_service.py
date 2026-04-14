"""
에러 추적 서비스
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

RANGE_INTERVAL = {
    "1h":  "1 hour",
    "6h":  "6 hours",
    "24h": "24 hours",
    "7d":  "7 days",
}


async def get_error_list(
    db: AsyncSession,
    service: Optional[str] = None,
    resolved: Optional[bool] = None,
    error_type: Optional[str] = None,
    range_key: str = "1h",
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """에러 목록 조회"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")
    offset = (page - 1) * limit

    filters = [f"time > NOW() - INTERVAL '{interval}'"]
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if service:
        filters.append("service = :service")
        params["service"] = service
    if resolved is not None:
        filters.append("resolved = :resolved")
        params["resolved"] = resolved
    if error_type:
        filters.append("error_type = :error_type")
        params["error_type"] = error_type

    where = " AND ".join(filters)

    sql = f"""
        SELECT id, time, first_seen, service, instance, error_type, message,
               stack_trace, trace_id, span_id, resolved, attributes, count
        FROM errors
        WHERE {where}
        ORDER BY time DESC
        LIMIT :limit OFFSET :offset
    """
    count_sql = f"SELECT COUNT(*) FROM errors WHERE {where}"

    result = await db.execute(text(sql), params)
    rows = result.mappings().all()

    count_result = await db.execute(text(count_sql), params)
    total = count_result.scalar() or 0

    return {
        "total": total,
        "page":  page,
        "limit": limit,
        "items": [_row_to_dict(r) for r in rows],
    }


async def get_error_by_id(db: AsyncSession, error_id: int) -> Optional[Dict]:
    result = await db.execute(
        text("""
            SELECT id, time, first_seen, service, instance, error_type, message,
                   stack_trace, trace_id, span_id, resolved, attributes, count
            FROM errors WHERE id = :id
        """),
        {"id": error_id},
    )
    row = result.mappings().one_or_none()
    return _row_to_dict(row) if row else None


async def resolve_error(
    db: AsyncSession, error_id: int, resolved: bool
) -> Optional[Dict]:
    """에러 해결/미해결 상태 변경"""
    await db.execute(
        text("UPDATE errors SET resolved = :resolved WHERE id = :id"),
        {"id": error_id, "resolved": resolved},
    )
    await db.commit()
    return await get_error_by_id(db, error_id)


async def get_error_groups(
    db: AsyncSession,
    service: Optional[str] = None,
    resolved: Optional[bool] = None,
    range_key: str = "1h",
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """fingerprint 기준 에러 그룹 집계."""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")

    filters = [f"time > NOW() - INTERVAL '{interval}'", "fingerprint IS NOT NULL"]
    params: Dict[str, Any] = {"limit": limit}
    if service:
        filters.append("service = :service")
        params["service"] = service
    if resolved is not None:
        filters.append("resolved = :resolved")
        params["resolved"] = resolved

    where = " AND ".join(filters)

    sql = f"""
        SELECT
            fingerprint,
            MAX(error_type)                        AS error_type,
            MAX(message)                           AS message,
            COUNT(DISTINCT id)                     AS variants,
            SUM(COALESCE(count, 1))                AS total_count,
            MIN(COALESCE(first_seen, time))        AS first_seen,
            MAX(time)                              AS last_seen,
            COUNT(*) FILTER (WHERE NOT resolved)   AS unresolved_variants,
            ARRAY_AGG(DISTINCT service)            AS services,
            (ARRAY_AGG(trace_id ORDER BY time DESC)
                FILTER (WHERE trace_id IS NOT NULL))[1] AS sample_trace_id,
            (ARRAY_AGG(id ORDER BY time DESC))[1]  AS latest_id
        FROM errors
        WHERE {where}
        GROUP BY fingerprint
        ORDER BY total_count DESC
        LIMIT :limit
    """
    result = await db.execute(text(sql), params)
    rows = result.mappings().all()
    return [
        {
            "fingerprint":         row["fingerprint"],
            "error_type":          row["error_type"],
            "message":             row["message"],
            "variants":            int(row["variants"] or 0),
            "total_count":         int(row["total_count"] or 0),
            "first_seen":          row["first_seen"].isoformat() if row["first_seen"] else None,
            "last_seen":           row["last_seen"].isoformat() if row["last_seen"] else None,
            "unresolved_variants": int(row["unresolved_variants"] or 0),
            "services":            list(row["services"] or []),
            "sample_trace_id":     row["sample_trace_id"],
            "latest_id":           row["latest_id"],
        }
        for row in rows
    ]


async def get_group_errors(
    db: AsyncSession,
    fingerprint: str,
    range_key: str = "24h",
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """특정 fingerprint에 속하는 개별 에러 목록."""
    interval = RANGE_INTERVAL.get(range_key, "24 hours")
    result = await db.execute(
        text(f"""
            SELECT id, time, first_seen, service, instance, error_type, message,
                   stack_trace, trace_id, span_id, resolved, attributes, count
            FROM errors
            WHERE fingerprint = :fp
              AND time > NOW() - INTERVAL '{interval}'
            ORDER BY time DESC
            LIMIT :limit
        """),
        {"fp": fingerprint, "limit": limit},
    )
    rows = result.mappings().all()
    return [_row_to_dict(r) for r in rows]


async def get_error_stats(
    db: AsyncSession,
    service: Optional[str] = None,
    range_key: str = "1h",
) -> Dict[str, Any]:
    """에러 통계: 총 건수, 미해결, 유형별 분포, 시간대별 추이"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")
    step = {"1h": "5 minutes", "6h": "30 minutes", "24h": "1 hour", "7d": "6 hours"}.get(range_key, "5 minutes")

    cond = f"time > NOW() - INTERVAL '{interval}'"
    params: Dict[str, Any] = {}
    if service:
        cond += " AND service = :service"
        params["service"] = service

    # 총 발생 횟수 / 미해결 횟수 (count 컬럼 합산)
    r = await db.execute(text(f"""
        SELECT
            SUM(COALESCE(count, 1))                              AS total,
            SUM(COALESCE(count, 1)) FILTER (WHERE NOT resolved)  AS unresolved,
            SUM(COALESCE(count, 1)) FILTER (WHERE resolved)      AS resolved_cnt
        FROM errors WHERE {cond}
    """), params)
    counts = r.mappings().one()

    # 유형별 Top 10 (실제 발생 횟수 기준)
    r = await db.execute(text(f"""
        SELECT error_type, SUM(COALESCE(count, 1)) AS cnt
        FROM errors WHERE {cond}
        GROUP BY error_type
        ORDER BY cnt DESC
        LIMIT 10
    """), params)
    by_type = [{"error_type": row["error_type"], "count": row["cnt"]} for row in r.mappings()]

    # 시간대별 발생 추이 (실제 발생 횟수 기준)
    r = await db.execute(text(f"""
        SELECT time_bucket(INTERVAL '{step}', time) AS bucket, SUM(COALESCE(count, 1)) AS cnt
        FROM errors WHERE {cond}
        GROUP BY bucket ORDER BY bucket ASC
    """), params)
    timeline = [
        {"time": row["bucket"].isoformat(), "count": row["cnt"]}
        for row in r.mappings()
    ]

    return {
        "service":          service or "all",
        "total":            int(counts["total"] or 0),
        "unresolved":       int(counts["unresolved"] or 0),
        "resolved":         int(counts["resolved_cnt"] or 0),
        "by_type":          by_type,
        "timeline":         timeline,
    }


def _row_to_dict(row) -> Dict:
    return {
        "id":          row["id"],
        "time":        row["time"].isoformat(),
        "first_seen":  row["first_seen"].isoformat() if row["first_seen"] else row["time"].isoformat(),
        "service":     row["service"],
        "instance":    row["instance"],
        "error_type":  row["error_type"],
        "message":     row["message"],
        "stack_trace": row["stack_trace"],
        "trace_id":    row["trace_id"],
        "span_id":     row["span_id"],
        "resolved":    row["resolved"],
        "attributes":  row["attributes"] or {},
        "count":       row["count"] or 1,
    }
