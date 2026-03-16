from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import alerts_service

router = APIRouter(prefix="/api/alerts")


# ─────────────────────────────────────────────
# 스키마
# ─────────────────────────────────────────────

class RuleBody(BaseModel):
    name:        str
    description: Optional[str] = None
    service:     Optional[str] = None
    metric_name: str
    condition:   Literal["gt", "lt", "gte", "lte", "eq"]
    threshold:   float
    duration_s:  int   = Field(default=60,  ge=10, le=3600)
    severity:    Literal["info", "warning", "critical"] = "warning"
    enabled:     bool  = True


# ─────────────────────────────────────────────
# 규칙 CRUD
# ─────────────────────────────────────────────

@router.get("/rules")
async def list_rules(db: AsyncSession = Depends(get_db)):
    """알림 규칙 목록"""
    return await alerts_service.get_rules(db)


@router.post("/rules", status_code=201)
async def create_rule(body: RuleBody, db: AsyncSession = Depends(get_db)):
    """알림 규칙 생성"""
    return await alerts_service.create_rule(db, body.model_dump())


@router.put("/rules/{rule_id}")
async def update_rule(
    rule_id: int, body: RuleBody, db: AsyncSession = Depends(get_db)
):
    """알림 규칙 수정"""
    rule = await alerts_service.update_rule(db, rule_id, body.model_dump())
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """알림 규칙 삭제"""
    deleted = await alerts_service.delete_rule(db, rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")


@router.patch("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """알림 규칙 활성화/비활성화 토글"""
    rule = await alerts_service.toggle_rule(db, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    return rule


# ─────────────────────────────────────────────
# 이벤트 조회
# ─────────────────────────────────────────────

@router.get("/events")
async def list_events(
    rule_id: Optional[int] = Query(None),
    status:  Optional[Literal["firing", "resolved"]] = Query(None),
    page:    int = Query(1, ge=1),
    limit:   int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """알림 발생 이력"""
    return await alerts_service.get_events(db, rule_id, status, page, limit)


@router.get("/active")
async def active_events(db: AsyncSession = Depends(get_db)):
    """현재 발화 중인 알림"""
    return await alerts_service.get_active_events(db)
