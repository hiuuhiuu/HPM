"""
로그 조회 서비스
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

RANGE_STEP = {
    "1h":  "1 minute",
    "6h":  "5 minutes",
    "24h": "15 minutes",
    "7d":  "1 hour",
}

# 레벨 심각도 순서
LEVEL_ORDER = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]


async def get_log_list(
    db: AsyncSession,
    service: Optional[str] = None,
    level: Optional[str] = None,
    search: Optional[str] = None,
    trace_id: Optional[str] = None,
    range_key: str = "1h",
    page: int = 1,
    limit: int = 50,
) -> Dict[str, Any]:
    """로그 목록 조회"""
    offset = (page - 1) * limit
    filters = ["1=1"]
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if not trace_id:
        interval = RANGE_INTERVAL.get(range_key, "1 hour")
        filters.append(f"time > NOW() - INTERVAL '{interval}'")
    
    if service:
        filters.append("service = :service")
        params["service"] = service
    if level and level != "ALL":
        if level in LEVEL_ORDER:
            selected = LEVEL_ORDER[LEVEL_ORDER.index(level):]
            filters.append("level = ANY(:levels)")
            params["levels"] = selected
    if search:
        filters.append("body ILIKE :search")
        params["search"] = f"%{search}%"
    if trace_id:
        filters.append("trace_id = :trace_id")
        params["trace_id"] = trace_id

    where = " AND ".join(filters)

    sql = f"""
        SELECT time, service, instance, level, body,
               trace_id, span_id, attributes
        FROM logs
        WHERE {where}
        ORDER BY time DESC
        LIMIT :limit OFFSET :offset
    """
    count_sql = f"SELECT COUNT(*) FROM logs WHERE {where}"

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


async def get_log_stats(
    db: AsyncSession,
    service: Optional[str] = None,
    range_key: str = "1h",
) -> Dict[str, Any]:
    """레벨별 카운트 + 시간대별 추이"""
    interval = RANGE_INTERVAL.get(range_key, "1 hour")
    step = RANGE_STEP.get(range_key, "1 minute")

    cond = f"time > NOW() - INTERVAL '{interval}'"
    params: Dict[str, Any] = {}
    if service:
        cond += " AND service = :service"
        params["service"] = service

    # 레벨별 카운트
    r = await db.execute(text(f"""
        SELECT level, COUNT(*) AS cnt
        FROM logs WHERE {cond}
        GROUP BY level
        ORDER BY level
    """), params)
    by_level_raw = {row["level"]: int(row["cnt"]) for row in r}
    by_level = {lvl: by_level_raw.get(lvl, 0) for lvl in LEVEL_ORDER}

    # 시간대별 추이 (레벨별 적층)
    r = await db.execute(text(f"""
        SELECT
            time_bucket(INTERVAL '{step}', time) AS bucket,
            level,
            COUNT(*) AS cnt
        FROM logs WHERE {cond}
        GROUP BY bucket, level
        ORDER BY bucket ASC
    """), params)

    # 시간대 → 레벨별 dict 구조로 변환
    timeline_map: Dict[str, Dict[str, int]] = {}
    for row in r:
        ts = row["bucket"].isoformat()
        if ts not in timeline_map:
            timeline_map[ts] = {lvl: 0 for lvl in LEVEL_ORDER}
        timeline_map[ts][row["level"]] = int(row["cnt"])

    timeline = [
        {"time": ts, **counts}
        for ts, counts in sorted(timeline_map.items())
    ]

    return {
        "service":   service or "all",
        "by_level":  by_level,
        "total":     sum(by_level.values()),
        "timeline":  timeline,
    }


def _row_to_dict(row) -> Dict:
    return {
        "id":         row["id"] if "id" in row.keys() else None,
        "time":       row["time"].isoformat(),
        "service":    row["service"],
        "instance":   row["instance"],
        "level":      row["level"],
        "body":       row["body"],
        "trace_id":   row["trace_id"],
        "span_id":    row["span_id"],
        "attributes": row["attributes"] or {},
    }
