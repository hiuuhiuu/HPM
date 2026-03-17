package io.opentelemetry.extension.hamster;

import io.opentelemetry.sdk.common.CompletableResultCode;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SpanExporter;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 설정된 최소 duration 미만 스팬을 수집 서버 전송 전에 제거하는 SpanExporter 래퍼.
 *
 * <p>임계값은 {@link #setMinDurationMs(long)}으로 런타임에 동적 변경 가능합니다.
 * 대시보드에서 설정 변경 시 에이전트가 폴링 주기(60초)마다 자동 반영합니다.</p>
 *
 * <p>초기값은 hamster-methods.conf 의 {@code min_span_duration_ms} 항목에서 읽습니다.
 * 파일이 없거나 항목이 없으면 0(비활성)으로 동작합니다.</p>
 */
public class MinDurationSpanExporter implements SpanExporter {

    private final SpanExporter delegate;
    /** 나노초 단위. 0이면 필터링 비활성. */
    private final AtomicLong minDurationNanos = new AtomicLong(0);

    public MinDurationSpanExporter(SpanExporter delegate) {
        this.delegate = delegate;
    }

    /** 임계값을 밀리초 단위로 설정합니다. 0 이하면 필터링을 비활성화합니다. */
    public void setMinDurationMs(long ms) {
        minDurationNanos.set(ms > 0 ? ms * 1_000_000L : 0);
    }

    /** 현재 임계값을 밀리초 단위로 반환합니다. */
    public long getMinDurationMs() {
        long nanos = minDurationNanos.get();
        return nanos > 0 ? nanos / 1_000_000L : 0;
    }

    @Override
    public CompletableResultCode export(Collection<SpanData> spans) {
        long threshold = minDurationNanos.get();
        if (threshold <= 0) {
            return delegate.export(spans);
        }
        List<SpanData> filtered = new ArrayList<>();
        for (SpanData span : spans) {
            if (span.getEndEpochNanos() - span.getStartEpochNanos() >= threshold) {
                filtered.add(span);
            }
        }
        if (filtered.isEmpty()) {
            return CompletableResultCode.ofSuccess();
        }
        return delegate.export(filtered);
    }

    @Override
    public CompletableResultCode flush() {
        return delegate.flush();
    }

    @Override
    public CompletableResultCode shutdown() {
        return delegate.shutdown();
    }
}
