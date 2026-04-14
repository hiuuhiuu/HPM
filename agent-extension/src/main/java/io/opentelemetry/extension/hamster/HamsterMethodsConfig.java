package io.opentelemetry.extension.hamster;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
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
     * 스팬 억제 규칙 — 매칭된 스팬은 Sampler 레벨에서 드랍한다.
     *
     * 지원 형식 (hamster-methods.conf):
     *   suppress:span:<prefix>       → 스팬 이름이 prefix 로 시작하면 억제
     *   suppress:http:<path-prefix>  → HTTP SERVER 스팬의 URL 경로가 prefix 로 시작하면 억제
     *   suppress:sql:<prefix>        → db.statement 속성이 prefix 로 시작하면 억제 (대소문자 무시)
     *   suppress:attr:<key>=<value>  → OTel 속성 key=value 가 정확히 일치하면 억제
     *   suppress:class:<prefix>      → code.namespace 속성이 prefix 로 시작하면 억제
     */
    public static final class SuppressRule {
        public enum Type { SPAN_NAME, HTTP_PATH, SQL_STATEMENT, ATTRIBUTE, CLASS_NAME }

        public final Type   type;
        public final String pattern;   // SPAN_NAME / HTTP_PATH / SQL_STATEMENT / CLASS_NAME
        public final String attrKey;   // ATTRIBUTE only
        public final String attrValue; // ATTRIBUTE only

        SuppressRule(Type type, String pattern, String attrKey, String attrValue) {
            this.type      = type;
            this.pattern   = pattern;
            this.attrKey   = attrKey;
            this.attrValue = attrValue;
        }
    }

    /**
     * ByteBuddy 계측 규칙.
     */
    public static final class WildcardRule {
        /**
         * 매칭 기준 문자열.
         *  - classLevel=true  : 정확한 FQCN (예: "com.bank.service.OrderService")
         *  - classLevel=false, extendsClass=false : 패키지 접두사 (예: "com.bank.service.") — 끝에 점 포함
         *  - extendsClass=true : 슈퍼클래스/인터페이스 FQCN (예: "javax.servlet.http.HttpServlet")
         */
        public final String pattern;
        /** true → ** (하위 패키지 포함), false → * (직계) 또는 classLevel */
        public final boolean recursive;
        /** true → 특정 클래스를 직접 지정 (ClassName[methods] 또는 ClassName[*]) */
        public final boolean classLevel;
        /** true → 해당 클래스/인터페이스를 상속·구현한 모든 하위 클래스 (extends:ClassName[methods]) */
        public final boolean extendsClass;
        /**
         * null  → 클래스의 모든 메서드 (ClassName[*], pkg.*, pkg.**)
         * 비어있지 않은 Set → 지정 메서드만 (ClassName[method1,method2])
         */
        public final Set<String> methods;

        WildcardRule(String pattern, boolean recursive, boolean classLevel, boolean extendsClass, Set<String> methods) {
            this.pattern     = pattern;
            this.recursive   = recursive;
            this.classLevel  = classLevel;
            this.extendsClass = extendsClass;
            this.methods     = methods;
        }
    }

    /** 파싱 결과 */
    public static final class ParsedConfig {
        /** ByteBuddy 계측 규칙 목록 — ClassName[m1,m2], pkg.*, pkg.** 등 */
        public final List<WildcardRule>  wildcardRules;
        /** Sampler 레벨 억제 규칙 목록 */
        public final List<SuppressRule>  suppressRules;

        ParsedConfig(List<WildcardRule> wildcardRules, List<SuppressRule> suppressRules) {
            this.wildcardRules = Collections.unmodifiableList(wildcardRules);
            this.suppressRules = Collections.unmodifiableList(suppressRules);
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
        return new ParsedConfig(
                Collections.<WildcardRule>emptyList(),
                Collections.<SuppressRule>emptyList());
    }

    // ── 파싱 ───────────────────────────────────────────────────────────────────

    private static ParsedConfig parse(File file) {
        List<WildcardRule>  rules    = new ArrayList<>();
        List<SuppressRule>  suppress = new ArrayList<>();

        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;

                // ── 스팬 억제 규칙: suppress:<type>:<pattern> ─────────────────
                if (line.startsWith("suppress:")) {
                    String rest = line.substring("suppress:".length());

                    if (rest.startsWith("span:")) {
                        suppress.add(new SuppressRule(
                                SuppressRule.Type.SPAN_NAME,
                                rest.substring("span:".length()).trim(),
                                null, null));
                    } else if (rest.startsWith("http:")) {
                        suppress.add(new SuppressRule(
                                SuppressRule.Type.HTTP_PATH,
                                rest.substring("http:".length()).trim(),
                                null, null));
                    } else if (rest.startsWith("sql:")) {
                        // 대소문자 무시 — 저장 시 소문자로 정규화
                        String pattern = rest.substring("sql:".length()).trim().toLowerCase(Locale.ROOT);
                        suppress.add(new SuppressRule(
                                SuppressRule.Type.SQL_STATEMENT, pattern, null, null));
                    } else if (rest.startsWith("attr:")) {
                        String kv = rest.substring("attr:".length()).trim();
                        int eq = kv.indexOf('=');
                        if (eq > 0) {
                            suppress.add(new SuppressRule(
                                    SuppressRule.Type.ATTRIBUTE, null,
                                    kv.substring(0, eq).trim(),
                                    kv.substring(eq + 1).trim()));
                        } else {
                            logger.warning("[Hamster] Skipping invalid suppress:attr line (missing '='): " + line);
                        }
                    } else if (rest.startsWith("class:")) {
                        suppress.add(new SuppressRule(
                                SuppressRule.Type.CLASS_NAME,
                                rest.substring("class:".length()).trim(),
                                null, null));
                    } else {
                        logger.warning("[Hamster] Skipping unknown suppress type: " + line);
                    }
                    continue;
                }

                // ── 상속 후킹: extends:SuperClass[methods] ──────────────────────
                if (line.startsWith("extends:")) {
                    String rest = line.substring("extends:".length()).trim();
                    if (rest.contains("[") && rest.endsWith("]")) {
                        int bracket    = rest.indexOf('[');
                        String fqcn    = rest.substring(0, bracket).trim();
                        String methods = rest.substring(bracket + 1, rest.length() - 1).trim();
                        Set<String> methodSet = null;
                        if (!"*".equals(methods)) {
                            methodSet = new HashSet<>();
                            for (String m : methods.split(",")) {
                                String trimmed = m.trim();
                                if (!trimmed.isEmpty()) methodSet.add(trimmed);
                            }
                        }
                        rules.add(new WildcardRule(fqcn, false, false, true, methodSet));
                    } else {
                        logger.warning("[Hamster] Skipping invalid extends rule: " + line);
                    }
                    continue;
                }

                // ── 패키지 와일드카드: com.bank.service.* 또는 com.bank.** ──────
                if (line.endsWith(".**")) {
                    String pkg = line.substring(0, line.length() - 3);
                    rules.add(new WildcardRule(pkg + ".", true, false, false, null));
                    continue;
                }
                if (line.endsWith(".*")) {
                    String pkg = line.substring(0, line.length() - 2);
                    rules.add(new WildcardRule(pkg + ".", false, false, false, null));
                    continue;
                }

                // ── 클래스+메서드 패턴: ClassName[methods] ───────────────────────
                if (line.contains("[") && line.endsWith("]")) {
                    int bracket    = line.indexOf('[');
                    String fqcn    = line.substring(0, bracket).trim();
                    String methods = line.substring(bracket + 1, line.length() - 1).trim();

                    if ("*".equals(methods)) {
                        // ClassName[*] → 클래스의 모든 메서드
                        rules.add(new WildcardRule(fqcn, false, true, false, null));
                    } else {
                        // ClassName[method1,method2] → 지정 메서드만
                        Set<String> methodSet = new HashSet<>();
                        for (String m : methods.split(",")) {
                            String trimmed = m.trim();
                            if (!trimmed.isEmpty()) methodSet.add(trimmed);
                        }
                        rules.add(new WildcardRule(fqcn, false, true, false, methodSet));
                    }
                    continue;
                }

                logger.warning("[Hamster] Skipping invalid config line: " + line);
            }
        } catch (Exception e) {
            logger.warning("[Hamster] Failed to read method config: " + e.getMessage());
            return null;
        }

        return new ParsedConfig(rules, suppress);
    }
}
