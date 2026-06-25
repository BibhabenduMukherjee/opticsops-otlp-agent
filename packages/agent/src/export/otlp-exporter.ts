import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { ResolvedConfig } from '../types.js';
import { TailSamplingSpanProcessor } from './tail-sampler.js';

/**
 * Builds the span processor chain for the agent.
 *
 * Pipeline: spans → TailSamplingSpanProcessor → (optional log) → OTLPTraceExporter
 *
 * Only anomalous traces reach the exporter. Healthy traffic is aggregated
 * by HeartbeatAggregator instead.
 */
export function createSpanProcessors(config: ResolvedConfig): SpanProcessor[] {
  const otlpExporter = new OTLPTraceExporter({
    url: config.otlpEndpoint,
  });

  const exporter: SpanExporter = config.enableConsoleLogging
    ? new LoggingSpanExporter(otlpExporter)
    : otlpExporter;

  return [new TailSamplingSpanProcessor(exporter, config)];
}

/**
 * Delegating exporter that prints human-readable linked trace summaries
 * before forwarding to OTLP — satisfies the Step 1 success metric.
 */
class LoggingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(
    spans: Parameters<SpanExporter['export']>[0],
    resultCallback: Parameters<SpanExporter['export']>[1],
  ): void {
    this.logTraceChain(spans);
    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown?.() ?? Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  private logTraceChain(spans: Parameters<SpanExporter['export']>[0]): void {
    if (spans.length === 0) return;

    const traceId = spans[0].spanContext().traceId;
    const lines = spans.map((s) => {
      const kind = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'][s.kind] ?? 'UNKNOWN';
      const status = s.attributes['http.status_code'] ?? s.status.code;
      return `  └─ [${kind}] ${s.name} (span=${s.spanContext().spanId.slice(0, 8)}… status=${status})`;
    });

    console.log(
      `\n[opticsops] 🔗 Trace ${traceId.slice(0, 16)}… (${spans.length} spans)\n${lines.join('\n')}\n`,
    );
  }
}

/** @internal Factory for tests that need a custom exporter. */
export function createTailSamplingProcessor(
  exporter: SpanExporter,
  config: ResolvedConfig,
): TailSamplingSpanProcessor {
  return new TailSamplingSpanProcessor(exporter, config);
}