import * as http from 'node:http';
import * as https from 'node:https';
import { trace } from '@opentelemetry/api';
import type { ResolvedConfig } from '../types.js';
import { runInContext } from '../context/trace-context.js';
import {
  extractContextFromHeaders,
  startServerSpan,
} from '../propagation/w3c.js';

const PATCHED = Symbol.for('opticsops.http.server.patched');

type EmitFn = typeof http.Server.prototype.emit;

interface Emittable {
  emit: EmitFn;
}

/** Saved originals so tests can restore after patching. */
const originals = new Map<Emittable, EmitFn>();

/**
 * Monkey-patches `http.Server` / `https.Server` emit to intercept the
 * `'request'` event. This avoids replacing `http.createServer`, which Node
 * marks as non-configurable in recent versions.
 *
 * Every inbound request automatically:
 * 1. Extracts the W3C traceparent from headers (continuing upstream traces)
 * 2. Starts a SERVER span bound to the extracted context
 * 3. Runs the user's handler inside that context via AsyncLocalStorage
 */
export function patchHttpServer(config: ResolvedConfig): void {
  patchServerEmit(http.Server, config);
  patchServerEmit(https.Server, config);
}

function patchServerEmit(
  ServerClass: typeof http.Server,
  config: ResolvedConfig,
): void {
  const proto = ServerClass.prototype as Emittable;
  if ((proto.emit as unknown as Record<symbol, boolean>)[PATCHED]) return;

  // Do NOT .bind(proto) — emit must receive the Server instance as `this`.
  const originalEmit = proto.emit;
  originals.set(proto, proto.emit);

  proto.emit = function patchedEmit(
    this: http.Server,
    event: string,
    ...args: unknown[]
  ): boolean {
    if (event === 'request' && args.length >= 2) {
      return handleRequest(
        args[0] as http.IncomingMessage,
        args[1] as http.ServerResponse,
        config,
        () => (originalEmit as (...a: unknown[]) => boolean).call(this, event, ...args),
      );
    }
    return (originalEmit as (...a: unknown[]) => boolean).call(this, event, ...args);
  } as EmitFn;

  (proto.emit as unknown as Record<symbol, boolean>)[PATCHED] = true;
}

function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ResolvedConfig,
  next: () => boolean,
): boolean {
  const method = req.method ?? 'GET';
  const url = `${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const parentContext = extractContextFromHeaders(
    req.headers as Record<string, string | string[] | undefined>,
  );

  const span = startServerSpan(method, url, parentContext);
  const spanContext = trace.setSpan(parentContext, span);
  span.setAttribute('service.name', config.serviceName);

  const start = performance.now();
  let finalized = false;

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    const durationMs = performance.now() - start;
    const status = res.statusCode ?? 0;

    span.setAttribute('http.status_code', status);
    span.setAttribute('http.response.duration_ms', durationMs);

    if (status >= 400) {
      span.setStatus({ code: 2, message: `HTTP ${status}` });
    } else if (durationMs > config.latencyThresholdMs) {
      span.setStatus({ code: 2, message: `Slow request: ${durationMs.toFixed(0)}ms` });
    } else {
      span.setStatus({ code: 1 });
    }

    span.end();
  };

  res.on('finish', finalize);
  res.on('close', () => {
    if (!res.writableFinished) finalize();
  });

  return runInContext(spanContext, next);
}

/** @internal Restore original emit and clear patch markers — test helper only. */
export function __resetHttpServerPatchForTests(): void {
  for (const [proto, originalEmit] of originals) {
    proto.emit = originalEmit;
    delete (proto.emit as unknown as Record<symbol, boolean>)[PATCHED];
  }
  originals.clear();
}