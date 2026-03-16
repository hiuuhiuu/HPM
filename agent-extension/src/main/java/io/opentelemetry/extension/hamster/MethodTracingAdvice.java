package io.opentelemetry.extension.hamster;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
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
 */
public final class MethodTracingAdvice {

    private MethodTracingAdvice() {}

    @Advice.OnMethodEnter(suppress = Throwable.class)
    public static void onEnter(
            @Advice.Origin("#t") String className,
            @Advice.Origin("#m") String methodName,
            @Advice.Local("hamsterSpan")  Span  span,
            @Advice.Local("hamsterScope") Scope scope) {

        // 패키지 제거 → 가독성 높은 스팬 이름 (예: OrderService.processOrder)
        String simpleName = className;
        int dot = className.lastIndexOf('.');
        if (dot >= 0) {
            simpleName = className.substring(dot + 1);
        }

        span = GlobalOpenTelemetry.get()
                .getTracer("io.opentelemetry.extension.hamster", "0.1.0")
                .spanBuilder(simpleName + "." + methodName)
                .setSpanKind(SpanKind.INTERNAL)
                .startSpan();

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
