# OpticsOps SaaS — Roadmap & Progress Tracker

Local tracking file for MVP → SaaS completion.  
Repo: https://github.com/BibhabenduMukherjee/opticsops-otlp-agent

**Last updated:** 2026-06-21

---

## Overall progress

| Phase | Status |
|-------|--------|
| Step 1 — Telemetry Agent | ✅ Done |
| Step 2 — Data Ingestion | ⬜ Pending |
| Step 3 — Deployment Orchestrator | ⬜ Pending |
| Step 4 — Live Visualizer | ⬜ Pending |
| Step 5 — SaaS Platform | ⬜ Pending |

---

## Step 1: Telemetry Engine — ✅ DONE

- [x] `@opticsops/agent` npm package scaffolded
- [x] AsyncLocalStorage + W3C `traceparent` propagation
- [x] HTTP server instrumentation (`Server.emit` patch)
- [x] HTTP client instrumentation (`http.request` patch)
- [x] OTLP HTTP exporter integration
- [x] Tail-based sampling (export on 4xx/5xx or latency > 500ms)
- [x] Heartbeat aggregation (healthy traffic every 10s)
- [x] `register.ts` preload entry (`--import`)
- [x] Two-service local demo (`examples/two-services`)
- [x] Unit + integration tests (15 passing)
- [x] TailSamplingSpanProcessor memory leak fix
- [x] Package README with output examples & benefits
- [x] Root README simplified for external readers
- [x] Pushed to GitHub (`opticsops-otlp-agent`)
- [ ] Publish `@opticsops/agent` to npm (public)

---

## Step 2: Data Ingestion Backend — ⬜ PENDING

**Goal:** Agent sends traces to your backend; store and query at scale.

- [ ] Docker Compose setup (ClickHouse + ingest service)
- [ ] ClickHouse schema for raw OTLP spans
- [ ] OTLP HTTP ingest API (Go or Fastify)
- [ ] Accept payloads from `@opticsops/agent`
- [ ] Materialized views — extract service-to-service dependencies
- [ ] Query API — fetch traces by ID
- [ ] Query API — fetch dependency graph
- [ ] Load test: 1,000 req/s ingestion
- [ ] Query latency < 50ms
- [ ] Point local agent at ingest API (replace console-only mode)
- [ ] Basic health/metrics endpoints for ingest service

**Success metric:** Agent → ingest API → ClickHouse → query relationships in < 50ms.

---

## Step 3: Deployment Orchestrator — ⬜ PENDING

**Goal:** User defines services in UI → deploy to cloud with agent auto-injected.

- [ ] Pulumi Automation API integration (Node.js)
- [ ] GCP Cloud Run resource definitions (Service A + Service B)
- [ ] Simple deploy API (trigger/pulumi run)
- [ ] Auto-inject env vars (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`)
- [ ] Auto-install `@opticsops/agent` in deployed containers
- [ ] Simple deploy UI — define "Cloud Run A" and "Cloud Run B"
- [ ] Compile UI/YAML config → standard Pulumi code
- [ ] GitOps — commit generated Pulumi to user's GitHub repo
- [ ] Deploy status feedback in UI

**Success metric:** Click Deploy → two fully instrumented Cloud Run services on GCP.

---

## Step 4: Live Visualizer — ⬜ PENDING

**Goal:** Infrastructure map + animated live traffic on one dashboard.

- [ ] React app scaffold (frontend)
- [ ] React Flow — node-and-edge infrastructure graph
- [ ] Blueprint view — static nodes from Pulumi deployment state
- [ ] Live view — traffic lines on service click or anomaly
- [ ] WebSocket server — push trace events from ClickHouse
- [ ] Animate particles along edges (D3.js)
- [ ] Contextual layering — avoid "hairball" UI (selected service only)
- [ ] Connect deploy UI + visualizer in one dashboard
- [ ] "Execute Workflow" → deploy → trigger API → path lights up

**Success metric:** Deploy infra, call API, see animated traffic path immediately.

---

## Step 5: SaaS Platform — ⬜ PENDING

**Goal:** Real product — sign up, pay, use.

### Auth & multi-tenancy
- [ ] User sign up / login
- [ ] Teams / organizations
- [ ] Per-tenant isolation (traces, services, dashboards)
- [ ] API keys per tenant

### Product & onboarding
- [ ] Landing page
- [ ] Onboarding flow (connect → install agent → see first trace)
- [ ] Per-tenant OTLP endpoint URL
- [ ] Usage dashboard (trace volume, services, errors)

### Billing & ops
- [ ] Stripe integration (free + paid tiers)
- [ ] Rate limits per plan
- [ ] Admin panel

### Distribution
- [ ] Publish `@opticsops/agent` to npm
- [ ] Public docs site
- [ ] GitHub README badges (build, tests)

---

## Tech stack (locked — do not deviate)

| Layer | Tool |
|-------|------|
| Telemetry agent | Node.js + OpenTelemetry |
| Orchestration | Pulumi Automation API |
| Data storage | ClickHouse |
| Ingest / API | Go or Fastify (Node.js) |
| Frontend | React Flow + D3.js |
| WebSockets | Fastify or Go |

---

## Risk mitigations (built into plan)

| Risk | Mitigation | Status |
|------|------------|--------|
| Infinite compute costs | Tail sampling + heartbeats | ✅ Done (agent) |
| Vendor lock-in | Standard OTel + GitOps Pulumi output | ⬜ Partial (OTel done) |
| Hairball UI | Blueprint vs Live view, click-to-highlight | ⬜ Pending (Step 4) |

---

## Recommended build order

```
✅ 1. Agent (done)
→  2. ClickHouse + ingest API        ← NEXT
   3. Live visualizer (prove wow moment)
   4. Pulumi deployer
   5. SaaS (auth, billing)
```

---

## Quick reference — what exists today

```bash
# Build & test
npm install && npm run build && npm test

# Run demo
cd examples/two-services && npm run start:b   # terminal 1
cd examples/two-services && npm run start:a   # terminal 2
curl http://localhost:4000/fail               # terminal 3
```

**Docs:** `packages/agent/README.md`  
**GitHub:** https://github.com/BibhabenduMukherjee/opticsops-otlp-agent