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

        if (rule.extendsClass) {
            // extends:SuperClass[methods] → SuperClass 를 상속·구현한 모든 하위 클래스
            // 슈퍼클래스 자신은 제외 (비즈니스 로직이 없는 추상 클래스를 후킹하지 않기 위해)
            return ElementMatchers.hasSuperType(ElementMatchers.named(rule.pattern))
                    .and(ElementMatchers.not(ElementMatchers.named(rule.pattern)));
        }

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
                TypeDescription declaringType = target.getDeclaringType().asErasure();
                String className  = declaringType.getName();
                String methodName = target.getName();

                for (HamsterMethodsConfig.WildcardRule rule : HamsterMethodsConfig.get().wildcardRules) {
                    boolean classMatched;
                    if (rule.extendsClass) {
                        // extends 규칙: 타입 계층에서 슈퍼타입 여부 확인
                        classMatched = typeExtendsPattern(rule.pattern, declaringType);
                    } else {
                        classMatched = classMatchesRule(rule, className);
                    }
                    if (!classMatched) continue;

                    // 규칙이 이 클래스에 해당함
                    if (rule.methods == null) {
                        return true; // 모든 메서드 대상
                    }
                    if (rule.methods.contains(methodName)) {
                        return true; // 지정 메서드 목록에 포함
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

    /**
     * ByteBuddy TypeDescription 을 통해 타입 계층을 탐색하여
     * 해당 클래스가 superPattern 을 상속·구현하는지 확인한다.
     * Class.forName() 없이 bytecode descriptor 레벨에서 동작한다.
     */
    private static boolean typeExtendsPattern(String superPattern, TypeDescription type) {
        // 슈퍼클래스 체인 탐색
        net.bytebuddy.description.type.TypeDescription.Generic superClass = type.getSuperClass();
        while (superClass != null) {
            String superName = superClass.asErasure().getName();
            if ("java.lang.Object".equals(superName)) break;
            if (superPattern.equals(superName)) return true;
            // 각 슈퍼클래스가 구현한 인터페이스 확인
            for (net.bytebuddy.description.type.TypeDescription.Generic iface
                    : superClass.asErasure().getInterfaces()) {
                if (superPattern.equals(iface.asErasure().getName())) return true;
            }
            superClass = superClass.asErasure().getSuperClass();
        }
        // 현재 클래스가 직접 구현한 인터페이스 확인
        for (net.bytebuddy.description.type.TypeDescription.Generic iface : type.getInterfaces()) {
            if (superPattern.equals(iface.asErasure().getName())) return true;
        }
        return false;
    }
}
