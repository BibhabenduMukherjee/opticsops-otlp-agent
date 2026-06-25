import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpanKind } from '@opentelemetry/api';
import type { ReadableSpan, HrTime } from '@opentelemetry/sdk-trace-base';
import { createTailSamplingProcessor } from '../src/export/otlp-exporter.js';
import { InMemorySpanExporter } from './helpers/in-memory-exporter.js';
import type { ResolvedConfig } from '../src/types.js';

const config: ResolvedConfig = {
  serviceName: 'test-service',
  otlpEndpoint: 'http://localhost:4318/v1/traces',
  latencyThresholdMs: 500,
  heartbeatIntervalMs: 10_000,
  enableConsoleLogging: false,
};

describe('TailSamplingSpanProcessor', () => {
  let exporter: InMemorySpanExporter;
  let processor: ReturnType<typeof createTailSamplingProcessor>;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    processor = createTailSamplingProcessor(exporter, config);
  });

  afterEach(async () => {
    await processor.shutdown();
  });

  it('drops healthy fast traces', () => {
    const root = makeSpan({ kind: SpanKind.SERVER, statusCode: 200, durationMs: 50 });
    processor.onEnd(root);
    expect(exporter.finishedSpans).toHaveLength(0);
  });

  it('exports traces containing a 5xx response', () => {
    const root = makeSpan({ kind: SpanKind.SERVER, statusCode: 500, durationMs: 30 });
    processor.onEnd(root);
    expect(exporter.finishedSpans).toHaveLength(1);
    expect(exporter.finishedSpans[0].attributes['http.status_code']).toBe(500);
  });

  it('exports traces exceeding the latency threshold', () => {
    const root = makeSpan({ kind: SpanKind.SERVER, statusCode: 200, durationMs: 750 });
    processor.onEnd(root);
    expect(exporter.finishedSpans).toHaveLength(1);
  });

  it('exports the full trace batch (root + child) on anomaly', () => {
    const traceId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const root = makeSpan({ kind: SpanKind.SERVER, statusCode: 200, durationMs: 10, traceId, spanId: 'rootspanid00001' });
    const child = makeSpan({
      kind: SpanKind.CLIENT,
      statusCode: 503,
      durationMs: 20,
      traceId,
      spanId: 'childspanid000001',
      parentSpanId: 'rootspanid00001',
    });

    processor.onEnd(child);
    processor.onEnd(root);

    expect(exporter.finishedSpans).toHaveLength(2);
    expect(exporter.getTraceIds()).toEqual([traceId]);
  });
});

// --- span factory for unit tests ---

function makeSpan(opts: {
  kind: SpanKind;
  statusCode: number;
  durationMs: number;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}): ReadableSpan {
  const start = hrTimeFromMs(0);
  const end = hrTimeFromMs(opts.durationMs);

  return {
    name: 'HTTP GET',
    kind: opts.kind,
    spanContext: () => ({
      traceId: opts.traceId ?? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      spanId: opts.spanId ?? 'cccccccccccccccc',
      traceFlags: 1,
    }),
    parentSpanId: opts.parentSpanId,
    startTime: start,
    endTime: end,
    status: { code: opts.statusCode >= 400 ? 2 : 1 },
    attributes: { 'http.status_code': opts.statusCode },
    links: [],
    events: [],
    duration: [0, opts.durationMs * 1e6] as HrTime,
    ended: true,
    resource: { attributes: {} } as ReadableSpan['resource'],
    instrumentationScope: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as ReadableSpan;
}

function hrTimeFromMs(ms: number): HrTime {
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1e6;
  return [seconds, nanos];
}