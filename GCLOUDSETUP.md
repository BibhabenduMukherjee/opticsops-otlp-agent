# GCP Setup Guide — OpticsOps

Step-by-step Google Cloud setup for the OpticsOps SaaS platform.  
Use this before Step 2 (ingest API) and Step 3 (Cloud Run deployments).

**Last updated:** 2026-06-21

---

## What you'll use on GCP

| OpticsOps component | GCP service |
|---------------------|-------------|
| Microservices (service-a, service-b) | **Cloud Run** |
| Docker images | **Artifact Registry** |
| OTLP ingest API (Step 2) | **Cloud Run** |
| ClickHouse (Step 2) | **GCE VM** or **ClickHouse Cloud** |
| Secrets (API keys, tokens) | **Secret Manager** |
| Dashboard (Step 4) | **Cloud Run** or **Firebase Hosting** |

---

## Prerequisites

- Google account
- Credit/debit card (billing required — new accounts often get $300 free credit for 90 days)
- Terminal access (macOS / Linux / WSL)

---

## Step 1: Create a GCP account & enable billing

1. Go to https://console.cloud.google.com
2. Sign in with your Google account
3. Accept the terms of service
4. Open **Billing** → **Link a billing account**
5. Add payment method and link it to your project

---

## Step 2: Create a project

1. Top navigation bar → **Select a project** → **New Project**
2. Fill in:
   - **Project name:** `OpticsOps`
   - **Project ID:** `opticsops-XXXXXX` (note this — it must be unique globally)
3. Click **Create**
4. Select the new project from the project dropdown

Save your project ID:

```bash
export PROJECT_ID=opticsops-XXXXXX   # replace with your actual ID
```

---

## Step 3: Install Google Cloud CLI

### macOS (Homebrew)

```bash
brew install google-cloud-sdk
```

### Other platforms

https://cloud.google.com/sdk/docs/install

### Verify installation

```bash
gcloud version
```

---

## Step 4: Initialize gcloud

```bash
gcloud init
```

Follow the prompts:

1. **Login** — authenticate in the browser
2. **Select project** — choose `opticsops-XXXXXX`
3. **Default region** — e.g. `us-central1` or `asia-south1` (Mumbai)

Set project explicitly:

```bash
gcloud config set project $PROJECT_ID
```

Verify:

```bash
gcloud config get-value project
gcloud auth list
```

---

## Step 5: Set default region

```bash
gcloud config set run/region us-central1
gcloud config set compute/region us-central1
gcloud config set artifacts/location us-central1
```

> Change `us-central1` to your preferred region. Keep all services in the **same region** for lower latency and cost.

---

## Step 6: Enable required APIs

Run once per project:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  compute.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

| API | Purpose |
|-----|---------|
| `run.googleapis.com` | Deploy OpticsOps services on Cloud Run |
| `artifactregistry.googleapis.com` | Store Docker images |
| `cloudbuild.googleapis.com` | Build images from source |
| `secretmanager.googleapis.com` | Store API keys and tokens |
| `iam.googleapis.com` | Service accounts and permissions |
| `compute.googleapis.com` | GCE VMs (ClickHouse, if self-hosted) |
| `logging.googleapis.com` | Cloud Logging |
| `monitoring.googleapis.com` | Cloud Monitoring |

Check enabled APIs:

```bash
gcloud services list --enabled
```

---

## Step 7: Create a service account

For Pulumi deployments, CI/CD, and automation:

```bash
gcloud iam service-accounts create opticsops-deployer \
  --display-name="OpticsOps Deployer"
```

Grant roles:

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:opticsops-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:opticsops-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:opticsops-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:opticsops-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Download a key file (keep this secret — do not commit to git):

```bash
gcloud iam service-accounts keys create ~/opticsops-gcp-key.json \
  --iam-account=opticsops-deployer@${PROJECT_ID}.iam.gserviceaccount.com
```

Set the environment variable for local tools (Pulumi, Terraform, etc.):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/opticsops-gcp-key.json
```

Add to `~/.zshrc` or `~/.bashrc` if you want it permanent:

```bash
echo 'export GOOGLE_APPLICATION_CREDENTIALS=~/opticsops-gcp-key.json' >> ~/.zshrc
```

> **Security:** Add `*-gcp-key.json` to `.gitignore`. Never push key files to GitHub.

---

## Step 8: Create Artifact Registry (Docker repository)

```bash
gcloud artifacts repositories create opticsops \
  --repository-format=docker \
  --location=us-central1 \
  --description="OpticsOps container images"
```

Configure Docker to authenticate:

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

Your image URLs will look like:

```
us-central1-docker.pkg.dev/PROJECT_ID/opticsops/service-a:latest
us-central1-docker.pkg.dev/PROJECT_ID/opticsops/service-b:latest
us-central1-docker.pkg.dev/PROJECT_ID/opticsops/ingest-api:latest
```

---

## Step 9: Deploy a test service on Cloud Run

Prove your GCP setup works before building OpticsOps services.

### Create a minimal test app

**`test-app/app.js`:**

```javascript
import http from 'node:http';

const port = process.env.PORT || 8080;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpticsOps on GCP — OK\n');
}).listen(port, () => {
  console.log(`Listening on port ${port}`);
});
```

**`test-app/package.json`:**

```json
{
  "name": "opticsops-gcp-test",
  "type": "module",
  "scripts": {
    "start": "node app.js"
  }
}
```

### Deploy directly from source (no Dockerfile needed)

```bash
cd test-app

gcloud run deploy opticsops-test \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="OTEL_SERVICE_NAME=opticsops-test"
```

### Test the URL

```bash
curl $(gcloud run services describe opticsops-test \
  --region us-central1 \
  --format='value(status.url)')
```

Expected output:

```
OpticsOps on GCP — OK
```

---

## Step 10: Deploy with @opticsops/agent on Cloud Run

When deploying real OpticsOps services, inject the agent via env vars and startup command.

```bash
gcloud run deploy service-a \
  --image us-central1-docker.pkg.dev/${PROJECT_ID}/opticsops/service-a:latest \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="OTEL_SERVICE_NAME=service-a,OTEL_EXPORTER_OTLP_ENDPOINT=https://YOUR-INGEST-URL/v1/traces" \
  --command="node" \
  --args="--import,@opticsops/agent/register,app.js"
```

Or bake into your **Dockerfile**:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
ENV OTEL_SERVICE_NAME=service-a
ENV OTEL_EXPORTER_OTLP_ENDPOINT=https://YOUR-INGEST-URL/v1/traces
CMD ["node", "--import", "@opticsops/agent/register", "app.js"]
```

Build and push:

```bash
docker build -t us-central1-docker.pkg.dev/${PROJECT_ID}/opticsops/service-a:latest .
docker push us-central1-docker.pkg.dev/${PROJECT_ID}/opticsops/service-a:latest
```

---

## Step 11: Set up billing alerts (recommended)

Avoid surprise costs:

1. Go to **Billing** → **Budgets & alerts**
2. Click **Create budget**
3. Set amount (e.g. $10 / month for dev)
4. Enable email alerts at 50%, 90%, 100%

---

## Step 12: How OpticsOps connects to GCP (data flow)

```
Customer's Cloud Run service
  @opticsops/agent installed
  OTEL_EXPORTER_OTLP_ENDPOINT = https://ingest-YOUR-PROJECT.run.app/v1/traces
              ↓  OTLP HTTP POST
Your ingest API (Cloud Run — Step 2)
              ↓
ClickHouse (GCE VM or ClickHouse Cloud — Step 2)
              ↓
OpticsOps dashboard (Cloud Run — Step 4)
```

The agent does **not** write to ClickHouse directly. It sends OTLP to your ingest API; your backend stores the data.

---

## Checklist

Mark items as you complete them:

- [ ] GCP account created
- [ ] Billing enabled
- [ ] Project created (`opticsops-XXXXXX`)
- [ ] `gcloud` CLI installed
- [ ] `gcloud init` completed
- [ ] Default region set
- [ ] APIs enabled (Step 6)
- [ ] Service account `opticsops-deployer` created
- [ ] Service account key downloaded (`~/opticsops-gcp-key.json`)
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` set
- [ ] Artifact Registry repo `opticsops` created
- [ ] Test Cloud Run deploy successful (`opticsops-test`)
- [ ] Billing alerts configured
- [ ] (Step 2) ClickHouse + ingest API deployed
- [ ] (Step 3) service-a + service-b deployed via Pulumi
- [ ] (Step 4) Dashboard deployed

---

## Useful commands reference

```bash
# List Cloud Run services
gcloud run services list --region us-central1

# View service logs
gcloud run services logs read opticsops-test --region us-central1

# Delete a test service
gcloud run services delete opticsops-test --region us-central1

# List Docker images in Artifact Registry
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/${PROJECT_ID}/opticsops

# Check current config
gcloud config list

# Switch project
gcloud config set project OTHER_PROJECT_ID
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `API not enabled` | Re-run Step 6 `gcloud services enable ...` |
| `Permission denied` | Check service account roles (Step 7) |
| `Docker push failed` | Run `gcloud auth configure-docker us-central1-docker.pkg.dev` |
| `Cloud Run deploy failed` | Check logs: `gcloud run services logs read SERVICE_NAME` |
| `Billing not enabled` | Link billing account in GCP Console |
| `Project not found` | Run `gcloud config set project $PROJECT_ID` |

---

## Next steps (OpticsOps roadmap)

1. **Step 2** — Deploy ClickHouse + OTLP ingest API on GCP → see `ROADMAP.md`
2. **Step 3** — Pulumi Automation API to deploy service-a + service-b on Cloud Run
3. **Step 4** — React dashboard reading from ClickHouse

---

## Links

- GCP Console: https://console.cloud.google.com
- Cloud Run docs: https://cloud.google.com/run/docs
- Artifact Registry docs: https://cloud.google.com/artifact-registry/docs
- OpticsOps roadmap: [`ROADMAP.md`](./ROADMAP.md)
- Agent docs: [`packages/agent/README.md`](./packages/agent/README.md)