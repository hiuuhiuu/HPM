"""
서비스 / 인스턴스 관리 서비스
- 전체 인스턴스 목록 + 활성 상태 조회
- 인스턴스 / 서비스 단위 데이터 삭제
"""
from typing import Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


async def get_all_instances(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    metrics · traces · logs 테이블에서 (service, instance) 고유 목록을 수집하고,
    각 인스턴스의 마지막 수신 시각과 활성 여부를 반환합니다.

    is_alive 기준: 최근 5분 이내 데이터 수신
    """
    result = await db.execute(text("""
        SELECT
            service,
            instance,
            MAX(last_seen) AS last_seen,
            MAX(last_seen) > NOW() - INTERVAL '5 minutes' AS is_alive
        FROM (
            SELECT service, instance, MAX(time)  AS last_seen FROM metrics GROUP BY service, instance
            UNION ALL
            SELECT service, instance, MAX(start_time) AS last_seen FROM traces  GROUP BY service, instance
            UNION ALL
            SELECT service, instance, MAX(time)  AS last_seen FROM logs    WHERE instance IS NOT NULL GROUP BY service, instance
        ) src
        GROUP BY service, instance
        ORDER BY service, instance
    """))
    rows = result.mappings().all()
    return [
        {
            "service":   row["service"],
            "instance":  row["instance"],
            "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
            "is_alive":  bool(row["is_alive"]),
        }
        for row in rows
    ]


async def delete_instance(db: AsyncSession, service: str, instance: str) -> Dict[str, int]:
    """
    특정 인스턴스의 모든 텔레메트리 데이터를 삭제합니다.
    (metrics, traces, logs)
    서비스 레지스트리(services 테이블)는 다른 인스턴스가 남아 있을 수 있으므로 유지합니다.
    """
    params = {"service": service, "instance": instance}

    r = await db.execute(
        text("DELETE FROM metrics WHERE service = :service AND instance = :instance"),
        params,
    )
    metrics_deleted = r.rowcount

    r = await db.execute(
        text("DELETE FROM traces WHERE service = :service AND instance = :instance"),
        params,
    )
    traces_deleted = r.rowcount

    r = await db.execute(
        text("DELETE FROM logs WHERE service = :service AND instance = :instance"),
        params,
    )
    logs_deleted = r.rowcount

    await db.commit()
    return {
        "metrics": metrics_deleted,
        "traces":  traces_deleted,
        "logs":    logs_deleted,
    }


async def delete_service(db: AsyncSession, service: str) -> Dict[str, int]:
    """
    서비스에 속한 모든 텔레메트리 데이터와 서비스 레지스트리를 삭제합니다.
    (metrics, traces, logs, errors, services)
    """
    params = {"service": service}

    r = await db.execute(
        text("DELETE FROM metrics WHERE service = :service"), params
    )
    metrics_deleted = r.rowcount

    r = await db.execute(
        text("DELETE FROM traces WHERE service = :service"), params
    )
    traces_deleted = r.rowcount

    r = await db.execute(
        text("DELETE FROM logs WHERE service = :service"), params
    )
    logs_deleted = r.rowcount

    r = await db.execute(
        text("DELETE FROM errors WHERE service = :service"), params
    )
    errors_deleted = r.rowcount

    r = await db.execute(
        text("DELETE FROM services WHERE name = :service"), params
    )
    services_deleted = r.rowcount

    await db.commit()
    return {
        "metrics":  metrics_deleted,
        "traces":   traces_deleted,
        "logs":     logs_deleted,
        "errors":   errors_deleted,
        "services": services_deleted,
    }
