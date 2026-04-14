"""
배포 마커 서비스 — 배포 시점 기록/조회로 차트 위에 수직선 표시.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.constants import RANGE_INTERVAL


async def list_deployments(
    db: AsyncSession,
    service: Optional[str] = None,
    range_key: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """서비스별/범위별 배포 기록 조회. range_key 없으면 최근 200건."""
    filters: List[str] = []
    params: Dict[str, Any] = {"limit": limit}

    if service:
        filters.append("service = :service")
        params["service"] = service

    if range_key and range_key in RANGE_INTERVAL:
        filters.append(f"marker_time > NOW() - INTERVAL '{RANGE_INTERVAL[range_key]}'")

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""

    result = await db.execute(
        text(f"""
            SELECT id, service, version, commit_sha, environment, description,
                   marker_time, created_at
            FROM deployments
            {where_clause}
            ORDER BY marker_time DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.mappings().all()
    return [
        {
            "id":          row["id"],
            "service":     row["service"],
            "version":     row["version"],
            "commit_sha":  row["commit_sha"],
            "environment": row["environment"],
            "description": row["description"],
            "marker_time": row["marker_time"].isoformat(),
            "created_at":  row["created_at"].isoformat(),
        }
        for row in rows
    ]


async def create_deployment(
    db: AsyncSession,
    service: str,
    version: Optional[str] = None,
    commit_sha: Optional[str] = None,
    environment: str = "production",
    description: Optional[str] = None,
    marker_time: Optional[str] = None,
) -> Dict[str, Any]:
    """새 배포 기록 생성. marker_time 생략 시 현재 시각."""
    # asyncpg는 TIMESTAMPTZ에 문자열 바인딩을 거부하므로 Python datetime으로 변환.
    parsed_time: datetime = datetime.now(timezone.utc)
    if marker_time:
        s = marker_time.replace("Z", "+00:00")
        parsed_time = datetime.fromisoformat(s)
        if parsed_time.tzinfo is None:
            parsed_time = parsed_time.replace(tzinfo=timezone.utc)

    result = await db.execute(
        text("""
            INSERT INTO deployments
                (service, version, commit_sha, environment, description, marker_time)
            VALUES
                (:service, :version, :commit_sha, :environment, :description, :marker_time)
            RETURNING id, marker_time, created_at
        """),
        {
            "service":     service,
            "version":     version,
            "commit_sha":  commit_sha,
            "environment": environment,
            "description": description,
            "marker_time": parsed_time,
        },
    )
    row = result.mappings().one()
    await db.commit()
    return {
        "id":          row["id"],
        "service":     service,
        "version":     version,
        "commit_sha":  commit_sha,
        "environment": environment,
        "description": description,
        "marker_time": row["marker_time"].isoformat(),
        "created_at":  row["created_at"].isoformat(),
    }


async def delete_deployment(db: AsyncSession, deployment_id: int) -> bool:
    """배포 기록 단일 삭제"""
    result = await db.execute(
        text("DELETE FROM deployments WHERE id = :id"),
        {"id": deployment_id},
    )
    await db.commit()
    return (result.rowcount or 0) > 0
