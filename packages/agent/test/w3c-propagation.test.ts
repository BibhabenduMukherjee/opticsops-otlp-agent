import { describe, it, expect, beforeEach } from 'vitest';
import { context, trace, SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { InMemorySpanExporter } from './helpers/in-memory-exporter.js';
import {
  ensureW3CPropagator,
  extractContextFromHeaders,
  injectContextIntoHeaders,
  __resetPropagatorForTests,
} from '../src/propagation/w3c.js';

describe('W3C propagation', () => {
  beforeEach(() => {
    __resetPropagatorForTests();

    // Context manager is required for context.with() / propagation.inject() to work.
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);

    ensureW3CPropagator();

    // A span processor is required for real (recording) spans with valid trace IDs.
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });
    provider.register();
  });

  it('injects traceparent into outgoing headers', () => {
    const tracer = trace.getTracer('test');
    const headers: Record<string, string> = {};

    const span = tracer.startSpan('outbound', { kind: SpanKind.CLIENT });
    const ctx = trace.setSpan(context.active(), span);

    context.with(ctx, () => injectContextIntoHeaders(headers));

    const traceparent =
      headers.traceparent ??
      headers['traceparent'] ??
      Object.entries(headers).find(([k]) => k.toLowerCase() === 'traceparent')?.[1];

    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    span.end();
  });

  it('extracts traceparent and continues the same trace ID', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parentSpanId = '00f067aa0ba902b7';
    const headers = {
      traceparent: `00-${traceId}-${parentSpanId}-01`,
    };

    const extracted = extractContextFromHeaders(headers);
    const span = trace.getSpan(extracted);
    expect(span?.spanContext().traceId).toBe(traceId);
    expect(span?.spanContext().spanId).toBe(parentSpanId);
  });
});