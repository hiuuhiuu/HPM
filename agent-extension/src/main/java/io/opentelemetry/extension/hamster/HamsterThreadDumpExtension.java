package io.opentelemetry.extension.hamster;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * OpenTelemetry Java Agent Extension for On-Demand Thread Dumps.
 * Polls the APM backend and submits thread dumps when requested.
 *
 * <p>추가 기능:
 * <ul>
 *   <li>시작 시 현재 에이전트 설정을 백엔드에 등록 (PUT /api/agents/{instance}/config)</li>
 *   <li>60초마다 백엔드 설정을 폴링 → MinDurationSpanExporter 동적 갱신</li>
 * </ul>
 * </p>
 */
public class HamsterThreadDumpExtension {
    private static final Logger logger = Logger.getLogger(HamsterThreadDumpExtension.class.getName());

    private final String backendUrl;
    private final String serviceInstanceId;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "hamster-thread-dump-poller");
        t.setDaemon(true);
        return t;
    });

    public HamsterThreadDumpExtension(String backendUrl, String serviceInstanceId) {
        this.backendUrl = backendUrl.endsWith("/") ? backendUrl.substring(0, backendUrl.length() - 1) : backendUrl;
        this.serviceInstanceId = serviceInstanceId;
    }

    public void start() {
        logger.info("Starting Hamster Thread Dump Extension for instance: " + serviceInstanceId);
        // 스레드 덤프 폴링 (20초)
        scheduler.scheduleWithFixedDelay(this::pollAndProcess, 5, 20, TimeUnit.SECONDS);
        // 설정 등록 + 폴링 (초기: 3초 후 첫 등록, 이후 60초)
        scheduler.scheduleWithFixedDelay(this::syncConfig, 3, 60, TimeUnit.SECONDS);
    }

    // ── 스레드 덤프 ─────────────────────────────────────────────────────────

    private void pollAndProcess() {
        try {
            String pollUrl = backendUrl + "/api/thread-dumps/pending?instance=" + serviceInstanceId;
            String response = httpRequest("GET", pollUrl, null);

            if (response == null || response.trim().isEmpty() || response.equals("null")) {
                return;
            }

            int requestId = (int) parseLongFromJson(response, "id", -1);
            if (requestId == -1) return;

            logger.info("Received thread dump request: " + requestId);
            String threadDump = captureThreadDump();
            submitResult(requestId, threadDump);

        } catch (Exception e) {
            logger.log(Level.WARNING, "Error in thread dump poller: " + e.getMessage());
        }
    }

    private String captureThreadDump() {
        ThreadMXBean threadMXBean = ManagementFactory.getThreadMXBean();
        ThreadInfo[] threadInfos = threadMXBean.dumpAllThreads(true, true);
        StringBuilder sb = new StringBuilder();
        sb.append("Hamster APM - Thread Dump for ").append(serviceInstanceId).append("\n");
        sb.append("Time: ").append(new java.util.Date()).append("\n\n");
        for (ThreadInfo info : threadInfos) {
            sb.append(info.toString()).append("\n");
        }
        return sb.toString();
    }

    private void submitResult(int requestId, String dumpText) {
        try {
            String url = backendUrl + "/api/thread-dumps/result";
            String escapedText = dumpText.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
            String jsonBody = "{\"request_id\": " + requestId + ", \"dump_text\": \"" + escapedText + "\"}";
            httpRequest("POST", url, jsonBody);
            logger.info("Successfully submitted thread dump for request: " + requestId);
        } catch (Exception e) {
            logger.log(Level.SEVERE, "Failed to submit thread dump: " + e.getMessage());
        }
    }

    // ── 설정 동기화 ─────────────────────────────────────────────────────────

    /**
     * 현재 설정을 백엔드에 PUT 등록하고, 백엔드의 최신 설정을 받아 MinDurationSpanExporter 에 반영한다.
     */
    private void syncConfig() {
        try {
            // 현재 로컬 설정(파일 기반 초기값) 전송
            MinDurationSpanExporter exporter = MinDurationSpanExporterHolder.get();
            long currentMinMs = (exporter != null) ? exporter.getMinDurationMs() : 0;

            String url = backendUrl + "/api/agents/" + urlEncode(serviceInstanceId) + "/config";
            String body = "{\"min_span_duration_ms\": " + currentMinMs + "}";
            String response = httpRequest("PUT", url, body);

            // 백엔드가 반환한 최신 설정 적용 (다른 사람이 대시보드에서 변경했을 수 있음)
            if (response != null && exporter != null) {
                long serverMinMs = parseLongFromJson(response, "min_span_duration_ms", -1);
                if (serverMinMs >= 0 && serverMinMs != currentMinMs) {
                    exporter.setMinDurationMs(serverMinMs);
                    logger.warning("[Hamster] Config updated from dashboard: min_span_duration_ms=" + serverMinMs + "ms");
                }
            }
        } catch (Exception e) {
            logger.log(Level.WARNING, "Config sync failed (will retry): " + e.getMessage());
        }
    }

    // ── HTTP 유틸 ────────────────────────────────────────────────────────────

    /**
     * HTTP 요청을 수행하고 응답 바디를 반환한다.
     * @param method  "GET", "POST", "PUT"
     * @param urlStr  대상 URL
     * @param jsonBody null이면 바디 없음 (GET)
     */
    private String httpRequest(String method, String urlStr, String jsonBody) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(method.equals("POST") ? 10000 : 5000);

        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }

        int code = conn.getResponseCode();
        if (code >= 200 && code < 300) {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                return sb.toString();
            }
        }
        if (code >= 300) {
            throw new RuntimeException("HTTP " + method + " failed with code: " + code);
        }
        return null;
    }

    // ── 파싱 유틸 ────────────────────────────────────────────────────────────

    private long parseLongFromJson(String json, String key, long defaultValue) {
        try {
            String search = "\"" + key + "\":";
            int index = json.indexOf(search);
            if (index == -1) return defaultValue;
            int start = index + search.length();
            while (start < json.length() && json.charAt(start) == ' ') start++;
            int end = start;
            while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '-')) end++;
            return Long.parseLong(json.substring(start, end).trim());
        } catch (Exception e) {
            return defaultValue;
        }
    }

    private static String urlEncode(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return s;
        }
    }
}
