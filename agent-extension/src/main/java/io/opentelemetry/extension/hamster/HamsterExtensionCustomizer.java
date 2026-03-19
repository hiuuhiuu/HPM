package io.opentelemetry.extension.hamster;

import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizer;
import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider;
import io.opentelemetry.sdk.autoconfigure.spi.ConfigProperties;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

/**
 * OTel AutoConfiguration 훅.
 * - 스레드 덤프 폴러 시작
 * - 설정된 후킹 규칙 로그 출력 (모든 규칙은 HamsterInstrumentationModule / ByteBuddy 가 처리)
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

        // ── 4. 설정된 후킹 규칙 로그 출력 (ByteBuddy 가 클래스 로드 시 처리) ──
        List<HamsterMethodsConfig.WildcardRule> rules = HamsterMethodsConfig.get().wildcardRules;
        if (!rules.isEmpty()) {
            String header = "[Hamster] ByteBuddy rules: " + rules.size();
            System.err.println(header);
            logger.warning(header);
            for (HamsterMethodsConfig.WildcardRule r : rules) {
                String kind;
                if (r.classLevel) {
                    kind = r.methods == null ? "class[*]" : "class" + r.methods;
                } else {
                    kind = r.recursive ? ".**" : ".*";
                }
                String detail = "[Hamster]   " + kind + " -> " + r.pattern;
                System.err.println(detail);
                logger.warning(detail);
            }
        } else {
            String none = "[Hamster] No hooking rules configured.";
            System.err.println(none);
            logger.warning(none);
        }

        return Collections.emptyMap();
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
}
