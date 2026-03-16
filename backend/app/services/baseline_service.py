"""
통계적 베이스라인 — 과거 7일 데이터로 μ ± 2σ 정상 범위 계산
"""
import time
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.services.metrics_service import METRIC_ALIASES

# 베이스라인 계산에 필요한 최소 샘플 수
_MIN_SAMPLES = 30

# ── 인메모리 TTL 캐시 (30분) ──────────────────────────────
_CACHE_TTL = 1800.0  # 초
_baseline_cache: Dict[Tuple[str, str], Tuple[Optional[Dict[str, Any]], float]] = {}


async def get_metric_baseline(
    db: AsyncSession,
    service: str,
    metric_key: str,
) -> Optional[Dict[str, Any]]:
    """
    과거 7일간 동일 시간대(±2h) 메트릭 값의 통계 베이스라인 계산.
    샘플이 MIN_SAMPLES 미만이면 None 반환.
    결과는 30분간 인메모리 캐시에 보관하여 반복 쿼리를 방지한다.
    """
    cache_key = (service, metric_key)
    now = time.monotonic()
    if cache_key in _baseline_cache:
        cached_val, cached_ts = _baseline_cache[cache_key]
        if now - cached_ts < _CACHE_TTL:
            return cached_val

    names = METRIC_ALIASES.get(metric_key, [metric_key])

    result = await db.execute(
        text("""
            SELECT
                AVG(value)                                              AS mean,
                STDDEV(value)                                           AS stddev,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)    AS p95,
                MIN(value)                                              AS min_val,
                MAX(value)                                              AS max_val,
                COUNT(*)                                                AS sample_count
            FROM metrics
            WHERE service      = :service
              AND name         = ANY(:names)
              AND time         > NOW() - INTERVAL '7 days'
              AND time         < NOW() - INTERVAL '1 minute'
              -- 같은 시간대(하루 단위 ±2시간)에 해당하는 과거 데이터만
              AND ABS(EXTRACT(epoch FROM (time::time - NOW()::time))) < 7200
        """),
        {"service": service, "names": names},
    )
    row = result.mappings().one()

    if not row["mean"] or int(row["sample_count"] or 0) < _MIN_SAMPLES:
        _baseline_cache[cache_key] = (None, now)
        return None

    mean   = float(row["mean"])
    stddev = float(row["stddev"] or 0)
    upper  = mean + 2 * stddev
    lower  = max(0.0, mean - 2 * stddev)

    result = {
        "mean":         round(mean,   8),
        "stddev":       round(stddev, 8),
        "upper":        round(upper,  8),
        "lower":        round(lower,  8),
        "p95":          round(float(row["p95"]), 8) if row["p95"] else None,
        "sample_count": int(row["sample_count"]),
    }
    _baseline_cache[cache_key] = (result, now)
    return result


async def get_service_baselines(
    db: AsyncSession,
    service: str,
    metric_keys: List[str],
) -> Dict[str, Optional[Dict[str, Any]]]:
    """여러 메트릭 베이스라인 일괄 조회"""
    result = {}
    for key in metric_keys:
        result[key] = await get_metric_baseline(db, service, key)
    return result
