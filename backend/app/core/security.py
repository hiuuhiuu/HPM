"""
관리자 API 접근 제어 (옵트인)

데이터 삭제·보존 정책 변경 등 파괴적 작업에 적용되는 단순 API Key 기반 인가.

동작 방식:
- `ADMIN_API_KEY` 환경변수가 비어 있으면 인증을 **생략**하고 모든 요청을 통과시킨다.
  (단일 사용자 / 폐쇄망 개발 환경 편의)
- `ADMIN_API_KEY`가 설정되어 있으면 `X-Admin-API-Key` 헤더 일치 시에만 통과.
"""
import hmac
import logging
from typing import Optional

from fastapi import Header, HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_ADMIN_API_KEY_HEADER = "X-Admin-API-Key"
_warned_disabled = False


async def verify_admin_api_key(
    x_admin_api_key: Optional[str] = Header(default=None, alias=_ADMIN_API_KEY_HEADER),
) -> None:
    """관리자 API Key 검증 FastAPI Dependency."""
    expected = (settings.admin_api_key or "").strip()
    if not expected:
        global _warned_disabled
        if not _warned_disabled:
            logger.warning(
                "[Security] ADMIN_API_KEY 미설정 — 파괴적 엔드포인트 인증이 비활성화되어 있습니다. "
                "운영 환경에서는 반드시 .env에 ADMIN_API_KEY를 설정하십시오."
            )
            _warned_disabled = True
        return

    provided = (x_admin_api_key or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="관리자 인증에 실패했습니다.",
            headers={"WWW-Authenticate": _ADMIN_API_KEY_HEADER},
        )
