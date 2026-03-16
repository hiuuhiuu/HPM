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
        scheduler.scheduleWithFixedDelay(this::pollAndProcess, 5, 20, TimeUnit.SECONDS);
    }

    private void pollAndProcess() {
        try {
            // 1. Poll for pending request
            String pollUrl = backendUrl + "/api/thread-dumps/pending?instance=" + serviceInstanceId;
            String response = httpGet(pollUrl);
            
            if (response == null || response.trim().isEmpty() || response.equals("null")) {
                return;
            }

            // Simple "JSON" parsing for id (avoiding dependencies like Jackson for small JAR)
            int requestId = parseIdFromJson(response);
            if (requestId == -1) return;

            logger.info("Received thread dump request: " + requestId);

            // 2. Capture Thread Dump
            String threadDump = captureThreadDump();

            // 3. Submit Result
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
            // Escape simple quotes for JSON
            String escapedText = dumpText.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
            String jsonBody = "{\"request_id\": " + requestId + ", \"dump_text\": \"" + escapedText + "\"}";
            
            httpPost(url, jsonBody);
            logger.info("Successfully submitted thread dump for request: " + requestId);
        } catch (Exception e) {
            logger.log(Level.SEVERE, "Failed to submit thread dump: " + e.getMessage());
        }
    }

    private String httpGet(String urlStr) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        
        int code = conn.getResponseCode();
        if (code == 200) {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                return sb.toString();
            }
        }
        return null;
    }

    private void httpPost(String urlStr, String jsonBody) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(10000);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(jsonBody.getBytes("UTF-8"));
        }
        
        int code = conn.getResponseCode();
        if (code >= 300) {
            throw new RuntimeException("HTTP Post failed with code: " + code);
        }
    }

    private int parseIdFromJson(String json) {
        // Look for "id": 123
        try {
            int index = json.indexOf("\"id\":");
            if (index == -1) return -1;
            int start = index + 5;
            int end = json.indexOf(",", start);
            if (end == -1) end = json.indexOf("}", start);
            return Integer.parseInt(json.substring(start, end).trim());
        } catch (Exception e) {
            return -1;
        }
    }
}
