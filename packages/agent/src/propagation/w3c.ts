import {
  propagation,
  context,
  trace,
  SpanKind,
  type Context,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/** Carrier type for Node.js IncomingHttpHeaders or OutgoingHttpHeaders. */
export type HeaderCarrier = Record<string, string | string[] | undefined>;

/**
 * Ensures the global W3C Trace Context propagator is registered exactly once.
 * This is what powers traceparent / tracestate injection and extraction.
 */
let propagatorRegistered = false;

export function ensureW3CPropagator(): void {
  if (propagatorRegistered) return;
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  propagatorRegistered = true;
}

/**
 * Extracts an OTel context from incoming HTTP headers (server-side).
 * Returns the extracted context, or the active context if no traceparent is present.
 */
export function extractContextFromHeaders(headers: HeaderCarrier): Context {
  return propagation.extract(context.active(), headers, headerGetter);
}

/**
 * Injects the active trace context into outgoing HTTP headers (client-side).
 * Mutates `headers` in place — callers should pass a plain object.
 */
export function injectContextIntoHeaders(headers: HeaderCarrier): void {
  propagation.inject(context.active(), headers, headerSetter);
}

/**
 * Creates a CLIENT span for an outbound HTTP call, parented to the active context.
 */
export function startClientSpan(method: string, url: string) {
  const tracer = trace.getTracer('opticsops-agent');
  return tracer.startSpan(`HTTP ${method}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'http.method': method,
      'http.url': url,
    },
  });
}

/**
 * Creates a SERVER span for an inbound HTTP request.
 */
export function startServerSpan(
  method: string,
  url: string,
  parentContext: Context,
) {
  const tracer = trace.getTracer('opticsops-agent');
  return context.with(parentContext, () =>
    tracer.startSpan(`HTTP ${method}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': method,
        'http.url': url,
      },
    }),
  );
}

// --- propagation helpers (W3C header getter/setter) ---

const headerGetter = {
  get(carrier: HeaderCarrier, key: string): string | string[] | undefined {
    // Node lowercases incoming header keys; check both casings for robustness.
    return carrier[key] ?? carrier[key.toLowerCase()];
  },
  keys(carrier: HeaderCarrier): string[] {
    return Object.keys(carrier);
  },
};

const headerSetter = {
  set(carrier: HeaderCarrier, key: string, value: string): void {
    carrier[key] = value;
  },
};

/** @internal Reset for tests only. */
export function __resetPropagatorForTests(): void {
  propagatorRegistered = false;
}