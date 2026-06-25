import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Test double that captures exported spans in memory.
 * Used to assert tail-sampling decisions and trace linkage.
 */
export class InMemorySpanExporter implements SpanExporter {
  readonly finishedSpans: ReadableSpan[] = [];

  export(spans: ReadableSpan[], resultCallback: (result: { code: number }) => void): void {
    this.finishedSpans.push(...spans);
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  reset(): void {
    this.finishedSpans.length = 0;
  }

  getSpanIds(): string[] {
    return this.finishedSpans.map((s) => s.spanContext().spanId);
  }

  getTraceIds(): string[] {
    return [...new Set(this.finishedSpans.map((s) => s.spanContext().traceId))];
  }
}