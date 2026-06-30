# @opticsops/agent

[![npm version](https://img.shields.io/npm/v/@opticsops/agent.svg)](https://www.npmjs.com/package/@opticsops/agent)
[![license](https://img.shields.io/npm/l/@opticsops/agent.svg)](https://www.npmjs.com/package/@opticsops/agent)

Zero-configuration OpenTelemetry agent for Node.js. Install it, set one env var, and every HTTP request is automatically traced and linked across services via [W3C Trace Context](https://www.w3.org/TR/trace-context/).

**No tracing code. No framework plugins. Works with plain `http` / `https`.**

---

## What it does

OpticsOps sits as a **wrapper around your Node.js process** — not inside your business logic. When Node starts, the agent loads first, patches `http` / `https`, and watches all traffic.

```
User → your-service-a → your-service-b
         ↑                    ↑
    agent watches        agent watches
    (same trace ID passed between them)
```

Healthy requests are counted, not stored. Errors and slow requests export as linked traces — so you see the full chain without drowning in noise.

---

## Quick Start

**Requirements:** Node.js 18+

### Install

```bash
npm install @opticsops/agent
```

### Run — ESM (recommended)

Preload the agent **before** your app loads:

```bash
OTEL_SERVICE_NAME=orders-api node --import @opticsops/agent/register app.js
```

### Run — CommonJS

```bash
OTEL_SERVICE_NAME=orders-api node --require @opticsops/agent/register app.js
```

Or via `NODE_OPTIONS` (Docker / Kubernetes — no start-command change):

```bash
NODE_OPTIONS="--require @opticsops/agent/register" OTEL_SERVICE_NAME=orders-api node app.js
```

### Or in code (must be the first import)

```ts
import { init } from '@opticsops/agent'; // must be first
import http from 'node:http';

init({ serviceName: 'orders-api' });
```

### package.json scripts

```json
{
  "scripts": {
    "start": "OTEL_SERVICE_NAME=orders-api node --import @opticsops/agent/register app.js",
    "dev": "OTEL_SERVICE_NAME=orders-api OPTICSOPS_CONSOLE_LOGGING=true node --import @opticsops/agent/register app.js"
  }
}
```

---

## Example

### Single service

```js
// app.js
import '@opticsops/agent/register';
import http from 'node:http';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(3000, () => console.log('listening on :3000'));
```

```bash
OTEL_SERVICE_NAME=orders-api OPTICSOPS_CONSOLE_LOGGING=true \
  node --import @opticsops/agent/register app.js
```

```bash
curl http://localhost:3000/
```

### Two services (gateway + API)

**service-b.js** — downstream API:

```js
import '@opticsops/agent/register';
import http from 'node:http';

http.createServer((req, res) => {
  if (req.url?.includes('fail')) {
    res.writeHead(500).end(JSON.stringify({ error: 'simulated failure' }));
    return;
  }
  res.writeHead(200).end(JSON.stringify({ service: 'b', ok: true }));
}).listen(4001, () => console.log('[service-b] :4001'));
```

**service-a.js** — gateway that calls B:

```js
import '@opticsops/agent/register';
import { getActiveTraceStore } from '@opticsops/agent';
import http from 'node:http';

http.createServer((req, res) => {
  const traceparent = getActiveTraceStore()?.traceparent;
  console.log(`[service-a] ${req.method} ${req.url} traceparent=${traceparent ?? 'none'}`);

  const path = req.url?.includes('fail') ? '/fail' : '/api';
  const bReq = http.request(
    { hostname: '127.0.0.1', port: 4001, path, method: 'GET' },
    (bRes) => {
      let body = '';
      bRes.on('data', (c) => { body += c; });
      bRes.on('end', () => {
        res.writeHead(bRes.statusCode === 200 ? 200 : 502).end(body);
      });
    },
  );
  bReq.on('error', (err) => res.writeHead(503).end(err.message));
  bReq.end();
}).listen(4000, () => console.log('[service-a] :4000'));
```

**Run in two terminals:**

```bash
OTEL_SERVICE_NAME=service-b OPTICSOPS_CONSOLE_LOGGING=true node --import @opticsops/agent/register service-b.js
```

```bash
OTEL_SERVICE_NAME=service-a OPTICSOPS_CONSOLE_LOGGING=true node --import @opticsops/agent/register service-a.js
```

**Trigger requests:**

```bash
curl http://localhost:4000/api    # healthy — counted in heartbeat
curl http://localhost:4000/fail   # error — full linked trace exported
```

On `/fail`, both services share one trace ID. Read the linked output bottom-to-top: the `CLIENT status=500` on service-a points to service-b as the root cause.

---

## What you see

With `OPTICSOPS_CONSOLE_LOGGING=true`, the agent prints three kinds of output.

### Startup

```
[opticsops] Agent started for "service-a" → http://localhost:4318/v1/traces
```

### Heartbeat (healthy traffic)

```
[opticsops] 💓 Heartbeat (1718976000000): service-a → http://127.0.0.1:4001/api: 3 calls
```

Fast, successful requests are **aggregated** — not exported as full traces.

### Linked trace (errors or slow requests)

```
[opticsops] 🔗 Trace 4f73f40b9f8b99a1… (2 spans)
  └─ [CLIENT] HTTP GET (span=6fb8952e… status=500)
  └─ [SERVER] HTTP GET (span=4adcb254… status=502)
```

| Part | Meaning |
|------|---------|
| `🔗 Trace …` | One shared ID linking all hops |
| `[SERVER]` | This service **received** a request |
| `[CLIENT]` | This service **called** another service |
| `status=500` | Downstream failed — debug here first |
| `status=502` | This service relayed the failure upstream |

---

## Benefits

| Who | What you get |
|-----|--------------|
| **Developers** | Zero instrumentation — traces appear automatically. One trace ID across services. `CLIENT` vs `SERVER` shows where to debug first. |
| **On-call** | Signal over noise — healthy traffic is a count; errors export the full chain. Standard OTLP works with Jaeger, Grafana, Datadog, and more. |
| **Platform teams** | Tail sampling + heartbeats keep storage costs down. No vendor lock-in — W3C `traceparent` + OTLP. Drop-in via `--import` or `NODE_OPTIONS` in Docker, Kubernetes, PM2. |

### Without vs with

**Without OpticsOps:**
```
service-a log: "upstream error"
service-b log: "500 on /api"
```
Same request? Same user? Which service to fix? You guess.

**With OpticsOps:**
```
[opticsops] 🔗 Trace 4f73f40b9f8b99a1… (2 spans)
  └─ [CLIENT] HTTP GET (span=6fb8952e… status=500)   ← fix here (service-b)
  └─ [SERVER] HTTP GET (span=4adcb254… status=502)   ← symptom (service-a)
```
One trace ID. Clear cause → effect. Fix the right service first.

---

## Security & privacy

OpticsOps is designed to observe **traffic metadata**, not your data.

### What is collected

| Collected | Not collected |
|-----------|---------------|
| HTTP method | Request or response **bodies** |
| URL (host + path) | **Authorization** headers, cookies, API keys in headers |
| HTTP status code | Query strings with secrets (avoid putting secrets in URLs) |
| Request duration (ms) | Database queries, business logic, or file contents |
| W3C `traceparent` (for linking) | User PII unless it appears in the URL path |

Spans contain only `http.method`, `http.url`, `http.status_code`, and `http.response.duration_ms`. The agent never reads `req`/`res` bodies or copies arbitrary headers into exports.

### How OpticsOps stays safe in production

- **Tail-based sampling** — healthy requests are dropped after aggregation. Full traces leave your process only on errors or slow requests (configurable threshold).
- **Heartbeats are counts only** — e.g. `service-a → service-b: 42 calls`. No per-request detail.
- **You control the destination** — traces go to the OTLP endpoint you configure (`OTEL_EXPORTER_OTLP_ENDPOINT`). Point it at your own collector, or at OpticsOps with your API key.
- **Bounded memory** — in-flight trace buffers are evicted after 60 seconds. Timers use `.unref()` so the agent does not keep your process alive.
- **Non-invasive** — patches `http`/`https` at the Node module level. Your handlers, middleware, and responses are unchanged.
- **Open source (MIT)** — [inspect the code](https://github.com/BibhabenduMukherjee/opticsops-otlp-agent/tree/main/packages/agent/src) before you run it in production.

### Sending traces to OpticsOps Cloud

```bash
OTEL_SERVICE_NAME=orders-api \
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-ingest.example.com/v1/traces \
OPTICSOPS_API_KEY=oo_your_key_here \
node --import @opticsops/agent/register app.js
```

The API key is sent only as an `X-Api-Key` header to your configured endpoint — never logged to stdout by the agent.

---

## Configuration

| Option | Env Var | Default | Description |
|--------|---------|---------|-------------|
| `serviceName` | `OTEL_SERVICE_NAME` | *(required)* | Logical name of this service (e.g. `orders-api`) |
| `otlpEndpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP HTTP collector URL |
| `latencyThresholdMs` | `OPTICSOPS_LATENCY_THRESHOLD_MS` | `500` | Slow-request threshold (ms) — triggers full trace export |
| `heartbeatIntervalMs` | `OPTICSOPS_HEARTBEAT_INTERVAL_MS` | `10000` | Heartbeat flush interval (ms) |
| `enableConsoleLogging` | `OPTICSOPS_CONSOLE_LOGGING` | `true` when `NODE_ENV=development` | Print traces and heartbeats to stdout |
| `apiKey` | `OPTICSOPS_API_KEY` | *(empty)* | API key for OpticsOps ingest (`X-Api-Key` header) |

```ts
import { init, shutdown } from '@opticsops/agent';

init({
  serviceName: 'orders-api',
  otlpEndpoint: 'http://collector:4318/v1/traces',
  latencyThresholdMs: 500,
  enableConsoleLogging: true,
  apiKey: process.env.OPTICSOPS_API_KEY,
});

await shutdown(); // graceful shutdown — flushes heartbeats and exporters
```

---

## Production deployment

Preload the agent when Node starts — same as local.

**Docker:**

```dockerfile
ENV OTEL_SERVICE_NAME=orders-api
ENV NODE_OPTIONS="--import @opticsops/agent/register"
CMD ["node", "app.js"]
```

**Kubernetes:**

```yaml
env:
  - name: OTEL_SERVICE_NAME
    value: orders-api
  - name: NODE_OPTIONS
    value: "--import @opticsops/agent/register"
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://opticsops-collector:4318"
  - name: OPTICSOPS_API_KEY
    valueFrom:
      secretKeyRef:
        name: opticsops
        key: api-key
```

**PM2:**

```js
module.exports = {
  apps: [{
    name: 'orders-api',
    script: 'app.js',
    node_args: '--import @opticsops/agent/register',
    env: { OTEL_SERVICE_NAME: 'orders-api' }
  }]
};
```

---

## How it works

1. **Inbound request** — intercepts `Server` `request` events, extracts `traceparent`, starts a SERVER span
2. **Outbound call** — wraps `http.request`, injects `traceparent`, starts a CLIENT span
3. **Span ends** — tail sampler buffers spans per trace ID
4. **Root span ends** — export full trace on error or slowness; otherwise aggregate into heartbeat

```
┌─────────────┐   traceparent    ┌─────────────┐
│  Service A  │ ───────────────► │  Service B  │
│  (SERVER +  │                  │  (SERVER)   │
│   CLIENT)   │                  │             │
└──────┬──────┘                  └──────┬──────┘
       └──────── same trace ID ─────────┘
```

---

## API

```ts
import {
  init,
  shutdown,
  isInitialized,
  getActiveTraceStore,
  formatTraceparent,
} from '@opticsops/agent';

// Read the active trace ID inside any HTTP handler
const store = getActiveTraceStore();
console.log(store?.traceparent); // "00-<traceId>-<spanId>-01"
```

---

## OTLP collector (optional)

Send traces to Jaeger or any OTLP-compatible backend:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

```bash
OTEL_SERVICE_NAME=orders-api \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OPTICSOPS_CONSOLE_LOGGING=true \
node --import @opticsops/agent/register app.js
```

Open Jaeger UI: http://localhost:16686

---

## Links

- **npm:** https://www.npmjs.com/package/@opticsops/agent
- **GitHub:** https://github.com/BibhabenduMukherjee/opticsops-otlp-agent
- **Issues:** https://github.com/BibhabenduMukherjee/opticsops-otlp-agent/issues

## License

MIT