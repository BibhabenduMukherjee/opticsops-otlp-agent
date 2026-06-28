import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { OpticsOpsConfig, ResolvedConfig } from './types.js';
import { resolveConfig } from './config.js';
import { ensureW3CPropagator } from './propagation/w3c.js';
import { createSpanProcessors } from './export/otlp-exporter.js';
import { patchHttpClient, __resetHttpClientPatchForTests } from './instrumentation/http-client.js';
import { patchHttpServer, __resetHttpServerPatchForTests } from './instrumentation/http-server.js';
import { HeartbeatAggregator } from './metrics/heartbeat.js';

let initialized = false;
let activeConfig: ResolvedConfig | undefined;
let heartbeat: HeartbeatAggregator | undefined;
let provider: BasicTracerProvider | undefined;

/**
 * Initializes the OpticsOps telemetry agent.
 *
 * Call this once at process startup (or simply `import '@opticsops/agent'` with
 * env vars set). After init:
 *   - All `http` / `https` traffic is automatically traced
 *   - W3C traceparent headers are injected on outbound calls
 *   - Anomalous traces are exported via OTLP; healthy traffic is aggregated
 *
 * @example
 * ```ts
 * import { init } from '@opticsops/agent';
 * init({ serviceName: 'checkout-api' });
 * ```
 */
export function init(config: OpticsOpsConfig): void {
  if (initialized) {
    console.warn('[opticsops] init() called more than once — ignoring duplicate call.');
    return;
  }

  const resolved = resolveConfig(config);
  activeConfig = resolved;

  // 1. Wire up OTel context propagation (AsyncLocalStorage under the hood).
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  // 2. Register W3C traceparent extractor / injector.
  ensureW3CPropagator();

  // 3. Create tracer provider with tail-based sampling pipeline.
  const heartbeatUrl = resolved.otlpEndpoint.replace('/v1/traces', '/v1/heartbeat');
  heartbeat = new HeartbeatAggregator(resolved, (edges) => {
    // Use global fetch (Node 18+) — bypasses our http monkey-patch intentionally.
    fetch(heartbeatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edges }),
    }).catch(() => {}); // best-effort, never blocks the app
  });
  const processors = createSpanProcessors(resolved);

  provider = new BasicTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: resolved.serviceName }),
    spanProcessors: processors,
  });
  provider.register();

  // 4. Monkey-patch Node.js HTTP modules (zero-config instrumentation).
  patchHttpServer(resolved);
  patchHttpClient({ config: resolved, heartbeat });

  // 5. Start periodic heartbeat aggregation for healthy traffic.
  heartbeat.start();

  initialized = true;

  if (resolved.enableConsoleLogging) {
    console.log(
      `[opticsops] Agent started for "${resolved.serviceName}" → ${resolved.otlpEndpoint}`,
    );
  }
}

/** Gracefully shuts down exporters and flushes pending heartbeats. */
export async function shutdown(): Promise<void> {
  heartbeat?.stop();
  await provider?.shutdown();
  initialized = false;
}

/** Returns true if init() has been called successfully. */
export function isInitialized(): boolean {
  return initialized;
}

/** @internal Returns the resolved config — test helper only. */
export function __getConfigForTests(): ResolvedConfig | undefined {
  return activeConfig;
}

/** @internal Full reset for test isolation. */
export async function __resetForTests(): Promise<void> {
  await shutdown();
  __resetHttpClientPatchForTests();
  __resetHttpServerPatchForTests();
  activeConfig = undefined;
  heartbeat = undefined;
  provider = undefined;
}