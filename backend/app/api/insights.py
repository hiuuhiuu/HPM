from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import insights_service

router = APIRouter(prefix="/api/insights")


@router.get("")
async def get_insights(db: AsyncSession = Depends(get_db)):
    """룰 기반 자동 인사이트 분석 결과"""
    return await insights_service.get_insights(db)
