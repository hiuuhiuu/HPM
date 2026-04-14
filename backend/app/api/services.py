from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import verify_admin_api_key
from app.services import services_management_service

router = APIRouter(prefix="/api", redirect_slashes=False)


@router.get("/instances")
async def list_instances(db: AsyncSession = Depends(get_db)):
    """모든 서비스·인스턴스 목록과 활성 상태 반환"""
    return await services_management_service.get_all_instances(db)


@router.delete("/instances/{service}/{instance}", dependencies=[Depends(verify_admin_api_key)])
async def delete_instance(service: str, instance: str, db: AsyncSession = Depends(get_db)):
    """특정 인스턴스의 수집 데이터 삭제 (metrics, traces, logs). 관리자 인증 필요."""
    try:
        deleted = await services_management_service.delete_instance(db, service, instance)
        return {"status": "success", "deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/services/{service}", dependencies=[Depends(verify_admin_api_key)])
async def delete_service(service: str, db: AsyncSession = Depends(get_db)):
    """서비스 전체 삭제 (모든 텔레메트리 + 서비스 레지스트리). 관리자 인증 필요."""
    try:
        deleted = await services_management_service.delete_service(db, service)
        return {"status": "success", "deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
