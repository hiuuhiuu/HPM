"""
에러 핑거프린팅 유틸 단위 테스트.

같은 원인에서 발생한 에러가 URL·ID·숫자 등의 노이즈 때문에
다른 fingerprint로 갈라지지 않는지 확인한다.
"""
import sys
from pathlib import Path

# backend/ 루트를 path에 추가 (tests/ 에서 import app.*)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.error_fingerprint import (  # noqa: E402
    compute_fingerprint,
    _normalize_message,
    _extract_stack_key,
)


class TestNormalizeMessage:
    def test_removes_query_string(self):
        assert _normalize_message("GET /api/x?id=1") == "GET /api/x"

    def test_replaces_numbers(self):
        assert "{N}" in _normalize_message("Error at line 42")

    def test_replaces_uuid(self):
        s = _normalize_message("user 550e8400-e29b-41d4-a716-446655440000 not found")
        assert "{UUID}" in s
        assert "550e8400" not in s

    def test_replaces_long_hex(self):
        s = _normalize_message("hash abc123def456abc123def456 invalid")
        assert "{HEX}" in s

    def test_collapses_whitespace(self):
        assert _normalize_message("a    b\n\nc") == "a b c"


class TestExtractStackKey:
    def test_empty_stack_returns_none(self):
        assert _extract_stack_key("") is None
        assert _extract_stack_key(None or "") is None

    def test_java_style_stack(self):
        stack = """java.lang.RuntimeException: oops
    at com.example.Foo.bar(Foo.java:123)
    at com.example.Baz.qux(Baz.java:45)
    at com.example.Main.main(Main.java:12)
"""
        key = _extract_stack_key(stack)
        assert key is not None
        assert "com.example.Foo.bar" in key
        # 라인 번호는 제거되어야 한다
        assert ":123" not in key

    def test_limits_frame_count(self):
        stack = "\n".join(f"at pkg.Class{i}.method{i}(F.java:{i})" for i in range(20))
        key = _extract_stack_key(stack, max_frames=3)
        assert key is not None
        assert key.count("\n") == 2  # 3 줄이므로 newline 2개


class TestComputeFingerprint:
    def test_same_error_same_fingerprint(self):
        fp1 = compute_fingerprint("NullPointerException", "foo is null")
        fp2 = compute_fingerprint("NullPointerException", "foo is null")
        assert fp1 == fp2

    def test_number_noise_grouped(self):
        """URL 내 ID/숫자가 달라도 같은 그룹"""
        fp1 = compute_fingerprint("HttpError 500", "POST /api/order/12345 → 500")
        fp2 = compute_fingerprint("HttpError 500", "POST /api/order/67890 → 500")
        assert fp1 == fp2

    def test_uuid_noise_grouped(self):
        fp1 = compute_fingerprint(
            "NotFound",
            "session 550e8400-e29b-41d4-a716-446655440000 missing",
        )
        fp2 = compute_fingerprint(
            "NotFound",
            "session 11111111-2222-3333-4444-555555555555 missing",
        )
        assert fp1 == fp2

    def test_different_types_different_fingerprint(self):
        fp1 = compute_fingerprint("NullPointerException", "x")
        fp2 = compute_fingerprint("IllegalStateException", "x")
        assert fp1 != fp2

    def test_stack_trace_takes_precedence(self):
        """스택트레이스가 다르면 같은 메시지라도 다른 fingerprint"""
        stack_a = "at com.example.A.foo(A.java:1)\nat com.example.Main.main(Main.java:2)"
        stack_b = "at com.example.B.bar(B.java:1)\nat com.example.Main.main(Main.java:2)"
        fp1 = compute_fingerprint("RuntimeError", "same message", stack_a)
        fp2 = compute_fingerprint("RuntimeError", "same message", stack_b)
        assert fp1 != fp2

    def test_fingerprint_is_16_chars(self):
        fp = compute_fingerprint("X", "y")
        assert len(fp) == 16
        assert all(c in "0123456789abcdef" for c in fp)

    def test_handles_none_inputs(self):
        fp = compute_fingerprint(None, None, None)
        assert len(fp) == 16
