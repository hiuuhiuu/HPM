package io.opentelemetry.extension.hamster;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanBuilder;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Scope;
import net.bytebuddy.asm.Advice;

/**
 * ByteBuddy Advice — 와일드카드 규칙에 매칭된 메서드에 인라인 삽입된다.
 *
 * 동작:
 *  - OnMethodEnter: OTel INTERNAL 스팬을 시작하고 현재 컨텍스트로 설정
 *  - OnMethodExit : 스코프·스팬 종료, 예외 발생 시 ERROR 상태 기록
 *
 * JSP/Servlet/Filter 자동 감지: 메서드명으로 웹 계층을 식별하여
 * 가독성 높은 스팬 이름("JSP <Class>", "Servlet <Class>.<method>" 등)을 부여한다.
 *
 * 주의: ByteBuddy Advice 는 타겟 메서드에 인라인되므로 private helper 메서드 호출은
 *       IllegalAccessError 를 유발한다. 모든 로직을 onEnter/onExit 내부에 직접 작성해야 한다.
 */
public final class MethodTracingAdvice {

    // Advice 가 실제로 실행되는지 확인하기 위한 1회성 플래그
    // (ByteBuddy 가 이 클래스를 각 ClassLoader 에 주입하므로 ClassLoader 당 1회 출력)
    private static volatile boolean firstSpanLogged = false;

    private MethodTracingAdvice() {}

    @Advice.OnMethodEnter(suppress = Throwable.class)
    public static void onEnter(
            @Advice.Origin("#t") String className,
            @Advice.Origin("#m") String methodName,
            @Advice.Local("hamsterSpan")  Span  span,
            @Advice.Local("hamsterScope") Scope scope) {

        // 첫 번째 실제 호출 시 1회만 로그 — Advice 가 작동 중임을 확인
        if (!firstSpanLogged) {
            firstSpanLogged = true;
            System.err.println("[Hamster] Advice executing — first traced call: "
                    + className + "." + methodName);
        }

        // 패키지·외부클래스 부분 제거 → 가독성 높은 스팬 이름 (예: OrderService$Inner.handle)
        String simpleName = className;
        int dot = className.lastIndexOf('.');
        if (dot >= 0) {
            simpleName = className.substring(dot + 1);
        }

        // ── JSP/Servlet/Filter 특수 포맷 ──────────────────────────────────────
        // 메서드명으로 웹 계층을 식별. private helper 호출 금지(인라인 제약).
        String spanName;
        String kind;
        if ("_jspService".equals(methodName)) {
            spanName = "JSP " + simpleName;
            kind = "jsp";
        } else if ("service".equals(methodName)
                || "doGet".equals(methodName)
                || "doPost".equals(methodName)
                || "doPut".equals(methodName)
                || "doDelete".equals(methodName)
                || "doHead".equals(methodName)
                || "doOptions".equals(methodName)
                || "doTrace".equals(methodName)) {
            spanName = "Servlet " + simpleName + "." + methodName;
            kind = "servlet";
        } else if ("doFilter".equals(methodName)) {
            spanName = "Filter " + simpleName + ".doFilter";
            kind = "filter";
        } else {
            spanName = simpleName + "." + methodName;
            kind = null;
        }

        SpanBuilder builder = GlobalOpenTelemetry.get()
                .getTracer("io.opentelemetry.extension.hamster", "0.1.0")
                .spanBuilder(spanName)
                .setSpanKind(SpanKind.INTERNAL)
                .setAttribute("code.namespace", className)
                .setAttribute("code.function", methodName);
        if (kind != null) {
            builder = builder.setAttribute("code.hamster.kind", kind);
        }

        span = builder.startSpan();
        scope = span.makeCurrent();
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class, suppress = Throwable.class)
    public static void onExit(
            @Advice.Thrown Throwable throwable,
            @Advice.Local("hamsterSpan")  Span  span,
            @Advice.Local("hamsterScope") Scope scope) {

        if (scope != null) {
            scope.close();
        }
        if (span != null) {
            if (throwable != null) {
                span.setStatus(StatusCode.ERROR);
                span.recordException(throwable);
            }
            span.end();
        }
    }
}
