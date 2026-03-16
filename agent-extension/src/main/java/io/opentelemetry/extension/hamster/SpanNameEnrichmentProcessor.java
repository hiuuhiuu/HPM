package io.opentelemetry.extension.hamster;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.sdk.trace.ReadWriteSpan;
import io.opentelemetry.sdk.trace.ReadableSpan;
import io.opentelemetry.sdk.trace.SpanProcessor;

/**
 * HTTP Server 스팬 이름 개선 프로세서.
 *
 * OTel 서블릿 계측은 URL 매핑 패턴(/* 등)을 스팬명으로 사용한다.
 * 이 프로세서는 스팬 시작 시점에 http.target / url.path 속성을 읽어
 * "GET /bank/transfer/process" 형태의 실제 경로로 스팬명을 교체한다.
 *
 * 지원하는 OTel 시맨틱 규격:
 *   - OTel 1.x (구): http.method, http.target
 *   - OTel 2.x (신): http.request.method, url.path
 */
public class SpanNameEnrichmentProcessor implements SpanProcessor {

    // OTel 2.x 신규 시맨틱
    private static final AttributeKey<String> HTTP_REQUEST_METHOD =
            AttributeKey.stringKey("http.request.method");
    private static final AttributeKey<String> URL_PATH =
            AttributeKey.stringKey("url.path");

    // OTel 1.x 구 시맨틱 (하위 호환)
    private static final AttributeKey<String> HTTP_METHOD =
            AttributeKey.stringKey("http.method");
    private static final AttributeKey<String> HTTP_TARGET =
            AttributeKey.stringKey("http.target");

    @Override
    public void onStart(Context parentContext, ReadWriteSpan span) {
        // SERVER 스팬만 처리
        if (span.getKind() != SpanKind.SERVER) return;

        // 와일드카드 라우트(/* 포함)이거나 메서드만 있는 스팬명인 경우만 개선
        String name = span.getName();
        if (!name.contains("/*") && !isGenericName(name)) return;

        String method = firstNonNull(
                span.getAttribute(HTTP_REQUEST_METHOD),
                span.getAttribute(HTTP_METHOD));

        String path = span.getAttribute(URL_PATH);
        if (path == null) {
            // http.target = 경로 + 쿼리스트링이므로 쿼리스트링 제거
            String target = span.getAttribute(HTTP_TARGET);
            if (target != null) {
                int q = target.indexOf('?');
                path = (q >= 0) ? target.substring(0, q) : target;
            }
        }

        if (path != null && !path.isEmpty()) {
            span.updateName(method != null ? method + " " + path : path);
        }
    }

    @Override
    public boolean isStartRequired() {
        return true;
    }

    @Override
    public void onEnd(ReadableSpan span) {
        // 사용 안 함
    }

    @Override
    public boolean isEndRequired() {
        return false;
    }

    /** 스팬명이 "GET", "POST" 등 메서드 단어만으로 이루어진 경우 개선 대상으로 처리 */
    private static boolean isGenericName(String name) {
        switch (name) {
            case "GET": case "POST": case "PUT": case "DELETE":
            case "PATCH": case "HEAD": case "OPTIONS":
                return true;
            default:
                return false;
        }
    }

    private static String firstNonNull(String a, String b) {
        return (a != null) ? a : b;
    }
}
