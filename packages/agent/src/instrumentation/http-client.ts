import { createRequire } from 'node:module';
import { context, trace, type Span } from '@opentelemetry/api';
import type { ResolvedConfig } from '../types.js';
import { runInContext } from '../context/trace-context.js';
import {
  injectContextIntoHeaders,
  startClientSpan,
} from '../propagation/w3c.js';
import type { HeartbeatAggregator } from '../metrics/heartbeat.js';

/**
 * Use the CJS module instance so monkey-patching works.
 * ESM namespace imports (import * as http) expose read-only bindings.
 */
const require = createRequire(import.meta.url);
const http = require('node:http') as typeof import('node:http');
const https = require('node:https') as typeof import('node:https');

type RequestArgs = Parameters<typeof http.request>;
type RequestReturn = ReturnType<typeof http.request>;

/** Symbols used to avoid double-patching if init() is called more than once. */
const PATCHED = Symbol.for('opticsops.http.client.patched');

interface PatchState {
  config: ResolvedConfig;
  heartbeat: HeartbeatAggregator;
}

let originalHttpRequest: typeof http.request | undefined;
let originalHttpsRequest: typeof https.request | undefined;

/**
 * Monkey-patches `http.request` / `https.request` to:
 * 1. Start a CLIENT span for every outbound call
 * 2. Inject the W3C traceparent header
 * 3. Record latency and HTTP status on span end
 * 4. Feed successful fast calls into the heartbeat aggregator
 */
export function patchHttpClient(state: PatchState): void {
  if ((http.request as unknown as Record<symbol, boolean>)[PATCHED]) return;

  originalHttpRequest = http.request.bind(http);
  originalHttpsRequest = https.request.bind(https);

  const wrapRequest =
    (original: typeof http.request, protocol: 'http:' | 'https:') =>
    (...args: RequestArgs): RequestReturn => {
      const parsed = parseRequestArgs(args, protocol);
      const parentContext = context.active();
      const span = startClientSpan(parsed.method, parsed.url);
      const spanContext = trace.setSpan(parentContext, span);

      // Inject traceparent into outgoing headers before the socket is opened.
      const headers = parsed.headers ?? {};
      runInContext(spanContext, () => injectContextIntoHeaders(headers));
      parsed.headers = headers;

      const req = original(...rebuildArgs(args, parsed)) as import('node:http').ClientRequest;

      attachResponseListeners(req, span, parsed.url, state);
      return req;
    };

  http.request = wrapRequest(originalHttpRequest, 'http:') as typeof http.request;
  https.request = wrapRequest(originalHttpsRequest, 'https:') as typeof https.request;

  (http.request as unknown as Record<symbol, boolean>)[PATCHED] = true;
}

// --- request arg parsing (http.request has multiple overloads) ---

interface ParsedRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
}

function parseRequestArgs(args: RequestArgs, defaultProtocol: 'http:' | 'https:'): ParsedRequest {
  const [first, second] = args;

  // http.request(url[, options][, callback])
  if (typeof first === 'string' || first instanceof URL) {
    const urlStr = String(first);
    const options = (typeof second === 'object' && second !== null && !('call' in second))
      ? (second as import('node:http').RequestOptions)
      : {};
    const method = options.method ?? 'GET';
    const headers = options.headers as ParsedRequest['headers'];
    return { method, url: normalizeUrl(urlStr, defaultProtocol), headers };
  }

  // http.request(options[, callback])
  const options = first as import('node:http').RequestOptions;
  const method = options.method ?? 'GET';
  const host = options.hostname ?? options.host ?? 'localhost';
  const port = options.port ? `:${options.port}` : '';
  const path = options.path ?? '/';
  const protocol = options.protocol ?? defaultProtocol;
  const headers = options.headers as ParsedRequest['headers'];
  return {
    method,
    url: `${protocol}//${host}${port}${path}`,
    headers,
  };
}

function rebuildArgs(args: RequestArgs, parsed: ParsedRequest): RequestArgs {
  const [first, second, third] = args;

  if (typeof first === 'string' || first instanceof URL) {
    if (typeof second === 'object' && second !== null && !('call' in second)) {
      return [first, { ...second, headers: parsed.headers }, third] as RequestArgs;
    }
    return args;
  }

  const options = first as import('node:http').RequestOptions;
  return [{ ...options, headers: parsed.headers }, second] as unknown as RequestArgs;
}

function normalizeUrl(url: string, protocol: 'http:' | 'https:'): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${protocol}//${url.replace(/^\/\//, '')}`;
}

// --- response handling ---

function attachResponseListeners(
  req: import('node:http').ClientRequest,
  span: Span,
  destinationUrl: string,
  state: PatchState,
): void {
  const start = performance.now();

  req.on('response', (res) => {
    const durationMs = performance.now() - start;
    const status = res.statusCode ?? 0;

    span.setAttribute('http.status_code', status);
    span.setAttribute('http.response.duration_ms', durationMs);

    const isError = status >= 400;
    const isSlow = durationMs > state.config.latencyThresholdMs;

    if (isError) {
      span.setStatus({ code: 2, message: `HTTP ${status}` });
    } else if (isSlow) {
      span.setStatus({ code: 2, message: `Slow request: ${durationMs.toFixed(0)}ms` });
    } else {
      span.setStatus({ code: 1 });
      // Healthy traffic → aggregate instead of exporting full trace (tail sampling).
      state.heartbeat.record(state.config.serviceName, destinationUrl);
    }

    span.end();
  });

  req.on('error', (err) => {
    span.recordException(err);
    span.setStatus({ code: 2, message: err.message });
    span.end();
  });
}

/** @internal Restore originals and clear patch markers — test helper only. */
export function __resetHttpClientPatchForTests(): void {
  if (originalHttpRequest) {
    http.request = originalHttpRequest;
  }
  if (originalHttpsRequest) {
    https.request = originalHttpsRequest;
  }
  delete (http.request as unknown as Record<symbol, boolean>)[PATCHED];
  originalHttpRequest = undefined;
  originalHttpsRequest = undefined;
}