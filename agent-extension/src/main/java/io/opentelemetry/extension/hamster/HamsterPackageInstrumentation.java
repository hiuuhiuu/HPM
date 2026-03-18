package io.opentelemetry.extension.hamster;

import io.opentelemetry.javaagent.extension.instrumentation.TypeInstrumentation;
import io.opentelemetry.javaagent.extension.instrumentation.TypeTransformer;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.matcher.ElementMatcher;
import net.bytebuddy.matcher.ElementMatchers;

import java.util.List;

/**
 * hamster-methods.conf 의 와일드카드 규칙을 ByteBuddy 로 적용하는 TypeInstrumentation.
 *
 * 지원하는 규칙:
 *   ClassName[*]        → 특정 클래스의 모든 메서드
 *   com.bank.service.*  → 패키지 직계 클래스의 모든 메서드
 *   com.bank.**         → 패키지 및 하위 패키지 전체 클래스의 모든 메서드
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
            combined = combined.or(ruleToMatcher(rule));
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

    private static ElementMatcher.Junction<TypeDescription> ruleToMatcher(
            final HamsterMethodsConfig.WildcardRule rule) {

        if (rule.classLevel) {
            // ClassName[*] → 정확한 FQCN 매칭
            return ElementMatchers.named(rule.pattern);
        }

        if (rule.recursive) {
            // com.bank.** → 패키지 접두사로 시작하는 모든 클래스 (하위 패키지 포함)
            // ClassName.** 형태인 경우 내부클래스(ClassName$Inner)도 포함:
            //   rule.pattern = "jeus.servlet.engine.ServletWrapper." 일 때
            //   → named("...ServletWrapper")          외부 클래스 자체
            //   → nameStartsWith("...ServletWrapper$") 내부 클래스 (핵심 수정)
            //   → nameStartsWith("...ServletWrapper.") 하위 패키지 클래스
            String base = rule.pattern.substring(0, rule.pattern.length() - 1); // 끝 점 제거
            return ElementMatchers.nameStartsWith(rule.pattern)
                    .or(ElementMatchers.named(base))
                    .or(ElementMatchers.nameStartsWith(base + "$"));
        }

        // com.bank.service.* → 직계 클래스만 (하위 패키지 제외, 내부클래스 포함)
        // rule.pattern = "com.bank.service." (끝에 점 포함)
        // 내부클래스는 $ 구분자를 쓰므로 점이 없는 suffix면 통과
        return new ElementMatcher.Junction.AbstractBase<TypeDescription>() {
            @Override
            public boolean matches(TypeDescription target) {
                String name = target.getName();
                if (!name.startsWith(rule.pattern)) return false;
                return !name.substring(rule.pattern.length()).contains(".");
            }
        };
    }

    @Override
    public void transform(TypeTransformer transformer) {
        // 모든 public 메서드 (생성자·합성 메서드·브릿지 메서드 제외)
        transformer.applyAdviceToMethod(
                ElementMatchers.isMethod()
                        .and(ElementMatchers.not(ElementMatchers.isSynthetic()))
                        .and(ElementMatchers.not(ElementMatchers.isBridge())),
                MethodTracingAdvice.class.getName());
    }
}
