package io.opentelemetry.extension.hamster;

import io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule;
import io.opentelemetry.javaagent.extension.instrumentation.TypeInstrumentation;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Hamster 와일드카드 메서드 후킹 모듈.
 *
 * hamster-methods.conf 에 정의된 와일드카드 규칙을 ByteBuddy 로 적용한다.
 *   - ClassName[*]       → 특정 클래스의 모든 메서드
 *   - com.bank.service.* → 패키지 직계 클래스 전체
 *   - com.bank.**        → 패키지 및 하위 패키지 전체
 *
 * 정확한 메서드 지정(ClassName[method1,method2])은 HamsterExtensionCustomizer 가 처리한다.
 */
public class HamsterInstrumentationModule extends InstrumentationModule {

    public HamsterInstrumentationModule() {
        super("hamster-wildcard", "hamster-wildcard");
    }

    @Override
    public List<TypeInstrumentation> typeInstrumentations() {
        if (HamsterMethodsConfig.get().wildcardRules.isEmpty()) {
            return Collections.emptyList();
        }
        return Collections.<TypeInstrumentation>singletonList(new HamsterPackageInstrumentation());
    }

    /**
     * MethodTracingAdvice 와 HamsterMethodsConfig 는 계측 대상 클래스의
     * ClassLoader 에 주입되어야 한다.
     */
    @Override
    public List<String> getAdditionalHelperClassNames() {
        return Arrays.asList(
                "io.opentelemetry.extension.hamster.HamsterMethodsConfig",
                "io.opentelemetry.extension.hamster.HamsterMethodsConfig$WildcardRule",
                "io.opentelemetry.extension.hamster.HamsterMethodsConfig$ParsedConfig",
                "io.opentelemetry.extension.hamster.MethodTracingAdvice"
        );
    }
}
