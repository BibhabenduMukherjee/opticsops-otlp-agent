import { AsyncLocalStorage } from 'node:async_hooks';
import { context, trace, type Context, type Span } from '@opentelemetry/api';

/**
 * Lightweight trace metadata stored in AsyncLocalStorage.
 *
 * OpenTelemetry's Context API also uses AsyncLocalStorage internally, but we
 * keep a parallel store so tests and diagnostics can read the active trace ID
 * without reaching into OTel internals.
 */
export interface TraceStore {
  traceId: string;
  spanId: string;
  /** W3C traceparent header value, e.g. "00-abc...-def...-01" */
  traceparent: string;
}

/** Process-wide ALS bucket for the active trace metadata. */
export const traceStore = new AsyncLocalStorage<TraceStore>();

/**
 * Runs `fn` inside a new AsyncLocalStorage scope bound to the given store.
 * Used by HTTP server instrumentation to keep context across async continuations.
 */
export function runWithTraceStore<T>(store: TraceStore, fn: () => T): T {
  return traceStore.run(store, fn);
}

/**
 * Returns the active trace metadata, or undefined outside a traced request.
 */
export function getActiveTraceStore(): TraceStore | undefined {
  return traceStore.getStore();
}

/**
 * Builds a W3C traceparent string from raw hex IDs.
 * @see https://www.w3.org/TR/trace-context/#traceparent-header
 */
export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Derives TraceStore from the currently active OTel span, if any.
 */
export function traceStoreFromActiveSpan(): TraceStore | undefined {
  const span: Span | undefined = trace.getActiveSpan();
  if (!span) return undefined;

  const { traceId, spanId } = span.spanContext();
  return {
    traceId,
    spanId,
    traceparent: formatTraceparent(traceId, spanId),
  };
}

/**
 * Convenience: run `fn` inside the given OTel context AND mirror trace IDs
 * into our AsyncLocalStorage bucket.
 */
export function runInContext<T>(otelContext: Context, fn: () => T): T {
  return context.with(otelContext, () => {
    const store = traceStoreFromActiveSpan();
    if (store) {
      return runWithTraceStore(store, fn);
    }
    return fn();
  });
}