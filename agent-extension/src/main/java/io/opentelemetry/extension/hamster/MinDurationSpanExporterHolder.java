package io.opentelemetry.extension.hamster;

import java.util.concurrent.atomic.AtomicReference;

/**
 * {@link MinDurationSpanExporter} 인스턴스를 정적으로 보관하는 홀더.
 *
 * OTel SDK 초기화 순서상 SpanExporter 는 buildProperties() 이후에 생성되므로,
 * HamsterThreadDumpExtension 이 나중에 참조할 수 있도록 AtomicReference 에 보관한다.
 */
final class MinDurationSpanExporterHolder {

    private static final AtomicReference<MinDurationSpanExporter> ref = new AtomicReference<>();

    private MinDurationSpanExporterHolder() {}

    static void set(MinDurationSpanExporter exporter) {
        ref.set(exporter);
    }

    /** 아직 초기화되지 않았으면 null 반환. */
    static MinDurationSpanExporter get() {
        return ref.get();
    }
}
