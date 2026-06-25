import {
  type SpanExporter,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { ResolvedConfig } from '../types.js';

/**
 * Tail-based sampling processor.
 *
 * Instead of deciding at span *start* whether to sample, we buffer all spans
 * for a trace in memory and make the keep/drop decision once the root span
 * completes. This lets us export full traces only when something went wrong:
 *   - Any span has HTTP status >= 400
 *   - Any span duration exceeds the configured latency threshold
 *
 * Healthy traces are dropped here; their edges are captured by HeartbeatAggregator.
 */
export class TailSamplingSpanProcessor implements SpanProcessor {
  /** traceId → buffered spans awaiting the root to finish */
  private readonly buffer = new Map<string, ReadableSpan[]>();
  private readonly latencyThresholdMs: number;

  constructor(
    private readonly exporter: SpanExporter,
    config: ResolvedConfig,
  ) {
    this.latencyThresholdMs = config.latencyThresholdMs;
  }


  onStart(): void {
    // Tail sampling only acts on ended spans.
  }

  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId;
    const batch = this.buffer.get(traceId) ?? [];
    batch.push(span);
    this.buffer.set(traceId, batch);

    // Flush when the local root span ends (no parent = entry point of this service).
    // This correctly handles gateway services that both receive AND make HTTP calls.
    if (this.isLocalRoot(span)) {
      this.flushTrace(traceId);
    }
  }

  async forceFlush(): Promise<void> {
    for (const traceId of this.buffer.keys()) {
      this.flushTrace(traceId);
    }
    await this.exporter.forceFlush?.();
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    await this.exporter.shutdown?.();
    this.buffer.clear();
  }

  /** Local root = span with no parent ID (the entry point of this process). */
  private isLocalRoot(span: ReadableSpan): boolean {
    return span.parentSpanId === undefined;
  }

  private flushTrace(traceId: string): void {
    const spans = this.buffer.get(traceId);
    if (!spans || spans.length === 0) return;

    if (this.shouldExport(spans)) {
      this.exporter.export(spans, () => undefined);
    }

    this.buffer.delete(traceId);
  }

  private shouldExport(spans: ReadableSpan[]): boolean {
    return spans.some((span) => {
      const statusCode = span.attributes['http.status_code'];
      if (typeof statusCode === 'number' && statusCode >= 400) return true;

      const durationMs = this.spanDurationMs(span);
      if (durationMs > this.latencyThresholdMs) return true;

      // OTel span status ERROR (code 2).
      if (span.status.code === 2) return true;

      return false;
    });
  }

  private spanDurationMs(span: ReadableSpan): number {
    const start = span.startTime;
    const end = span.endTime;
    const startMs = start[0] * 1000 + start[1] / 1e6;
    const endMs = end[0] * 1000 + end[1] / 1e6;
    return endMs - startMs;
  }
}