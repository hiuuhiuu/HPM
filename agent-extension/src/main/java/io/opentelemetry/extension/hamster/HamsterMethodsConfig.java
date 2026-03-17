package io.opentelemetry.extension.hamster;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.logging.Logger;

/**
 * hamster-methods.conf 파일을 파싱하여 공유 설정을 제공하는 싱글턴.
 *
 * 지원하는 conf 형식:
 *   com.bank.service.OrderService[processOrder,cancel]  → 정확한 메서드 지정 (기존)
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
     * 패키지/클래스 와일드카드 규칙 (ByteBuddy 계측에 사용).
     */
    public static final class WildcardRule {
        /** 매칭 기준 문자열.
         *  - classLevel=true  : 정확한 FQCN (예: "com.bank.service.OrderService")
         *  - classLevel=false : 패키지 접두사 (예: "com.bank.service.") — 끝에 점 포함
         */
        public final String pattern;
        /** true → ** (하위 패키지 포함), false → * (직계 자식 클래스만) 또는 classLevel */
        public final boolean recursive;
        /** true → 특정 클래스의 모든 메서드 (ClassName[*]) */
        public final boolean classLevel;

        WildcardRule(String pattern, boolean recursive, boolean classLevel) {
            this.pattern   = pattern;
            this.recursive = recursive;
            this.classLevel = classLevel;
        }
    }

    /** 파싱 결과. */
    public static final class ParsedConfig {
        /** otel.instrumentation.methods.include 에 전달할 정확한 항목 목록. */
        public final List<String> exactEntries;
        /** ByteBuddy 계측에 사용할 와일드카드 규칙 목록. */
        public final List<WildcardRule> wildcardRules;

        ParsedConfig(List<String> exactEntries, List<WildcardRule> wildcardRules) {
            this.exactEntries   = Collections.unmodifiableList(exactEntries);
            this.wildcardRules  = Collections.unmodifiableList(wildcardRules);
        }

        public boolean isEmpty() {
            return exactEntries.isEmpty() && wildcardRules.isEmpty();
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
        //    sun.java.command 는 main class + args 만 담으므로 JVM flags(-javaagent:) 가 없음.
        //    RuntimeMXBean.getInputArguments() 를 통해 실제 JVM 옵션을 탐색한다.
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

        // 탐색한 경로를 모두 출력 (적용 여부 진단용)
        for (File f : candidates) {
            if (f.exists() && f.canRead()) {
                String msg = "[Hamster] Loading method config: " + f.getAbsolutePath();
                System.err.println(msg);
                logger.warning(msg);
                ParsedConfig result = parse(f);
                if (result != null) {
                    int exact    = result.exactEntries.size();
                    int wildcard = result.wildcardRules.size();
                    String summary = "[Hamster] Config loaded — exact=" + exact + ", wildcard=" + wildcard;
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
        return new ParsedConfig(Collections.<String>emptyList(), Collections.<WildcardRule>emptyList());
    }

    // ── 파싱 ───────────────────────────────────────────────────────────────────

    private static ParsedConfig parse(File file) {
        List<String> exactEntries  = new ArrayList<>();
        List<WildcardRule> wildcardRules = new ArrayList<>();

        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;

                // ── 패키지 와일드카드: com.bank.service.* 또는 com.bank.** ──────
                if (line.endsWith(".**")) {
                    // com.bank.** → 하위 패키지 포함 전체
                    String pkg = line.substring(0, line.length() - 3); // ".**" 제거
                    wildcardRules.add(new WildcardRule(pkg + ".", true, false));
                    continue;
                }
                if (line.endsWith(".*")) {
                    // com.bank.service.* → 직계 자식 클래스만
                    String pkg = line.substring(0, line.length() - 2); // ".*" 제거
                    wildcardRules.add(new WildcardRule(pkg + ".", false, false));
                    continue;
                }

                // ── 클래스+메서드 패턴: ClassName[methods] ───────────────────────
                if (line.contains("[") && line.endsWith("]")) {
                    int bracket    = line.indexOf('[');
                    String fqcn    = line.substring(0, bracket).trim();
                    String methods = line.substring(bracket + 1, line.length() - 1).trim();

                    if ("*".equals(methods)) {
                        // ClassName[*] → ByteBuddy 와일드카드 (클래스 레벨)
                        wildcardRules.add(new WildcardRule(fqcn, false, true));
                    } else {
                        // ClassName[method1,method2] → otel.instrumentation.methods.include (기존)
                        exactEntries.add(line);
                    }
                    continue;
                }

                logger.warning("[Hamster] Skipping invalid config line: " + line);
            }
        } catch (Exception e) {
            logger.warning("[Hamster] Failed to read method config: " + e.getMessage());
            return null;
        }

        return new ParsedConfig(exactEntries, wildcardRules);
    }
}
