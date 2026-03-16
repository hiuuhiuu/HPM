from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.services import settings_service

router = APIRouter(redirect_slashes=False)

class SettingsUpdateRequest(BaseModel):
    settings: Dict[str, str]

@router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    """현재 시스템 설정(데이터 보존 기간 등)을 조회합니다."""
    settings = await settings_service.get_all_settings(db)
    return settings

@router.put("")
async def update_settings(request: SettingsUpdateRequest, db: AsyncSession = Depends(get_db)):
    """시스템 설정을 갱신하고 타임스케일DB 데이터 보존 정책을 업데이트합니다."""
    try:
        await settings_service.update_settings(db, request.settings)
        return {"status": "success", "message": "설정이 성공적으로 저장되었으며 정책이 갱신되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"설정 업데이트 중 오류 발생: {str(e)}")
