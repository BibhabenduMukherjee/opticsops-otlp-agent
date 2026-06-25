# OpticsOps

Autonomous DevOps & Telemetry Platform — a unified SaaS that deploys infrastructure, silently injects telemetry, and visualizes live traffic on an animated canvas.

## MVP Roadmap

| Step | Status | Description |
|------|--------|-------------|
| **1. Telemetry Engine** | ✅ Complete | `@opticsops/agent` — zero-config Node.js OTel tracing |
| 2. Data Ingestion | Planned | ClickHouse + OTLP ingest API |
| 3. Deployment Orchestrator | Planned | Pulumi Automation API + deploy UI |
| 4. Live Visualizer | Planned | React Flow + WebSocket traffic animation |

See [`projectplan.txt`](./projectplan.txt) for the full architecture blueprint.

## Repository Structure

```
opticsops/
├── packages/
│   └── agent/              # @opticsops/agent — Step 1 telemetry NPM package
├── examples/
│   └── two-services/       # Cross-service tracing demo
└── projectplan.txt         # Master MVP blueprint
```

## Quick Start

```bash
# Install dependencies and build the agent
npm install
npm run build

# Run tests
npm test

# Try the two-service demo (see examples/two-services/README.md)
```

## Step 1: Telemetry Agent

```ts
import { init } from '@opticsops/agent';

init({ serviceName: 'my-api' });

// All http/https traffic is now automatically traced.
```

Full documentation: [`packages/agent/README.md`](./packages/agent/README.md)

### Key Design Decisions

- **Tail-based sampling** — full traces exported only on 4xx/5xx or latency > 500ms
- **Heartbeat aggregation** — healthy calls summarized every 10s (cost control)
- **W3C Trace Context** — standard `traceparent` header, no vendor lock-in
- **Monkey-patching** — zero changes to application code

## Development

```bash
npm run build          # Build @opticsops/agent
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run example:two-services  # Start demo (both services)
```

## Requirements

- Node.js >= 18