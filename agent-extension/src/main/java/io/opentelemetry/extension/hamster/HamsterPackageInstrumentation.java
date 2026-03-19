package io.opentelemetry.extension.hamster;

import io.opentelemetry.javaagent.extension.instrumentation.TypeInstrumentation;
import io.opentelemetry.javaagent.extension.instrumentation.TypeTransformer;
import net.bytebuddy.description.method.MethodDescription;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.matcher.ElementMatcher;
import net.bytebuddy.matcher.ElementMatchers;

import java.util.List;

/**
 * hamster-methods.conf 의 모든 규칙을 ByteBuddy 로 적용하는 TypeInstrumentation.
 *
 * 지원하는 규칙 (모두 이 클래스에서 처리):
 *   ClassName[method1,method2] → 지정 클래스의 지정 메서드만
 *   ClassName[*]               → 지정 클래스의 모든 메서드
 *   com.bank.service.*         → 패키지 직계 클래스의 모든 메서드
 *   com.bank.**                → 패키지 및 하위 패키지 전체 클래스의 모든 메서드
 */
public class HamsterPackageInstrumentation implements TypeInstrumentation {

    private static final java.util.logging.Logger log =
            java.util.logging.Logger.getLogger(HamsterPackageInstrumentation.class.getName());

    @Override
    public ElementMatcher<TypeDescription> typeMatcher() {
        List<HamsterMethodsConfig.WildcardRule> rules = HamsterMethodsConfig.get().wildcardRules;
        if (rules.isEmpty()) {
            return ElementMatchers.none();
        }

        ElementMatcher.Junction<TypeDescription> combined = ElementMatchers.none();
        for (HamsterMethodsConfig.WildcardRule rule : rules) {
            combined = combined.or(ruleToClassMatcher(rule));
        }

        // 매칭된 클래스마다 로그 출력 — 어떤 클래스가 실제로 후킹됐는지 확인 가능
        final ElementMatcher.Junction<TypeDescription> finalMatcher = combined;
        return new ElementMatcher.Junction.AbstractBase<TypeDescription>() {
            @Override
            public boolean matches(TypeDescription target) {
                boolean matched = finalMatcher.matches(target);
                if (matched) {
                    String msg = "[Hamster] Hooking class: " + target.getName();
                    System.err.println(msg);
                    log.warning(msg);
                }
                return matched;
            }
        };
    }

    @Override
    public void transform(TypeTransformer transformer) {
        transformer.applyAdviceToMethod(
                ElementMatchers.isMethod()
                        .and(ElementMatchers.not(ElementMatchers.isSynthetic()))
                        .and(ElementMatchers.not(ElementMatchers.isBridge()))
                        .and(shouldTraceMethod()),
                MethodTracingAdvice.class.getName());
    }

    // ── 클래스 매처 ───────────────────────────────────────────────────────────

    private static ElementMatcher.Junction<TypeDescription> ruleToClassMatcher(
            final HamsterMethodsConfig.WildcardRule rule) {

        if (rule.classLevel) {
            // ClassName[*] / ClassName[method1,method2] → 정확한 FQCN 매칭
            return ElementMatchers.named(rule.pattern);
        }

        if (rule.recursive) {
            // com.bank.** → 하위 패키지 포함 + 내부클래스(ClassName$Inner) 포함
            String base = rule.pattern.substring(0, rule.pattern.length() - 1); // 끝 점 제거
            return ElementMatchers.nameStartsWith(rule.pattern)
                    .or(ElementMatchers.named(base))
                    .or(ElementMatchers.nameStartsWith(base + "$"));
        }

        // com.bank.service.* → 직계 클래스만 (하위 패키지 제외, 내부클래스 포함)
        return new ElementMatcher.Junction.AbstractBase<TypeDescription>() {
            @Override
            public boolean matches(TypeDescription target) {
                String name = target.getName();
                if (!name.startsWith(rule.pattern)) return false;
                return !name.substring(rule.pattern.length()).contains(".");
            }
        };
    }

    // ── 메서드 매처 ───────────────────────────────────────────────────────────

    /**
     * 규칙에 메서드 목록이 있으면(ClassName[m1,m2]) 해당 메서드만,
     * 없으면(ClassName[*], pkg.*, pkg.**) 모든 메서드를 통과시킨다.
     */
    private static ElementMatcher.Junction<MethodDescription> shouldTraceMethod() {
        return new ElementMatcher.Junction.AbstractBase<MethodDescription>() {
            @Override
            public boolean matches(MethodDescription target) {
                String className  = target.getDeclaringType().asErasure().getName();
                String methodName = target.getName();

                for (HamsterMethodsConfig.WildcardRule rule : HamsterMethodsConfig.get().wildcardRules) {
                    if (!classMatchesRule(rule, className)) continue;

                    // 규칙이 이 클래스에 해당함
                    if (rule.methods == null) {
                        // 모든 메서드 대상
                        return true;
                    }
                    if (rule.methods.contains(methodName)) {
                        // 지정 메서드 목록에 포함
                        return true;
                    }
                }
                return false;
            }
        };
    }

    /** typeMatcher 와 동일한 클래스 매칭 로직 (메서드 레벨에서 재사용). */
    private static boolean classMatchesRule(HamsterMethodsConfig.WildcardRule rule, String className) {
        if (rule.classLevel) {
            return rule.pattern.equals(className);
        }
        if (rule.recursive) {
            String base = rule.pattern.substring(0, rule.pattern.length() - 1);
            return className.startsWith(rule.pattern)
                    || className.equals(base)
                    || className.startsWith(base + "$");
        }
        // non-recursive: 직계 자식 클래스만
        if (!className.startsWith(rule.pattern)) return false;
        return !className.substring(rule.pattern.length()).contains(".");
    }
}
