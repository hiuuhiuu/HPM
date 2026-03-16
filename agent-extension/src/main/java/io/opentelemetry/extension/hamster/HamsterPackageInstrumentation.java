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

    @Override
    public ElementMatcher<TypeDescription> typeMatcher() {
        List<HamsterMethodsConfig.WildcardRule> rules = HamsterMethodsConfig.get().wildcardRules;
        if (rules.isEmpty()) {
            return ElementMatchers.none();
        }

        ElementMatcher.Junction<TypeDescription> matcher = ElementMatchers.none();
        for (HamsterMethodsConfig.WildcardRule rule : rules) {
            matcher = matcher.or(ruleToMatcher(rule));
        }
        return matcher;
    }

    private static ElementMatcher.Junction<TypeDescription> ruleToMatcher(
            final HamsterMethodsConfig.WildcardRule rule) {

        if (rule.classLevel) {
            // ClassName[*] → 정확한 FQCN 매칭
            return ElementMatchers.named(rule.pattern);
        }

        if (rule.recursive) {
            // com.bank.** → 패키지 접두사로 시작하는 모든 클래스
            return ElementMatchers.nameStartsWith(rule.pattern);
        }

        // com.bank.service.* → 직계 자식 클래스만 (하위 패키지 제외)
        // rule.pattern = "com.bank.service." (끝에 점 포함)
        return new ElementMatcher.Junction.AbstractBase<TypeDescription>() {
            @Override
            public boolean matches(TypeDescription target) {
                String name = target.getName();
                if (!name.startsWith(rule.pattern)) return false;
                // 접두사 이후에 점이 없어야 직계 자식
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
