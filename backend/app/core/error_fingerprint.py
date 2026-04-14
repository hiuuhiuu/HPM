"""
에러 핑거프린팅 유틸 — 의미 단위 그룹핑.

동일 원인의 에러가 URL, 요청 ID, 숫자 파라미터 등으로 서로 다른 메시지를
가져서 그룹이 쪼개지는 문제를 해결한다.

우선순위:
1. stack_trace가 있으면 상위 N개 프레임(모듈/함수/파일)을 정규화 후 해시
2. 없으면 error_type + 정규화된 message 해시
"""
import hashlib
import re
from typing import Optional

# 숫자/UUID/해시 등을 placeholder로 치환하여 노이즈 제거
_UUID_RE   = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
_HEX_RE    = re.compile(r"\b[0-9a-f]{16,}\b", re.I)     # 해시·긴 16진수
_NUMBER_RE = re.compile(r"\b\d+\b")
_QUERY_RE  = re.compile(r"\?.*$")                       # URL의 쿼리 스트링 제거
_WS_RE     = re.compile(r"\s+")

# 스택트레이스에서 한 줄 안의 동적 정보(라인번호·메모리 주소) 제거
_LINENO_RE   = re.compile(r":\d+\)")   # (File.java:123) → (File.java)
_ADDR_RE     = re.compile(r"0x[0-9a-f]+", re.I)


def _normalize_message(message: str) -> str:
    """메시지 정규화 — URL 쿼리 제거, 동적 값 치환"""
    s = message or ""
    s = _QUERY_RE.sub("", s)
    s = _UUID_RE.sub("{UUID}", s)
    s = _HEX_RE.sub("{HEX}", s)
    s = _NUMBER_RE.sub("{N}", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def _extract_stack_key(stack_trace: str, max_frames: int = 5) -> Optional[str]:
    """
    스택트레이스에서 상위 N개 프레임의 식별 가능한 부분(클래스.메서드) 추출.
    Java/Python/Node 스택 포맷 모두 커버하기 위해 'at ', 'File ', 'in ' 같은
    프리픽스와 라인번호·주소를 제거한 뒤 프레임당 한 줄로 축약한다.
    """
    if not stack_trace:
        return None
    lines = [ln.strip() for ln in stack_trace.splitlines() if ln.strip()]
    # 예외 타입 헤더 제거 — 'Exception: message' 형태는 스킵
    frames = [ln for ln in lines if ln.startswith(("at ", "File ", "in "))]
    # 프리픽스 없는 스택(파이썬 traceback 본문) 케이스 대비
    if not frames:
        frames = [ln for ln in lines if "(" in ln or "." in ln]

    top = frames[:max_frames]
    norm = []
    for f in top:
        f = _LINENO_RE.sub(")", f)
        f = _ADDR_RE.sub("{ADDR}", f)
        f = _NUMBER_RE.sub("{N}", f)
        norm.append(f.strip())
    if not norm:
        return None
    return "\n".join(norm)


def compute_fingerprint(
    error_type: Optional[str],
    message: Optional[str],
    stack_trace: Optional[str] = None,
) -> str:
    """sha1 해시 문자열 반환 (12자 prefix)"""
    stack_key = _extract_stack_key(stack_trace or "") if stack_trace else None
    if stack_key:
        payload = f"{error_type or ''}\n{stack_key}"
    else:
        payload = f"{error_type or ''}\n{_normalize_message(message or '')}"
    return hashlib.sha1(payload.encode("utf-8", errors="replace")).hexdigest()[:16]
