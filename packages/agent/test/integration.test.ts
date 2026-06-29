import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import type * as Http from 'node:http';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { patchHttpClient, __resetHttpClientPatchForTests } from '../src/instrumentation/http-client.js';
import { patchHttpServer, __resetHttpServerPatchForTests } from '../src/instrumentation/http-server.js';
import { HeartbeatAggregator } from '../src/metrics/heartbeat.js';
import { ensureW3CPropagator } from '../src/propagation/w3c.js';
import { createTailSamplingProcessor } from '../src/export/otlp-exporter.js';
import { getActiveTraceStore } from '../src/context/trace-context.js';
import { InMemorySpanExporter } from './helpers/in-memory-exporter.js';

/**
 * Use CJS require so we load `node:http` AFTER the agent patches the module.
 * A top-level `import http from 'node:http'` would bind to unpatched exports.
 */
const require = createRequire(import.meta.url);

/**
 * Integration test for the Step 1 success metric:
 * two Node.js HTTP services exchange a request and produce a linked trace chain
 * without any manual tracing code.
 */
describe('cross-service trace propagation (integration)', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let serviceB: Http.Server;
  let serviceA: Http.Server;
  let bPort: number;
  let aPort: number;
  let receivedTraceparent: string | undefined;

  const testConfig = {
    serviceName: 'service-a',
    otlpEndpoint: 'http://localhost:4318/v1/traces',
    latencyThresholdMs: 500,
    heartbeatIntervalMs: 60_000,
    enableConsoleLogging: false,
    apiKey: '',
  };

  beforeEach(async () => {
    exporter = new InMemorySpanExporter();
    receivedTraceparent = undefined;

    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    ensureW3CPropagator();

    provider = new BasicTracerProvider({
      resource: new Resource({ [ATTR_SERVICE_NAME]: testConfig.serviceName }),
      spanProcessors: [createTailSamplingProcessor(exporter, testConfig)],
    });
    provider.register();

    // Patch the CJS http module, then load http — order matters for ESM tests.
    patchHttpServer(testConfig);
    patchHttpClient({ config: testConfig, heartbeat: new HeartbeatAggregator(testConfig) });
    const http = require('node:http') as typeof Http;

    serviceB = http.createServer((_req, res) => {
      receivedTraceparent = getActiveTraceStore()?.traceparent;
      res.writeHead(500);
      res.end('error');
    });
    await listen(http, serviceB, 0);
    bPort = (serviceB.address() as { port: number }).port;

    serviceA = http.createServer((_req, res) => {
      const reqToB = http.request(
        { hostname: '127.0.0.1', port: bPort, path: '/api', method: 'GET' },
        (bRes) => {
          bRes.resume();
          bRes.on('end', () => {
            res.writeHead(502);
            res.end('upstream error');
          });
        },
      );
      reqToB.end();
    });
    await listen(http, serviceA, 0);
    aPort = (serviceA.address() as { port: number }).port;
  });

  afterEach(async () => {
    await Promise.all([
      serviceA ? closeServer(serviceA) : Promise.resolve(),
      serviceB ? closeServer(serviceB) : Promise.resolve(),
      provider?.shutdown() ?? Promise.resolve(),
    ]);
    __resetHttpClientPatchForTests();
    __resetHttpServerPatchForTests();
  });

  it('links parent-child spans across two services via traceparent', async () => {
    await fetch(`http://127.0.0.1:${aPort}/trigger`);
    await provider.forceFlush();

    expect(receivedTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);

    const traceIds = exporter.getTraceIds();
    expect(traceIds).toHaveLength(1);

    const spans = exporter.finishedSpans;
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans.every((s) => s.spanContext().traceId === traceIds[0])).toBe(true);

    const hasServer = spans.some((s) => s.kind === 1);
    const hasClient = spans.some((s) => s.kind === 2);
    expect(hasServer).toBe(true);
    expect(hasClient).toBe(true);
  });
});

function listen(
  http: typeof Http,
  server: Http.Server,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
}

function closeServer(server: Http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}