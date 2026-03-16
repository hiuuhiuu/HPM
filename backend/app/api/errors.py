from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import errors_service

router = APIRouter(prefix="/api")

RangeKey = Literal["1h", "6h", "24h", "7d"]


@router.get("/errors")
async def list_errors(
    service:    Optional[str]  = Query(None),
    resolved:   Optional[bool] = Query(None, description="true=해결됨 / false=미해결 / 없으면 전체"),
    error_type: Optional[str]  = Query(None),
    range:      RangeKey       = Query("1h"),
    page:       int            = Query(1, ge=1),
    limit:      int            = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """에러 목록"""
    return await errors_service.get_error_list(
        db, service, resolved, error_type, range, page, limit
    )


@router.get("/errors/stats")
async def error_stats(
    service: Optional[str] = Query(None),
    range:   RangeKey      = Query("1h"),
    db: AsyncSession = Depends(get_db),
):
    """에러 통계 (유형별 분포, 시간대별 추이)"""
    return await errors_service.get_error_stats(db, service, range)


@router.get("/errors/{error_id}")
async def get_error(error_id: int, db: AsyncSession = Depends(get_db)):
    """에러 상세"""
    err = await errors_service.get_error_by_id(db, error_id)
    if not err:
        raise HTTPException(status_code=404, detail="에러를 찾을 수 없습니다.")
    return err


from app.core.websocket import manager

class ResolveRequest(BaseModel):
    resolved: bool


@router.patch("/errors/{error_id}/resolve")
async def resolve_error(
    error_id: int,
    body: ResolveRequest,
    db: AsyncSession = Depends(get_db),
):
    """에러 해결/미해결 처리"""
    err = await errors_service.resolve_error(db, error_id, body.resolved)
    if not err:
        raise HTTPException(status_code=404, detail="에러를 찾을 수 없습니다.")
        
    # Broadcast updated error stats to all connected clients
    try:
        stats = await errors_service.get_error_stats(db, None, "1h")
        await manager.broadcast({
            "type": "update",
            "unresolved": stats.get("unresolved", 0)
        })
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to broadcast websocket update: {e}")
        
    return err
