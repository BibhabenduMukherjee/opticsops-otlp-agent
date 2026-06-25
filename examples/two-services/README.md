# Two-Service Demo (Step 1 Success Metric)

Demonstrates automatic cross-service tracing with **zero manual instrumentation**.

## Prerequisites

- Node.js 18+
- From the repo root: `npm install && npm run build`

## Run

**Terminal 1 — Service B:**
```bash
cd examples/two-services
OTEL_SERVICE_NAME=service-b OPTICSOPS_CONSOLE_LOGGING=true npm run start:b
```

**Terminal 2 — Service A:**
```bash
cd examples/two-services
OTEL_SERVICE_NAME=service-a OPTICSOPS_CONSOLE_LOGGING=true npm run start:a
```

**Terminal 3 — Trigger requests:**
```bash
# Healthy request (aggregated into heartbeat, not fully exported)
curl http://localhost:4000/hello

# Anomalous request (full linked trace exported + logged)
curl http://localhost:4000/fail
```

## Expected Output

On `/fail`, both terminals show a linked trace chain sharing the same trace ID:

```
[opticsops] 🔗 Trace a1b2c3d4e5f6… (2 spans)
  └─ [SERVER] HTTP GET (span=abc12345… status=502)
  └─ [CLIENT] HTTP GET (span=def67890… status=500)
```

Service B's terminal shows the incoming `traceparent` header was received and continued.