from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

GRANULARITY_CONFIG = {
    "minute": {"bucket": "1 minute",  "seconds": 60},
    "hour":   {"bucket": "1 hour",    "seconds": 3600},
    "day":    {"bucket": "1 day",     "seconds": 86400},
}
MAX_POINTS = 10_000


async def get_stats(
    db: AsyncSession,
    granularity: str,
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
    service: Optional[str] = None,
) -> Dict[str, Any]:
    cfg = GRANULARITY_CONFIG.get(granularity, GRANULARITY_CONFIG["hour"])
    bucket_interval = cfg["bucket"]
    bucket_seconds  = cfg["seconds"]

    if to_dt is None:
        to_dt = datetime.now(timezone.utc)
    if from_dt is None:
        from_dt = to_dt - timedelta(hours=24)

    params: Dict[str, Any] = {"from_dt": from_dt, "to_dt": to_dt}
    cond = "parent_span_id IS NULL AND start_time >= :from_dt AND start_time < :to_dt"
    if service:
        cond += " AND service = :service"
        params["service"] = service

    # 시계열 집계
    r = await db.execute(text(f"""
        SELECT
            time_bucket(INTERVAL '{bucket_interval}', start_time) AS bucket,
            COUNT(*)                                               AS request_count,
            COUNT(*) FILTER (WHERE status = 'ERROR')              AS error_count,
            ROUND(COUNT(*) FILTER (WHERE status='ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 2)                         AS error_rate_pct,
            ROUND(CAST(AVG(duration_ms) AS numeric), 1)           AS avg_ms
        FROM traces
        WHERE {cond}
        GROUP BY bucket ORDER BY bucket ASC
        LIMIT :limit
    """), {**params, "limit": MAX_POINTS})
    rows = r.mappings().all()

    data = [{
        "time":           row["bucket"].isoformat(),
        "request_count":  int(row["request_count"] or 0),
        "error_count":    int(row["error_count"] or 0),
        "error_rate_pct": float(row["error_rate_pct"] or 0),
        "avg_ms":         float(row["avg_ms"] or 0),
        "tps":            round(int(row["request_count"] or 0) / bucket_seconds, 3),
    } for row in rows]

    # summary (별도 집계, LIMIT 없음)
    sr = await db.execute(text(f"""
        SELECT COUNT(*) AS total_requests,
               COUNT(*) FILTER (WHERE status='ERROR') AS total_errors,
               ROUND(CAST(AVG(duration_ms) AS numeric), 1) AS avg_response_ms,
               ROUND(COUNT(*) FILTER (WHERE status='ERROR') * 100.0
                   / NULLIF(COUNT(*), 0), 2) AS error_rate_percent
        FROM traces WHERE {cond}
    """), params)
    srow = sr.mappings().one()
    peak_tps = max((d["tps"] for d in data), default=0.0)

    return {
        "summary": {
            "total_requests":     int(srow["total_requests"] or 0),
            "total_errors":       int(srow["total_errors"] or 0),
            "avg_response_ms":    float(srow["avg_response_ms"] or 0),
            "error_rate_percent": float(srow["error_rate_percent"] or 0),
            "peak_tps":           round(peak_tps, 3),
            "data_points":        len(data),
            "truncated":          len(data) >= MAX_POINTS,
        },
        "data": data,
    }
