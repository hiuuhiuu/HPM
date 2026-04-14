from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import deployments_service

router = APIRouter(prefix="/api/deployments", tags=["deployments"])


class DeploymentCreate(BaseModel):
    service:     str          = Field(..., description="배포 대상 서비스명")
    version:     Optional[str] = Field(None, description="버전 태그 (예: v1.2.3)")
    commit_sha:  Optional[str] = Field(None, description="Git 커밋 해시")
    environment: str           = Field("production", description="환경 (production/staging/…)")
    description: Optional[str] = Field(None, description="메모/릴리스 노트")
    marker_time: Optional[str] = Field(None, description="ISO8601 시각. 생략 시 현재 시각")


@router.get("")
async def list_deployments(
    service:  Optional[str] = Query(None),
    range:    Optional[str] = Query(None, description="1h / 6h / 24h / 7d"),
    limit:    int           = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """배포 기록 조회"""
    return await deployments_service.list_deployments(db, service, range, limit)


@router.post("")
async def create_deployment(
    payload: DeploymentCreate,
    db: AsyncSession = Depends(get_db),
):
    """새 배포 기록 추가"""
    try:
        return await deployments_service.create_deployment(
            db,
            service=payload.service,
            version=payload.version,
            commit_sha=payload.commit_sha,
            environment=payload.environment,
            description=payload.description,
            marker_time=payload.marker_time,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{deployment_id}")
async def delete_deployment(
    deployment_id: int,
    db: AsyncSession = Depends(get_db),
):
    """배포 기록 삭제"""
    ok = await deployments_service.delete_deployment(db, deployment_id)
    if not ok:
        raise HTTPException(status_code=404, detail="배포 기록을 찾을 수 없습니다")
    return {"status": "success", "id": deployment_id}
