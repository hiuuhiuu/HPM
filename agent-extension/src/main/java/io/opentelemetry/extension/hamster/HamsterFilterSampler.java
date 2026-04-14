package io.opentelemetry.extension.hamster;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.sdk.trace.data.LinkData;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import io.opentelemetry.sdk.trace.samplers.SamplingResult;

import java.util.List;
import java.util.Locale;

/**
 * hamster-methods.conf 의 suppress: 규칙을 적용하는 커스텀 Sampler.
 *
 * 매칭된 스팬은 SamplingResult.drop() 으로 처리되어:
 *   - 스팬이 생성되지 않음 (메모리/CPU 절약)
 *   - 자식 스팬도 동일하게 드랍 (고아 스팬 없음)
 *   - 백엔드로 전송 안 됨
 *
 * 억제 대상 예시:
 *   suppress:span:Quartz            → Quartz 스케쥴러 스팬
 *   suppress:http:/health           → 헬스체크 HTTP 요청
 *   suppress:sql:select 1           → DB 체크쿼리
 *   suppress:attr:job.system=quartz → OTel Quartz 자동계측 스팬
 */
final class HamsterFilterSampler implements Sampler {

    private static final AttributeKey<String> URL_PATH =
            AttributeKey.stringKey("url.path");
    private static final AttributeKey<String> HTTP_TARGET =
            AttributeKey.stringKey("http.target");
    private static final AttributeKey<String> DB_STATEMENT =
            AttributeKey.stringKey("db.statement");
    private static final AttributeKey<String> CODE_NAMESPACE =
            AttributeKey.stringKey("code.namespace");

    private final Sampler                           delegate;
    private final List<HamsterMethodsConfig.SuppressRule> rules;

    HamsterFilterSampler(Sampler delegate, List<HamsterMethodsConfig.SuppressRule> rules) {
        this.delegate = delegate;
        this.rules    = rules;
    }

    @Override
    public SamplingResult shouldSample(
            Context parentContext,
            String traceId,
            String spanName,
            SpanKind spanKind,
            Attributes attributes,
            List<LinkData> parentLinks) {

        if (shouldDrop(spanName, spanKind, attributes)) {
            return SamplingResult.drop();
        }
        return delegate.shouldSample(parentContext, traceId, spanName, spanKind, attributes, parentLinks);
    }

    @Override
    public String getDescription() {
        return "HamsterFilterSampler{" + delegate.getDescription() + ", rules=" + rules.size() + "}";
    }

    // ── 억제 판단 ──────────────────────────────────────────────────────────────

    private boolean shouldDrop(String spanName, SpanKind spanKind, Attributes attributes) {
        for (HamsterMethodsConfig.SuppressRule rule : rules) {
            switch (rule.type) {
                case SPAN_NAME:
                    if (spanName.startsWith(rule.pattern)) return true;
                    break;

                case HTTP_PATH:
                    if (spanKind == SpanKind.SERVER) {
                        String path = resolveHttpPath(attributes);
                        if (path != null && path.startsWith(rule.pattern)) return true;
                    }
                    break;

                case SQL_STATEMENT:
                    // rule.pattern 은 이미 소문자로 저장됨 (파싱 시 정규화)
                    String stmt = attributes.get(DB_STATEMENT);
                    if (stmt != null && stmt.toLowerCase(Locale.ROOT).startsWith(rule.pattern)) return true;
                    break;

                case ATTRIBUTE:
                    String val = attributes.get(AttributeKey.stringKey(rule.attrKey));
                    if (rule.attrValue.equals(val)) return true;
                    break;

                case CLASS_NAME:
                    String ns = attributes.get(CODE_NAMESPACE);
                    if (ns != null && ns.startsWith(rule.pattern)) return true;
                    break;

                default:
                    break;
            }
        }
        return false;
    }

    /** http.target 또는 url.path 속성에서 쿼리스트링 제거 후 경로 반환 */
    private static String resolveHttpPath(Attributes attributes) {
        String path = attributes.get(URL_PATH);
        if (path != null) return path;

        String target = attributes.get(HTTP_TARGET);
        if (target == null) return null;
        int q = target.indexOf('?');
        return (q >= 0) ? target.substring(0, q) : target;
    }
}
