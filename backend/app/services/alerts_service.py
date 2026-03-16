"""
알림 규칙 관리 + 조건 평가 서비스
"""
import operator
import logging
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)

CONDITION_OPS = {
    "gt":  operator.gt,
    "lt":  operator.lt,
    "gte": operator.ge,
    "lte": operator.le,
    "eq":  operator.eq,
}
CONDITION_LABELS = {
    "gt": ">", "lt": "<", "gte": "≥", "lte": "≤", "eq": "=",
}


# ─────────────────────────────────────────────
# 규칙 CRUD
# ─────────────────────────────────────────────

async def get_rules(db: AsyncSession) -> List[Dict]:
    r = await db.execute(text("""
        SELECT r.id, r.name, r.description, r.service, r.metric_name,
               r.condition, r.threshold, r.duration_s, r.severity,
               r.enabled, r.created_at,
               COUNT(e.id) FILTER (WHERE e.status = 'firing') AS active_events
        FROM alert_rules r
        LEFT JOIN alert_events e ON e.rule_id = r.id
        GROUP BY r.id
        ORDER BY r.id
    """))
    return [_rule_to_dict(row) for row in r.mappings()]


async def get_rule_by_id(db: AsyncSession, rule_id: int) -> Optional[Dict]:
    r = await db.execute(
        text("SELECT * FROM alert_rules WHERE id = :id"),
        {"id": rule_id},
    )
    row = r.mappings().one_or_none()
    return dict(row) if row else None


async def create_rule(db: AsyncSession, data: Dict) -> Dict:
    r = await db.execute(text("""
        INSERT INTO alert_rules
            (name, description, service, metric_name, condition, threshold,
             duration_s, severity, enabled)
        VALUES
            (:name, :description, :service, :metric_name, :condition, :threshold,
             :duration_s, :severity, :enabled)
        RETURNING id
    """), {
        "name":        data["name"],
        "description": data.get("description"),
        "service":     data.get("service") or None,
        "metric_name": data["metric_name"],
        "condition":   data["condition"],
        "threshold":   float(data["threshold"]),
        "duration_s":  int(data.get("duration_s", 60)),
        "severity":    data.get("severity", "warning"),
        "enabled":     data.get("enabled", True),
    })
    new_id = r.scalar()
    await db.commit()
    rules = await get_rules(db)
    return next(r for r in rules if r["id"] == new_id)


async def update_rule(db: AsyncSession, rule_id: int, data: Dict) -> Optional[Dict]:
    await db.execute(text("""
        UPDATE alert_rules SET
            name        = :name,
            description = :description,
            service     = :service,
            metric_name = :metric_name,
            condition   = :condition,
            threshold   = :threshold,
            duration_s  = :duration_s,
            severity    = :severity,
            enabled     = :enabled
        WHERE id = :id
    """), {
        "id":          rule_id,
        "name":        data["name"],
        "description": data.get("description"),
        "service":     data.get("service") or None,
        "metric_name": data["metric_name"],
        "condition":   data["condition"],
        "threshold":   float(data["threshold"]),
        "duration_s":  int(data.get("duration_s", 60)),
        "severity":    data.get("severity", "warning"),
        "enabled":     data.get("enabled", True),
    })
    await db.commit()
    rules = await get_rules(db)
    found = [r for r in rules if r["id"] == rule_id]
    return found[0] if found else None


async def delete_rule(db: AsyncSession, rule_id: int) -> bool:
    r = await db.execute(
        text("DELETE FROM alert_rules WHERE id = :id"),
        {"id": rule_id},
    )
    await db.commit()
    return r.rowcount > 0


async def toggle_rule(db: AsyncSession, rule_id: int) -> Optional[Dict]:
    await db.execute(
        text("UPDATE alert_rules SET enabled = NOT enabled WHERE id = :id"),
        {"id": rule_id},
    )
    await db.commit()
    rules = await get_rules(db)
    found = [r for r in rules if r["id"] == rule_id]
    return found[0] if found else None


# ─────────────────────────────────────────────
# 이벤트 조회
# ─────────────────────────────────────────────

async def get_events(
    db: AsyncSession,
    rule_id: Optional[int] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> Dict:
    offset = (page - 1) * limit
    filters = []
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if rule_id:
        filters.append("e.rule_id = :rule_id")
        params["rule_id"] = rule_id
    if status:
        filters.append("e.status = :status")
        params["status"] = status

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    r = await db.execute(text(f"""
        SELECT e.id, e.rule_id, r.name AS rule_name, r.severity,
               r.service, r.metric_name, r.condition, r.threshold,
               e.fired_at, e.resolved_at, e.value, e.message, e.status
        FROM alert_events e
        JOIN alert_rules r ON r.id = e.rule_id
        {where}
        ORDER BY e.fired_at DESC
        LIMIT :limit OFFSET :offset
    """), params)
    rows = r.mappings().all()

    count_r = await db.execute(
        text(f"SELECT COUNT(*) FROM alert_events e {where}"), params
    )
    total = count_r.scalar() or 0

    return {
        "total": total, "page": page, "limit": limit,
        "items": [_event_to_dict(row) for row in rows],
    }


async def get_active_events(db: AsyncSession) -> List[Dict]:
    r = await db.execute(text("""
        SELECT e.id, e.rule_id, r.name AS rule_name, r.severity,
               r.service, r.metric_name, r.condition, r.threshold,
               e.fired_at, e.resolved_at, e.value, e.message, e.status
        FROM alert_events e
        JOIN alert_rules r ON r.id = e.rule_id
        WHERE e.status = 'firing'
        ORDER BY e.fired_at DESC
    """))
    return [_event_to_dict(row) for row in r.mappings()]


# ─────────────────────────────────────────────
# 알림 평가 (백그라운드 체커에서 호출)
# ─────────────────────────────────────────────

async def check_all_rules(db: AsyncSession) -> int:
    """모든 활성 규칙을 평가하고 알림 발화/해결 처리. 발화 건수 반환."""
    r = await db.execute(text("SELECT * FROM alert_rules WHERE enabled = true"))
    rules = r.mappings().all()

    fired = 0
    for rule in rules:
        try:
            fired += await _evaluate_rule(db, dict(rule))
        except Exception as e:
            logger.warning(f"[AlertChecker] 규칙 평가 실패 (id={rule['id']}): {e}")

    return fired


async def _evaluate_rule(db: AsyncSession, rule: Dict) -> int:
    """단일 규칙 평가. 발화됐으면 1, 아니면 0 반환."""
    # 1. 메트릭 평균값 조회 (lookback window = duration_s)
    cond_parts = ["name = :metric_name",
                  "time > NOW() - :duration_s * interval '1 second'"]
    params: Dict[str, Any] = {
        "metric_name": rule["metric_name"],
        "duration_s":  rule["duration_s"],
    }
    if rule.get("service"):
        cond_parts.append("service = :service")
        params["service"] = rule["service"]

    r = await db.execute(
        text(f"SELECT AVG(value) FROM metrics WHERE {' AND '.join(cond_parts)}"),
        params,
    )
    avg_val = r.scalar()
    if avg_val is None:
        return 0  # 데이터 없음 → 평가 건너뜀

    # 2. 조건 평가
    op = CONDITION_OPS.get(rule["condition"])
    triggered = op(float(avg_val), float(rule["threshold"])) if op else False

    # 3. 현재 활성 이벤트 조회
    r2 = await db.execute(
        text("SELECT id FROM alert_events WHERE rule_id = :rid AND status = 'firing' LIMIT 1"),
        {"rid": rule["id"]},
    )
    active_event_id = r2.scalar()

    if triggered and not active_event_id:
        # 새 알림 발화
        msg = (
            f"[{rule['name']}] {rule['metric_name']} "
            f"{CONDITION_LABELS.get(rule['condition'], rule['condition'])} "
            f"{rule['threshold']} (현재값: {avg_val:.4f})"
        )
        await db.execute(text("""
            INSERT INTO alert_events (rule_id, value, message, status)
            VALUES (:rule_id, :value, :message, 'firing')
        """), {"rule_id": rule["id"], "value": float(avg_val), "message": msg})
        await db.commit()
        logger.info(f"[AlertChecker] 알림 발화: {msg}")
        return 1

    elif not triggered and active_event_id:
        # 알림 해결
        await db.execute(text("""
            UPDATE alert_events
            SET status = 'resolved', resolved_at = NOW()
            WHERE id = :eid
        """), {"eid": active_event_id})
        await db.commit()
        logger.info(f"[AlertChecker] 알림 해결: rule_id={rule['id']}")

    return 0


# ─────────────────────────────────────────────
# 직렬화 헬퍼
# ─────────────────────────────────────────────

def _rule_to_dict(row) -> Dict:
    return {
        "id":           row["id"],
        "name":         row["name"],
        "description":  row["description"],
        "service":      row["service"],
        "metric_name":  row["metric_name"],
        "condition":    row["condition"],
        "threshold":    float(row["threshold"]),
        "duration_s":   row["duration_s"],
        "severity":     row["severity"],
        "enabled":      row["enabled"],
        "created_at":   row["created_at"].isoformat() if row.get("created_at") else None,
        "active_events": int(row["active_events"]) if row.get("active_events") is not None else 0,
    }


def _event_to_dict(row) -> Dict:
    return {
        "id":          row["id"],
        "rule_id":     row["rule_id"],
        "rule_name":   row["rule_name"],
        "severity":    row["severity"],
        "service":     row["service"],
        "metric_name": row["metric_name"],
        "condition":   row["condition"],
        "threshold":   float(row["threshold"]),
        "fired_at":    row["fired_at"].isoformat() if row["fired_at"] else None,
        "resolved_at": row["resolved_at"].isoformat() if row["resolved_at"] else None,
        "value":       float(row["value"]) if row["value"] is not None else None,
        "message":     row["message"],
        "status":      row["status"],
    }
