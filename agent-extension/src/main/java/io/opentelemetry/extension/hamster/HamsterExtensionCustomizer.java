package io.opentelemetry.extension.hamster;

import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizer;
import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider;
import io.opentelemetry.sdk.autoconfigure.spi.ConfigProperties;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

/**
 * OTel AutoConfiguration 훅.
 * - 스레드 덤프 폴러 시작
 * - hamster-methods.conf 의 정확한 메서드 항목을 otel.instrumentation.methods.include 에 등록
 *   (와일드카드 규칙은 HamsterInstrumentationModule / ByteBuddy 가 처리)
 */
public class HamsterExtensionCustomizer implements AutoConfigurationCustomizerProvider {

    private static final Logger logger = Logger.getLogger(HamsterExtensionCustomizer.class.getName());

    @Override
    public void customize(AutoConfigurationCustomizer autoConfigurationCustomizer) {
        autoConfigurationCustomizer.addPropertiesCustomizer(this::buildProperties);
        // HTTP 서버 스팬명 개선: "GET /*" → "GET /actual/path"
        autoConfigurationCustomizer.addTracerProviderCustomizer(
                (builder, config) -> builder.addSpanProcessor(new SpanNameEnrichmentProcessor()));
    }

    private Map<String, String> buildProperties(ConfigProperties config) {
        // ── 1. 백엔드 URL 결정 ────────────────────────────────────────────────
        String backendUrl = System.getProperty("hamster.backend.url");
        if (backendUrl == null) {
            backendUrl = config.getString("otel.exporter.otlp.endpoint");
            if (backendUrl != null) {
                backendUrl = backendUrl.replaceAll("/otlp$", "")
                                       .replaceAll("/(v1/)?(traces|metrics|logs)$", "");
            } else {
                backendUrl = "http://localhost:8000";
            }
        }

        // ── 2. 인스턴스 ID 추출 ──────────────────────────────────────────────
        String serviceName  = config.getString("otel.service.name", "unknown-service");
        String resourceAttr = config.getString("otel.resource.attributes", "");
        String instanceId   = extractInstanceId(resourceAttr, serviceName);

        // ── 3. 스레드 덤프 폴러 시작 ─────────────────────────────────────────
        new HamsterThreadDumpExtension(backendUrl, instanceId).start();

        // ── 4. 정확한 메서드 항목만 otel.instrumentation.methods.include 에 등록 ──
        Map<String, String> extraProps = new HashMap<>();
        List<String> exactEntries = HamsterMethodsConfig.get().exactEntries;
        if (!exactEntries.isEmpty()) {
            String methodsInclude = join(exactEntries, ";");
            String existing = config.getString("otel.instrumentation.methods.include");
            if (existing != null && !existing.isEmpty()) {
                methodsInclude = existing + ";" + methodsInclude;
            }
            extraProps.put("otel.instrumentation.methods.include", methodsInclude);
            logger.info("[Hamster] Exact method tracing: " + methodsInclude);
        }

        // 와일드카드 규칙 수 로그 출력 (ByteBuddy 모듈이 처리)
        int wildcardCount = HamsterMethodsConfig.get().wildcardRules.size();
        if (wildcardCount > 0) {
            logger.info("[Hamster] Wildcard rules registered for ByteBuddy: " + wildcardCount);
        }

        return extraProps;
    }

    private static String extractInstanceId(String attributes, String serviceName) {
        if (attributes != null && attributes.contains("service.instance.id=")) {
            for (String pair : attributes.split(",")) {
                if (pair.startsWith("service.instance.id=")) {
                    return pair.split("=")[1];
                }
            }
        }
        try {
            return serviceName + "-" + java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return serviceName + "-unknown-host";
        }
    }

    private static String join(List<String> list, String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(sep);
            sb.append(list.get(i));
        }
        return sb.toString();
    }
}
