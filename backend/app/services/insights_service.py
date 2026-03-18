"""
룰 기반 자동 인사이트 분석 서비스
LLM 없이 APM 데이터를 분석하여 주목해야 할 이슈를 도출합니다.
"""
import asyncio
from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


async def get_insights(db: AsyncSession) -> List[Dict[str, Any]]:
    results = await asyncio.gather(
        _check_down_services(db),
        _check_high_error_rate(db),
        _check_slow_endpoints(db),
        _check_error_spike(db),
        _check_active_alerts(db),
        _check_log_span_mismatch(db),
        _check_jvm_memory(db),
        _check_stale_errors(db),
    )

    insights: List[Dict[str, Any]] = [item for group in results for item in group]

    # 심각도 순 정렬: critical → warning → info
    order = {"critical": 0, "warning": 1, "info": 2}
    insights.sort(key=lambda x: order.get(x["level"], 9))

    return insights


# ─────────────────────────────────────────────────────────
# 룰 1: 서비스 다운 감지
# ─────────────────────────────────────────────────────────

async def _check_down_services(db: AsyncSession) -> List[Dict[str, Any]]:
    r = await db.execute(text("""
        SELECT name,
               EXTRACT(EPOCH FROM (NOW() - last_seen)) / 60 AS minutes_ago
        FROM services
        WHERE last_seen < NOW() - INTERVAL '2 minutes'
        ORDER BY last_seen DESC
    """))
    rows = r.mappings().all()
    out = []
    for row in rows:
        mins = int(row["minutes_ago"] or 0)
        out.append({
            "level":       "critical",
            "category":    "availability",
            "title":       f"{row['name']} 서비스 응답 없음",
            "description": f"마지막 데이터 수신 후 {mins}분 경과. 서비스가 중단됐을 수 있습니다.",
            "service":     row["name"],
            "link":        f"/metrics?service={row['name']}",
        })
    return out


# ─────────────────────────────────────────────────────────
# 룰 2: 서비스별 에러율 임계값 초과 (최근 10분)
# ─────────────────────────────────────────────────────────

async def _check_high_error_rate(db: AsyncSession) -> List[Dict[str, Any]]:
    r = await db.execute(text("""
        SELECT
            service,
            COUNT(*)                                                        AS total,
            COUNT(*) FILTER (WHERE status = 'ERROR')                       AS errors,
            ROUND(
                COUNT(*) FILTER (WHERE status = 'ERROR') * 100.0
                / NULLIF(COUNT(*), 0), 1
            )                                                               AS error_rate
        FROM traces
        WHERE parent_span_id IS NULL
          AND start_time > NOW() - INTERVAL '10 minutes'
        GROUP BY service
        HAVING COUNT(*) >= 5
        ORDER BY error_rate DESC
    """))
    rows = r.mappings().all()
    out = []
    for row in rows:
        rate = float(row["error_rate"] or 0)
        if rate < 1.0:
            continue
        level = "critical" if rate >= 5.0 else "warning"
        out.append({
            "level":       level,
            "category":    "error",
            "title":       f"{row['service']} 에러율 {rate:.1f}%",
            "description": (
                f"최근 10분간 {int(row['total'])}건 중 {int(row['errors'])}건 에러. "
                f"{'즉시 확인이 필요합니다.' if level == 'critical' else '지속 여부를 모니터링하세요.'}"
            ),
            "service":     row["service"],
            "link":        f"/errors?service={row['service']}",
        })
    return out


# ─────────────────────────────────────────────────────────
# 룰 3: 느린 엔드포인트 감지 (최근 10분, p95 > 1000ms)
# ─────────────────────────────────────────────────────────

async def _check_slow_endpoints(db: AsyncSession) -> List[Dict[str, Any]]:
    r = await db.execute(text("""
        SELECT
            service,
            name                                                                    AS endpoint,
            ROUND(CAST(AVG(duration_ms) AS numeric), 0)                            AS avg_ms,
            ROUND(
                CAST(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS numeric), 0
            )                                                                       AS p95_ms,
            COUNT(*)                                                                AS cnt
        FROM traces
        WHERE parent_span_id IS NULL
          AND start_time > NOW() - INTERVAL '10 minutes'
        GROUP BY service, name
        HAVING COUNT(*) >= 3
           AND percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) > 1000
        ORDER BY p95_ms DESC
        LIMIT 5
    """))
    rows = r.mappings().all()
    out = []
    for row in rows:
        p95 = int(row["p95_ms"] or 0)
        avg = int(row["avg_ms"] or 0)
        level = "critical" if p95 >= 3000 else "warning"
        out.append({
            "level":       level,
            "category":    "performance",
            "title":       f"{row['endpoint']} 응답 지연",
            "description": (
                f"[{row['service']}] 최근 10분 p95={p95}ms / avg={avg}ms "
                f"({int(row['cnt'])}건). 병목 구간을 확인하세요."
            ),
            "service":     row["service"],
            "link":        f"/traces?service={row['service']}",
        })
    return out


# ─────────────────────────────────────────────────────────
# 룰 4: 에러 급증 감지 (이전 5분 대비 최근 5분 에러 수 2배 이상)
# ─────────────────────────────────────────────────────────

async def _check_error_spike(db: AsyncSession) -> List[Dict[str, Any]]:
    r = await db.execute(text("""
        SELECT
            service,
            COUNT(*) FILTER (WHERE start_time > NOW() - INTERVAL '5 minutes')  AS recent_errors,
            COUNT(*) FILTER (
                WHERE start_time BETWEEN NOW() - INTERVAL '10 minutes'
                                    AND NOW() - INTERVAL '5 minutes'
            )                                                                    AS prev_errors
        FROM traces
        WHERE parent_span_id IS NULL
          AND status = 'ERROR'
          AND start_time > NOW() - INTERVAL '10 minutes'
        GROUP BY service
        HAVING COUNT(*) FILTER (WHERE start_time > NOW() - INTERVAL '5 minutes') >= 3
    """))
    rows = r.mappings().all()
    out = []
    for row in rows:
        recent = int(row["recent_errors"] or 0)
        prev   = int(row["prev_errors"] or 0)
        if prev == 0 or recent < prev * 2:
            continue
        ratio = recent / prev if prev > 0 else recent
        out.append({
            "level":       "warning",
            "category":    "error",
            "title":       f"{row['service']} 에러 급증",
            "description": (
                f"최근 5분 에러 {recent}건 (이전 5분 {prev}건, "
                f"{ratio:.1f}배 증가). 배포 또는 외부 의존성 변화를 확인하세요."
            ),
            "service":     row["service"],
            "link":        f"/errors?service={row['service']}",
        })
    return out


# ─────────────────────────────────────────────────────────
# 룰 5: 현재 발화 중인 알림
# ─────────────────────────────────────────────────────────

async def _check_active_alerts(db: AsyncSession) -> List[Dict[str, Any]]:
    r = await db.execute(text("""
        SELECT
            ae.id,
            ar.name       AS rule_name,
            ar.severity,
            ar.service,
            ae.message,
            ae.fired_at
        FROM alert_events ae
        JOIN alert_rules ar ON ar.id = ae.rule_id
        WHERE ae.status = 'firing'
        ORDER BY
            CASE ar.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            ae.fired_at DESC
        LIMIT 5
    """))
    rows = r.mappings().all()
    return [
        {
            "level":       row["severity"],
            "category":    "alert",
            "title":       f"알림 발화: {row['rule_name']}",
            "description": row["message"],
            "service":     row["service"],
            "link":        "/alerts",
        }
        for row in rows
    ]


# ─────────────────────────────────────────────────────────
# 룰 6: 로그-스팬 불일치 감지 (에러 로그는 많은데 에러 스팬이 없는 경우)
# ─────────────────────────────────────────────────────────

async def _check_log_span_mismatch(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    계측(Instrumentation) 누락 감지:
    최근 1시간 동안 ERROR 로그는 발생했으나, 관련 트레이스의 스팬 status가 ERROR가 아닌 경우
    """
    r = await db.execute(text("""
        WITH error_logs AS (
            SELECT service, trace_id, span_id
            FROM logs
            WHERE level IN ('ERROR', 'FATAL')
              AND time > NOW() - INTERVAL '1 hour'
              AND trace_id IS NOT NULL
        ),
        mismatched AS (
            SELECT
                l.service,
                COUNT(DISTINCT l.trace_id) AS mismatch_count
            FROM error_logs l
            JOIN traces t ON t.trace_id = l.trace_id AND t.span_id = l.span_id
            WHERE t.status != 'ERROR'
            GROUP BY l.service
            HAVING COUNT(DISTINCT l.trace_id) >= 5
        )
        SELECT * FROM mismatched
    """))
    rows = r.mappings().all()
    return [
        {
            "level":       "warning",
            "category":    "observability",
            "title":       f"{row['service']} 계측 누락 의심",
            "description": (
                f"최근 1시간 동안 {row['mismatch_count']}건의 트랜잭션에서 "
                "에러 로그가 발생했으나 스팬 상태는 ERROR로 기록되지 않았습니다. "
                "Exception 핸들링 코드를 확인하세요."
            ),
            "service":     row["service"],
            "link":        f"/logs?service={row['service']}&level=ERROR",
        }
        for row in rows
    ]


# ─────────────────────────────────────────────────────────
# 룰 7: 장기 미해결 에러 (1시간 이상 미처리)
# ─────────────────────────────────────────────────────────

async def _check_stale_errors(db: AsyncSession) -> List[Dict[str, Any]]:
    from datetime import datetime, timezone
    r = await db.execute(text("""
        SELECT
            service,
            COUNT(*)                                AS cnt,
            MIN(time)                               AS oldest
        FROM errors
        WHERE NOT resolved
          AND time < NOW() - INTERVAL '1 hour'
        GROUP BY service
        ORDER BY cnt DESC
        LIMIT 5
    """))
    rows = r.mappings().all()
    out = []
    for row in rows:
        oldest = row["oldest"]
        if oldest.tzinfo is None:
            oldest = oldest.replace(tzinfo=timezone.utc)
        hours = int((datetime.now(timezone.utc) - oldest).total_seconds() / 3600)
        out.append({
            "level":       "info",
            "category":    "error",
            "title":       f"{row['service']} 미해결 에러 {int(row['cnt'])}건",
            "description": f"가장 오래된 에러가 {hours}시간 이상 미해결 상태입니다.",
            "service":     row["service"],
            "link":        f"/errors?service={row['service']}&resolved=false",
        })
    return out


# ─────────────────────────────────────────────────────────
# 룰 8: JVM 메모리 부족 및 누수 의심
# ─────────────────────────────────────────────────────────

async def _check_jvm_memory(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    1. 힙 메모리 점유율이 85%를 초과하는 경우
    2. (추후 고도화) Old Gen이 지속적으로 우상향하는 경우
    """
    r = await db.execute(text("""
        WITH latest_mem AS (
            SELECT DISTINCT ON (service, instance)
                service,
                instance,
                value AS used_bytes,
                attributes->>'jvm.memory.pool.name' as pool
            FROM metrics
            WHERE name IN ('jvm.memory.used', 'jvm.memory.heap.used')
              AND time > NOW() - INTERVAL '5 minutes'
            ORDER BY service, instance, time DESC
        ),
        max_mem AS (
            SELECT DISTINCT ON (service, instance)
                service,
                instance,
                value AS max_bytes
            FROM metrics
            WHERE name = 'jvm.memory.heap.max'
              AND time > NOW() - INTERVAL '5 minutes'
            ORDER BY service, instance, time DESC
        )
        SELECT
            l.service,
            l.instance,
            ROUND(CAST(SUM(l.used_bytes) AS numeric) / 1024 / 1024, 0) AS used_mb,
            ROUND(CAST(MAX(m.max_bytes) AS numeric) / 1024 / 1024, 0) AS max_mb,
            ROUND(CAST(SUM(l.used_bytes) * 100.0 / NULLIF(MAX(m.max_bytes), 0) AS numeric), 1) AS usage_pct
        FROM latest_mem l
        JOIN max_mem m ON m.service = l.service AND m.instance = l.instance
        GROUP BY l.service, l.instance
        HAVING (SUM(used_bytes) * 100.0 / NULLIF(MAX(max_bytes), 0)) > 85
    """))
    rows = r.mappings().all()
    out = []
    for row in rows:
        pct = float(row["usage_pct"] or 0)
        level = "critical" if pct >= 95 else "warning"
        out.append({
            "level":       level,
            "category":    "resource",
            "title":       f"{row['service']} 힙 메모리 부족 ({pct:.1f}%)",
            "description": (
                f"인스턴스 {row['instance']}의 힙 사용량이 {row['used_mb']}MB / {row['max_mb']}MB 로 "
                f"매우 높습니다. 메모리 누수 여부나 GC 로그를 확인하세요."
            ),
            "service":     row["service"],
            "link":        f"/metrics?service={row['service']}",
        })
    return out
