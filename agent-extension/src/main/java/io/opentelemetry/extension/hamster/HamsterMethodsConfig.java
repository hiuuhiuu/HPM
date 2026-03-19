package io.opentelemetry.extension.hamster;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.logging.Logger;

/**
 * hamster-methods.conf 파일을 파싱하여 공유 설정을 제공하는 싱글턴.
 *
 * 지원하는 conf 형식 (모두 ByteBuddy 경로로 처리):
 *   com.bank.service.OrderService[processOrder,cancel]  → 지정 메서드만 계측
 *   com.bank.service.OrderService[*]                    → 해당 클래스의 모든 메서드
 *   com.bank.service.*                                  → 패키지 직계 클래스 전체
 *   com.bank.**                                         → 패키지 및 하위 패키지 전체
 */
public final class HamsterMethodsConfig {

    private static final Logger logger = Logger.getLogger(HamsterMethodsConfig.class.getName());
    private static volatile ParsedConfig config = null;

    private HamsterMethodsConfig() {}

    /** 설정을 반환한다. 최초 호출 시 파일을 읽고 이후에는 캐시를 반환한다. */
    public static ParsedConfig get() {
        if (config == null) {
            synchronized (HamsterMethodsConfig.class) {
                if (config == null) {
                    config = load();
                }
            }
        }
        return config;
    }

    // ── 데이터 클래스 ──────────────────────────────────────────────────────────

    /**
     * ByteBuddy 계측 규칙.
     */
    public static final class WildcardRule {
        /**
         * 매칭 기준 문자열.
         *  - classLevel=true  : 정확한 FQCN (예: "com.bank.service.OrderService")
         *  - classLevel=false : 패키지 접두사 (예: "com.bank.service.") — 끝에 점 포함
         */
        public final String pattern;
        /** true → ** (하위 패키지 포함), false → * (직계) 또는 classLevel */
        public final boolean recursive;
        /** true → 특정 클래스를 직접 지정 (ClassName[methods] 또는 ClassName[*]) */
        public final boolean classLevel;
        /**
         * null  → 클래스의 모든 메서드 (ClassName[*], pkg.*, pkg.**)
         * 비어있지 않은 Set → 지정 메서드만 (ClassName[method1,method2])
         */
        public final Set<String> methods;

        WildcardRule(String pattern, boolean recursive, boolean classLevel, Set<String> methods) {
            this.pattern    = pattern;
            this.recursive  = recursive;
            this.classLevel = classLevel;
            this.methods    = methods;
        }
    }

    /** 파싱 결과 — 모든 규칙이 wildcardRules 에 통합됨. */
    public static final class ParsedConfig {
        /**
         * ByteBuddy 계측 규칙 목록.
         * ClassName[method1,method2], ClassName[*], pkg.*, pkg.** 모두 포함.
         */
        public final List<WildcardRule> wildcardRules;

        ParsedConfig(List<WildcardRule> wildcardRules) {
            this.wildcardRules = Collections.unmodifiableList(wildcardRules);
        }

        public boolean isEmpty() {
            return wildcardRules.isEmpty();
        }
    }

    // ── 파일 탐색 ──────────────────────────────────────────────────────────────

    private static ParsedConfig load() {
        List<File> candidates = new ArrayList<>();

        // 1. 명시적 시스템 프로퍼티
        String explicitPath = System.getProperty("hamster.methods.config");
        if (explicitPath != null) {
            candidates.add(new File(explicitPath));
        }

        // 2. 에이전트 JAR 동일 디렉토리
        try {
            java.util.List<String> jvmArgs =
                    java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments();
            for (String token : jvmArgs) {
                if (token.startsWith("-javaagent:")) {
                    String jarPath = token.substring("-javaagent:".length()).split("=")[0];
                    File jarFile = new File(jarPath);
                    candidates.add(new File(jarFile.getParentFile(), "hamster-methods.conf"));
                    break;
                }
            }
        } catch (Exception ignored) {}

        // 3. 기본 설치 경로
        candidates.add(new File("/waslib/hamster-methods.conf"));

        for (File f : candidates) {
            if (f.exists() && f.canRead()) {
                String msg = "[Hamster] Loading method config: " + f.getAbsolutePath();
                System.err.println(msg);
                logger.warning(msg);
                ParsedConfig result = parse(f);
                if (result != null) {
                    String summary = "[Hamster] Config loaded — rules=" + result.wildcardRules.size();
                    System.err.println(summary);
                    logger.warning(summary);
                    return result;
                }
            } else {
                String miss = "[Hamster] Config candidate not found or unreadable: " + f.getAbsolutePath();
                System.err.println(miss);
                logger.warning(miss);
            }
        }

        String none = "[Hamster] No method config file found. Hooking disabled.";
        System.err.println(none);
        logger.warning(none);
        return new ParsedConfig(Collections.<WildcardRule>emptyList());
    }

    // ── 파싱 ───────────────────────────────────────────────────────────────────

    private static ParsedConfig parse(File file) {
        List<WildcardRule> rules = new ArrayList<>();

        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;

                // ── 패키지 와일드카드: com.bank.service.* 또는 com.bank.** ──────
                if (line.endsWith(".**")) {
                    String pkg = line.substring(0, line.length() - 3);
                    rules.add(new WildcardRule(pkg + ".", true, false, null));
                    continue;
                }
                if (line.endsWith(".*")) {
                    String pkg = line.substring(0, line.length() - 2);
                    rules.add(new WildcardRule(pkg + ".", false, false, null));
                    continue;
                }

                // ── 클래스+메서드 패턴: ClassName[methods] ───────────────────────
                if (line.contains("[") && line.endsWith("]")) {
                    int bracket    = line.indexOf('[');
                    String fqcn    = line.substring(0, bracket).trim();
                    String methods = line.substring(bracket + 1, line.length() - 1).trim();

                    if ("*".equals(methods)) {
                        // ClassName[*] → 클래스의 모든 메서드
                        rules.add(new WildcardRule(fqcn, false, true, null));
                    } else {
                        // ClassName[method1,method2] → 지정 메서드만
                        Set<String> methodSet = new HashSet<>();
                        for (String m : methods.split(",")) {
                            String trimmed = m.trim();
                            if (!trimmed.isEmpty()) methodSet.add(trimmed);
                        }
                        rules.add(new WildcardRule(fqcn, false, true, methodSet));
                    }
                    continue;
                }

                logger.warning("[Hamster] Skipping invalid config line: " + line);
            }
        } catch (Exception e) {
            logger.warning("[Hamster] Failed to read method config: " + e.getMessage());
            return null;
        }

        return new ParsedConfig(rules);
    }
}
