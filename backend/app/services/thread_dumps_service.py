"""
스레드 덤프 온디맨드 수집 서비스
커맨드 폴링 모델: UI → 요청 생성 → companion 폴링 → 결과 제출
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


async def create_request(db: AsyncSession, service: str, instance: str) -> Dict:
    """UI가 수집 요청 생성 → request_id 반환"""
    r = await db.execute(
        text("""
            INSERT INTO thread_dump_requests (service, instance, status)
            VALUES (:service, :instance, 'pending')
            RETURNING id, requested_at, service, instance, status
        """),
        {"service": service, "instance": instance},
    )
    await db.commit()
    row = r.mappings().one()
    return dict(row)


async def get_pending_request(db: AsyncSession, instance: str) -> Optional[Dict]:
    """companion이 폴링 — 가장 오래된 pending 요청 반환"""
    r = await db.execute(
        text("""
            SELECT id, requested_at, service, instance, status
            FROM thread_dump_requests
            WHERE instance = :instance AND status = 'pending'
            ORDER BY requested_at ASC
            LIMIT 1
        """),
        {"instance": instance},
    )
    row = r.mappings().first()
    return dict(row) if row else None


async def submit_result(db: AsyncSession, request_id: int, dump_text: str) -> Dict:
    """companion이 결과 제출 → thread_dumps 저장 + request status → collected"""
    # request 존재 확인
    req = await db.execute(
        text("SELECT id, service, instance FROM thread_dump_requests WHERE id = :id"),
        {"id": request_id},
    )
    row = req.mappings().first()
    if not row:
        raise ValueError(f"request_id {request_id} 없음")

    # 덤프 저장
    ins = await db.execute(
        text("""
            INSERT INTO thread_dumps (service, instance, dump_text, request_id)
            VALUES (:service, :instance, :dump_text, :request_id)
            RETURNING id, collected_at, service, instance, request_id
        """),
        {
            "service": row["service"],
            "instance": row["instance"],
            "dump_text": dump_text,
            "request_id": request_id,
        },
    )
    dump_row = ins.mappings().one()

    # request status 업데이트
    await db.execute(
        text("""
            UPDATE thread_dump_requests
            SET status = 'collected', completed_at = NOW()
            WHERE id = :id
        """),
        {"id": request_id},
    )
    await db.commit()
    return dict(dump_row)


async def expire_old_requests(db: AsyncSession) -> int:
    """30초 이상 pending인 요청을 timeout 처리"""
    r = await db.execute(
        text("""
            UPDATE thread_dump_requests
            SET status = 'timeout', completed_at = NOW()
            WHERE status = 'pending'
              AND requested_at < NOW() - INTERVAL '30 seconds'
            RETURNING id
        """)
    )
    await db.commit()
    return r.rowcount


async def get_dump_list(
    db: AsyncSession,
    service: Optional[str],
    instance: Optional[str],
    page: int = 1,
    limit: int = 20,
) -> Dict:
    """페이지네이션 목록"""
    offset = (page - 1) * limit
    where = "WHERE 1=1"
    params: Dict[str, Any] = {"limit": limit, "offset": offset}
    if service:
        where += " AND d.service = :service"
        params["service"] = service
    if instance:
        where += " AND d.instance = :instance"
        params["instance"] = instance

    count_r = await db.execute(
        text(f"SELECT COUNT(*) FROM thread_dumps d {where}"), params
    )
    total = count_r.scalar() or 0

    rows_r = await db.execute(
        text(f"""
            SELECT d.id, d.collected_at, d.service, d.instance,
                   d.request_id,
                   r.requested_at, r.status AS request_status
            FROM thread_dumps d
            LEFT JOIN thread_dump_requests r ON r.id = d.request_id
            {where}
            ORDER BY d.collected_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(row) for row in rows_r.mappings()]
    return {"total": total, "page": page, "limit": limit, "items": items}


async def get_dump_by_id(db: AsyncSession, dump_id: int) -> Optional[Dict]:
    """dump_text 포함 전체 내용"""
    r = await db.execute(
        text("""
            SELECT d.id, d.collected_at, d.service, d.instance,
                   d.dump_text, d.request_id,
                   r.requested_at, r.status AS request_status
            FROM thread_dumps d
            LEFT JOIN thread_dump_requests r ON r.id = d.request_id
            WHERE d.id = :id
        """),
        {"id": dump_id},
    )
    row = r.mappings().first()
    return dict(row) if row else None


async def get_request_status(db: AsyncSession, request_id: int) -> Optional[Dict]:
    """요청 상태 조회 (UI 폴링용)"""
    r = await db.execute(
        text("""
            SELECT r.id, r.requested_at, r.service, r.instance,
                   r.status, r.completed_at,
                   d.id AS dump_id
            FROM thread_dump_requests r
            LEFT JOIN thread_dumps d ON d.request_id = r.id
            WHERE r.id = :id
        """),
        {"id": request_id},
    )
    row = r.mappings().first()
    return dict(row) if row else None


async def delete_dump(db: AsyncSession, dump_id: int) -> bool:
    """덤프 삭제"""
    r = await db.execute(
        text("DELETE FROM thread_dumps WHERE id = :id RETURNING id"),
        {"id": dump_id},
    )
    await db.commit()
    return r.rowcount > 0
