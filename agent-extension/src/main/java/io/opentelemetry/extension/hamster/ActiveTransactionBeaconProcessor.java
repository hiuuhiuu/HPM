package io.opentelemetry.extension.hamster;

import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Context;
import io.opentelemetry.sdk.trace.ReadWriteSpan;
import io.opentelemetry.sdk.trace.ReadableSpan;
import io.opentelemetry.sdk.trace.SpanProcessor;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.*;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * 현재 처리 중인 root SERVER 스팬을 추적하여 APM 서버에 주기적으로 비콘을 전송한다.
 *
 * <p>OTel 표준은 스팬 완료 후에만 export하므로, 처리 중인 거래는 백엔드에 보이지 않는다.
 * 이 프로세서가 그 갭을 메워 "실시간 활성 거래" 대시보드 패널을 동작시킨다.
 *
 * <p>3초 주기로 POST /api/dashboard/active-transactions/beacon 전송.
 */
public class ActiveTransactionBeaconProcessor implements SpanProcessor {

    private static final Logger logger = Logger.getLogger(ActiveTransactionBeaconProcessor.class.getName());
    private static final long BEACON_INTERVAL_MS = 3_000;

    private final String backendUrl;
    private final String serviceName;
    private final String instanceId;
    private final ConcurrentHashMap<String, ActiveSpanInfo> activeSpans = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "hamster-active-txn-beacon");
        t.setDaemon(true);
        return t;
    });

    public ActiveTransactionBeaconProcessor(String backendUrl, String serviceName, String instanceId) {
        this.backendUrl = backendUrl.endsWith("/") ? backendUrl.substring(0, backendUrl.length() - 1) : backendUrl;
        this.serviceName = serviceName;
        this.instanceId = instanceId;
    }

    public void startBeacon() {
        scheduler.scheduleWithFixedDelay(this::sendBeacon, 3, BEACON_INTERVAL_MS / 1000, TimeUnit.SECONDS);
        logger.info("[Hamster] ActiveTransactionBeacon started (interval: " + BEACON_INTERVAL_MS + "ms)");
    }

    // ── SpanProcessor 인터페이스 ─────────────────────────────────

    @Override
    public void onStart(Context parentContext, ReadWriteSpan span) {
        // root SERVER 스팬만 추적 (진입점 = 활성 거래)
        if (!span.getParentSpanContext().isValid() && span.getKind() == SpanKind.SERVER) {
            activeSpans.put(span.getSpanContext().getSpanId(), new ActiveSpanInfo(
                    span.getSpanContext().getTraceId(),
                    span.getName(),
                    System.currentTimeMillis()
            ));
        }
    }

    @Override
    public void onEnd(ReadableSpan span) {
        activeSpans.remove(span.getSpanContext().getSpanId());
    }

    @Override
    public boolean isStartRequired() { return true; }

    @Override
    public boolean isEndRequired() { return true; }

    // ── 비콘 전송 ───────────────────────────────────────────────

    private void sendBeacon() {
        try {
            long now = System.currentTimeMillis();
            StringBuilder txns = new StringBuilder("[");
            boolean first = true;

            for (Map.Entry<String, ActiveSpanInfo> entry : activeSpans.entrySet()) {
                ActiveSpanInfo info = entry.getValue();
                long elapsed = now - info.startedAtMs;
                if (!first) txns.append(",");
                txns.append("{\"trace_id\":\"").append(info.traceId).append("\"")
                    .append(",\"span_name\":\"").append(jsonEscape(info.spanName)).append("\"")
                    .append(",\"duration_ms\":").append(elapsed)
                    .append(",\"status\":\"OK\"")
                    .append(",\"started_at\":\"").append(new java.util.Date(info.startedAtMs).toInstant().toString()).append("\"")
                    .append("}");
                first = false;
            }
            txns.append("]");

            String json = "{\"service\":\"" + jsonEscape(serviceName) + "\""
                    + ",\"instance\":\"" + jsonEscape(instanceId) + "\""
                    + ",\"transactions\":" + txns.toString()
                    + "}";

            String url = backendUrl + "/api/dashboard/active-transactions/beacon";
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(json.getBytes("UTF-8"));
            }
            int code = conn.getResponseCode();
            if (code >= 300) {
                logger.warning("[Hamster] Beacon POST failed: HTTP " + code);
            }
        } catch (Exception e) {
            // 네트워크 일시 장애 시 조용히 넘김 — 다음 주기에 재시도
            logger.log(Level.FINE, "[Hamster] Beacon send error: " + e.getMessage());
        }
    }

    private static String jsonEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // ── 내부 데이터 ─────────────────────────────────────────────

    private static class ActiveSpanInfo {
        final String traceId;
        final String spanName;
        final long startedAtMs;

        ActiveSpanInfo(String traceId, String spanName, long startedAtMs) {
            this.traceId = traceId;
            this.spanName = spanName;
            this.startedAtMs = startedAtMs;
        }
    }
}
