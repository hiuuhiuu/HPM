from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter(prefix="/api/agents", tags=["agents"])


class AgentConfig(BaseModel):
    min_span_duration_ms: int = 0


def _build_response(instance: str, row) -> dict:
    return {"instance": instance, "min_span_duration_ms": row[0], "updated_at": str(row[1])}


@router.put("/{instance}/config")
async def upsert_agent_config(
    instance: str,
    body: AgentConfig,
    db: AsyncSession = Depends(get_db),
):
    """에이전트 설정을 저장하고 최신 설정을 반환한다.

    에이전트는 시작 시 및 60초마다 이 엔드포인트를 호출한다.
    대시보드에서 값을 변경한 경우 응답에 반영된 값이 에이전트에 적용된다.
    """
    # UPSERT: 에이전트가 처음 등록 시에만 INSERT. 이후 대시보드 변경값을 우선 유지.
    row = await db.execute(text("""
        INSERT INTO agent_configs (instance, min_span_duration_ms, updated_at)
        VALUES (:instance, :ms, NOW())
        ON CONFLICT (instance) DO NOTHING
        RETURNING min_span_duration_ms, updated_at
    """), {"instance": instance, "ms": body.min_span_duration_ms})
    await db.commit()

    result = row.fetchone()
    if result:
        return _build_response(instance, result)

    # ON CONFLICT DO NOTHING 으로 삽입되지 않은 경우 (이미 존재) DB 값 반환
    row = await db.execute(
        text("SELECT min_span_duration_ms, updated_at FROM agent_configs WHERE instance = :i"),
        {"i": instance},
    )
    result = row.fetchone()
    if result:
        return _build_response(instance, result)
    return {"instance": instance, "min_span_duration_ms": body.min_span_duration_ms}


@router.get("/{instance}/config")
async def get_agent_config(
    instance: str,
    db: AsyncSession = Depends(get_db),
):
    """에이전트 설정을 조회한다."""
    row = await db.execute(
        text("SELECT min_span_duration_ms, updated_at FROM agent_configs WHERE instance = :i"),
        {"i": instance},
    )
    result = row.fetchone()
    if result:
        return _build_response(instance, result)
    return {"instance": instance, "min_span_duration_ms": 0, "updated_at": None}


@router.get("")
async def list_agent_configs(db: AsyncSession = Depends(get_db)):
    """등록된 모든 에이전트 설정 목록을 반환한다."""
    rows = await db.execute(
        text("SELECT instance, min_span_duration_ms, updated_at FROM agent_configs ORDER BY instance")
    )
    return [{"instance": r[0], "min_span_duration_ms": r[1], "updated_at": str(r[2])} for r in rows.fetchall()]


@router.patch("/{instance}/config")
async def patch_agent_config(
    instance: str,
    body: AgentConfig,
    db: AsyncSession = Depends(get_db),
):
    """대시보드에서 에이전트 설정을 변경한다. 에이전트의 다음 폴링 시 반영된다."""
    row = await db.execute(text("""
        INSERT INTO agent_configs (instance, min_span_duration_ms, updated_at)
        VALUES (:instance, :ms, NOW())
        ON CONFLICT (instance) DO UPDATE
            SET min_span_duration_ms = EXCLUDED.min_span_duration_ms,
                updated_at           = NOW()
        RETURNING min_span_duration_ms, updated_at
    """), {"instance": instance, "ms": body.min_span_duration_ms})
    await db.commit()

    result = row.fetchone()
    return _build_response(instance, result)
