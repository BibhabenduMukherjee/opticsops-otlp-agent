import { SpanKind } from '@opentelemetry/api';
import {
  type SpanExporter,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { ResolvedConfig } from '../types.js';

/** Wait briefly so sibling spans (e.g. CLIENT then SERVER) land in the same batch. */
const FLUSH_DEBOUNCE_MS = 10;

/** Drop buffered traces that never completed — prevents unbounded memory growth. */
const MAX_BUFFER_AGE_MS = 60_000;

/**
 * Tail-based sampling processor.
 *
 * Instead of deciding at span *start* whether to sample, we buffer all spans
 * for a trace in memory and make the keep/drop decision once the trace is
 * complete. This lets us export full traces only when something went wrong:
 *   - Any span has HTTP status >= 400
 *   - Any span duration exceeds the configured latency threshold
 *
 * Healthy traces are dropped here; their edges are captured by HeartbeatAggregator.
 *
 * Flush strategy (leak-safe):
 *   1. Debounced flush per traceId — collects gateway SERVER + CLIENT pairs
 *   2. SERVER span always schedules flush — covers downstream services with
 *      a remote parent (service-b receiving traceparent from service-a)
 *   3. TTL eviction — stale incomplete traces are removed after 60s
 */
export class TailSamplingSpanProcessor implements SpanProcessor {
  /** traceId → buffered spans awaiting flush */
  private readonly buffer = new Map<string, ReadableSpan[]>();
  /** traceId → debounced flush timer */
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** traceId → last activity timestamp (ms) */
  private readonly traceActivity = new Map<string, number>();
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
    const now = Date.now();

    this.evictStaleTraces(now);

    const batch = this.buffer.get(traceId) ?? [];
    batch.push(span);
    this.buffer.set(traceId, batch);
    this.traceActivity.set(traceId, now);

    // Downstream services: SERVER span has a remote parent but is still the
    // service entry point — must flush when it ends (fixes service-b leak).
    // Gateway services: debounce collects CLIENT (child) + SERVER (root) together.
    if (span.kind === SpanKind.SERVER || span.parentSpanId === undefined) {
      this.scheduleFlush(traceId);
    }
  }

  async forceFlush(): Promise<void> {
    this.cancelAllTimers();
    for (const traceId of [...this.buffer.keys()]) {
      this.flushTrace(traceId);
    }
    await this.exporter.forceFlush?.();
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    await this.exporter.shutdown?.();
    this.buffer.clear();
    this.traceActivity.clear();
  }

  /**
   * Debounce flush so spans ending milliseconds apart (CLIENT then SERVER)
   * are evaluated as one batch.
   */
  private scheduleFlush(traceId: string): void {
    const existing = this.flushTimers.get(traceId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.flushTimers.delete(traceId);
      this.flushTrace(traceId);
    }, FLUSH_DEBOUNCE_MS);

    // Do not keep the Node process alive solely for flush timers.
    timer.unref?.();
    this.flushTimers.set(traceId, timer);
  }

  private flushTrace(traceId: string): void {
    const spans = this.buffer.get(traceId);
    if (!spans || spans.length === 0) return;

    if (this.shouldExport(spans)) {
      this.exporter.export(spans, () => undefined);
    }

    this.buffer.delete(traceId);
    this.traceActivity.delete(traceId);
    this.flushTimers.delete(traceId);
  }

  /** Remove traces that never received a flush trigger (safety net). */
  private evictStaleTraces(now: number): void {
    for (const [traceId, lastSeen] of this.traceActivity) {
      if (now - lastSeen > MAX_BUFFER_AGE_MS) {
        const timer = this.flushTimers.get(traceId);
        if (timer) clearTimeout(timer);
        this.flushTimers.delete(traceId);
        this.buffer.delete(traceId);
        this.traceActivity.delete(traceId);
      }
    }
  }

  private cancelAllTimers(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
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