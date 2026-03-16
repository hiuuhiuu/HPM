from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import thread_dumps_service

router = APIRouter(prefix="/api/thread-dumps")


# ─────────────────────────────────────────────
# 스키마
# ─────────────────────────────────────────────

class RequestBody(BaseModel):
    service: str
    instance: str


class ResultBody(BaseModel):
    request_id: int
    dump_text: str


# ─────────────────────────────────────────────
# 엔드포인트
# ─────────────────────────────────────────────

@router.get("/instances")
async def list_instances(
    service: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """서비스에 속한 인스턴스 목록 (traces 기준 최근 24시간)"""
    r = await db.execute(
        text("""
            SELECT DISTINCT instance
            FROM traces
            WHERE service = :service
              AND instance IS NOT NULL
              AND start_time > NOW() - INTERVAL '24 hours'
            ORDER BY instance
        """),
        {"service": service},
    )
    return {"instances": [row[0] for row in r.fetchall()]}


@router.post("/request", status_code=201)
async def create_request(body: RequestBody, db: AsyncSession = Depends(get_db)):
    """UI → 수집 요청 생성"""
    # 오래된 timeout 처리
    await thread_dumps_service.expire_old_requests(db)
    return await thread_dumps_service.create_request(db, body.service, body.instance)


@router.get("/request/{request_id}")
async def get_request_status(request_id: int, db: AsyncSession = Depends(get_db)):
    """UI가 수집 완료 여부 폴링"""
    await thread_dumps_service.expire_old_requests(db)
    result = await thread_dumps_service.get_request_status(db, request_id)
    if not result:
        raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다.")
    return result


@router.get("/pending")
async def get_pending(instance: str = Query(...), db: AsyncSession = Depends(get_db)):
    """companion 스크립트가 폴링 — pending 요청 반환 (없으면 null)"""
    await thread_dumps_service.expire_old_requests(db)
    result = await thread_dumps_service.get_pending_request(db, instance)
    return result  # None이면 null 반환 (404 대신)


@router.post("/result", status_code=201)
async def submit_result(body: ResultBody, db: AsyncSession = Depends(get_db)):
    """companion 스크립트가 덤프 결과 제출"""
    try:
        return await thread_dumps_service.submit_result(db, body.request_id, body.dump_text)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("")
async def list_dumps(
    service:  Optional[str] = Query(None),
    instance: Optional[str] = Query(None),
    page:     int = Query(1, ge=1),
    limit:    int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """덤프 목록 (페이지네이션)"""
    return await thread_dumps_service.get_dump_list(db, service, instance, page, limit)


@router.get("/{dump_id}")
async def get_dump(dump_id: int, db: AsyncSession = Depends(get_db)):
    """덤프 전체 내용 조회"""
    result = await thread_dumps_service.get_dump_by_id(db, dump_id)
    if not result:
        raise HTTPException(status_code=404, detail="덤프를 찾을 수 없습니다.")
    return result


@router.delete("/{dump_id}", status_code=204)
async def delete_dump(dump_id: int, db: AsyncSession = Depends(get_db)):
    """덤프 삭제"""
    deleted = await thread_dumps_service.delete_dump(db, dump_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="덤프를 찾을 수 없습니다.")
