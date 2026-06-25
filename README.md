# opticsops-otlp-agent

Zero-configuration OpenTelemetry agent for Node.js. Add it to your app — HTTP traffic is automatically traced and linked across services. No tracing code required.

## What is this?

`@opticsops/agent` wraps your Node.js process at startup, patches `http` / `https`, and:

- Injects W3C `traceparent` headers on outbound calls
- Links traces across microservices (same trace ID)
- Exports full traces only on errors or slow requests (tail sampling)
- Summarizes healthy traffic as periodic heartbeats (cost control)

## Install & run

```bash
npm install @opticsops/agent
```

```bash
OTEL_SERVICE_NAME=orders-api node --import @opticsops/agent/register app.js
```

Or add to `package.json`:

```json
{
  "scripts": {
    "start": "OTEL_SERVICE_NAME=orders-api node --import @opticsops/agent/register app.js"
  }
}
```

## Example output (error)

```
[opticsops] 🔗 Trace 4f73f40b9f8b99a1… (2 spans)
  └─ [CLIENT] HTTP GET (span=6fb8952e… status=500)
  └─ [SERVER] HTTP GET (span=4adcb254… status=502)
```

Same trace ID, two hops — points you to the service that actually failed.

## Try locally

```bash
npm install && npm run build

# Terminal 1
cd examples/two-services && npm run start:b

# Terminal 2
cd examples/two-services && npm run start:a

# Terminal 3
curl http://localhost:4000/fail
```

## Repo layout

```
packages/agent/          # @opticsops/agent npm package
examples/two-services/   # demo (service-a → service-b)
```

## Docs & requirements

- Full agent docs: [`packages/agent/README.md`](./packages/agent/README.md)
- Node.js >= 18