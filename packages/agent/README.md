# @opticsops/agent

Zero-configuration OpenTelemetry agent for Node.js. Add it to your app, run — every HTTP request is automatically traced and linked across services via [W3C Trace Context](https://www.w3.org/TR/trace-context/).

Part of the **OpticsOps** platform (MVP Step 1: Telemetry Engine).

---

## What it does

OpticsOps sits as a **wrapper around your Node.js process** — not inside your business logic. When Node starts, the agent loads first, patches `http` / `https`, and watches all traffic. You write zero tracing code.

```
User → your-service-a → your-service-b
         ↑                    ↑
    agent watches        agent watches
    (same trace ID passed between them)
```

---

## Quick Start

### Install

```bash
npm install @opticsops/agent
```

### Run (recommended)

Preload the agent **before** your app loads:

```bash
OTEL_SERVICE_NAME=orders-api node --import @opticsops/agent/register app.js
```

### Or in code (agent must be the first import)

```ts
import { init } from '@opticsops/agent'; // must be first
import http from 'node:http';

init({ serviceName: 'orders-api' });
```

### Add to package.json

```json
{
  "scripts": {
    "start": "OTEL_SERVICE_NAME=orders-api node --import @opticsops/agent/register app.js",
    "dev": "OTEL_SERVICE_NAME=orders-api OPTICSOPS_CONSOLE_LOGGING=true node --import @opticsops/agent/register app.js"
  }
}
```

Then: `npm start`

---

## Try the local demo (two services)

From the repo root:

```bash
npm install && npm run build
```

**Terminal 1 — backend (service-b):**
```bash
cd examples/two-services
npm run start:b
```

**Terminal 2 — gateway (service-a):**
```bash
cd examples/two-services
npm run start:a
```

**Terminal 3 — send requests:**
```bash
curl http://localhost:4000/hello   # healthy request
curl http://localhost:4000/fail    # error request
```

---

## Output structure (what you see)

The agent prints three types of messages to the terminal (when `OPTICSOPS_CONSOLE_LOGGING=true`).

### 1. Startup

```
[opticsops] Agent started for "service-a" → http://localhost:4318/v1/traces
[service-a] listening on http://localhost:4000
```

| Part | Meaning |
|------|---------|
| `service-a` | Your service name (`OTEL_SERVICE_NAME`) |
| `→ http://localhost:4318/v1/traces` | Where full traces are sent (OTLP collector) |

---

### 2. Heartbeat (healthy traffic)

After a successful, fast request (`/hello`):

```
[service-a] incoming GET /hello traceparent=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Then every 10 seconds:

```
[opticsops] 💓 Heartbeat (1718976000000): service-a → http://127.0.0.1:4001/: 3 calls
```

| Part | Meaning |
|------|---------|
| `traceparent=00-...` | Tracking ID on the incoming request |
| `💓 Heartbeat` | Healthy calls are **counted**, not stored as full traces |
| `service-a → http://127.0.0.1:4001/: 3 calls` | A called B three times in this window |

**Why:** Avoids exporting every normal request (saves cost and noise).

---

### 3. Linked trace (errors or slow requests)

After a failing request (`/fail`):

```
[opticsops] 🔗 Trace 4f73f40b9f8b99a1… (2 spans)
  └─ [CLIENT] HTTP GET (span=6fb8952e… status=500)
  └─ [SERVER] HTTP GET (span=4adcb254… status=502)
```

#### How to read this

Read **bottom to top** — that's the request flow:

```
User
  ↓
[SERVER] service-a received request     → returned 502 to user
  ↓
[CLIENT] service-a called service-b     → service-b returned 500  ← root cause
```

| Part | Meaning |
|------|---------|
| `🔗 Trace 4f73f40b9f8b99a1…` | One shared ID linking all steps |
| `(2 spans)` | Two hops recorded for this request |
| `[SERVER]` | This service **received** a request |
| `[CLIENT]` | This service **called** another service |
| `status=500` | Downstream (service-b) failed |
| `status=502` | This service (service-a) relayed that failure to the user |

**Diagnosis from one block:** User saw 502, but **service-b** is where you debug first (500 on the outbound call).

---

## Benefits

### For developers

| Benefit | How the output helps |
|---------|----------------------|
| **Find root cause faster** | `CLIENT status=500` points to the downstream service, not the gateway |
| **No instrumentation code** | Traces appear without manual spans in your handlers |
| **One ID across services** | Search `4f73f40b9f8b99a1` in logs for service-a and service-b |
| **Less log archaeology** | One linked chain instead of correlating two apps by timestamp |

### For DevOps / on-call

| Benefit | How the output helps |
|---------|----------------------|
| **Know which service broke** | SERVER vs CLIENT shows where in the chain the failure happened |
| **Signal over noise** | Healthy traffic → heartbeat count only; errors → full trace |
| **Standard format** | OpenTelemetry OTLP — works with Jaeger, Grafana, Datadog, etc. |
| **Production-ready pattern** | Same `--import` or `NODE_OPTIONS` in Docker, Kubernetes, PM2 |

### For the platform (OpticsOps SaaS)

| Benefit | How it fits |
|---------|-------------|
| **Cost control** | Tail sampling + heartbeats avoid storing every request |
| **No vendor lock-in** | Standard W3C `traceparent` + OTLP export |
| **Foundation for live map** | Same trace data powers the Step 4 visualizer |

---

## Without vs with OpticsOps

**Without:**
```
service-a log: "upstream error"
service-b log: "500 on /api"
```
You guess: same request? same user? which service to fix?

**With:**
```
[opticsops] 🔗 Trace 4f73f40b9f8b99a1… (2 spans)
  └─ [CLIENT] HTTP GET (span=6fb8952e… status=500)   ← fix here (service-b)
  └─ [SERVER] HTTP GET (span=4adcb254… status=502)   ← symptom (service-a)
```
One trace ID, clear cause → effect, fix the right service first.

---

## Configuration

| Option | Env Var | Default | Description |
|--------|---------|---------|-------------|
| `serviceName` | `OTEL_SERVICE_NAME` | *(required)* | Logical name of this service (e.g. `orders-api`) |
| `otlpEndpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP HTTP collector URL |
| `latencyThresholdMs` | `OPTICSOPS_LATENCY_THRESHOLD_MS` | `500` | Slow-request anomaly threshold (ms) |
| `heartbeatIntervalMs` | `OPTICSOPS_HEARTBEAT_INTERVAL_MS` | `10000` | Heartbeat flush interval (ms) |
| `enableConsoleLogging` | `OPTICSOPS_CONSOLE_LOGGING` | `true` in development | Print traces and heartbeats to stdout |

```ts
import { init, shutdown } from '@opticsops/agent';

init({
  serviceName: 'orders-api',
  otlpEndpoint: 'http://collector:4318/v1/traces',
  latencyThresholdMs: 500,
  enableConsoleLogging: true,
});

await shutdown(); // graceful shutdown — flushes heartbeats and exporters
```

---

## Production deployment

Same mechanism as local — preload the agent when Node starts.

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

## How it works (short)

1. **Inbound request** — agent intercepts `Server` `request` events, extracts `traceparent`, starts a SERVER span
2. **Outbound call** — agent wraps `http.request`, injects `traceparent`, starts a CLIENT span
3. **Span ends** — tail sampler buffers spans per trace ID
4. **Root span ends** — if any span is an error or slow, export full trace; otherwise aggregate into heartbeat

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

## Testing

```bash
npm test
npm run test:watch
```

---

## Architecture

```
src/
├── register.ts               # Preload entry (--import)
├── index.ts                  # Public API + auto-init
├── init.ts                   # Bootstrap all components
├── config.ts                 # Env var resolution
├── context/trace-context.ts  # AsyncLocalStorage trace store
├── propagation/w3c.ts        # traceparent inject/extract
├── instrumentation/
│   ├── http-server.ts        # Incoming request interception
│   └── http-client.ts        # Outgoing request interception
├── export/
│   ├── tail-sampler.ts       # Export only on anomaly
│   └── otlp-exporter.ts      # OTLP pipeline + console logging
└── metrics/heartbeat.ts      # Healthy traffic aggregation
```

---

## License

MIT