# Shopify App Dev Server Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Lens Search Shopify app from local testing to the company development server behind `https://search.pagelumo.com`, with only 80/443 exposed and app services bound to localhost.

**Architecture:** The public browser path is `https://search.pagelumo.com` for the embedded app and Shopify app proxy target, with Nginx/Caddy reverse-proxying to the Node app bound on `127.0.0.1:9300`. The Node app talks to company-internal PostgreSQL, Redis, Milvus, S3/MinIO, and a local-only Python embedding service bound on `127.0.0.1:8001`. Shopify storefront production traffic should use `/apps/lens-cart-ai`, not the temporary Cloudflare tunnel URL used in Theme Editor testing.

**Tech Stack:** Shopify CLI config TOML, React Router app, Prisma/PostgreSQL, BullMQ/Redis, Milvus, S3-compatible object storage, FastAPI/uvicorn embedding service, Nginx/Caddy/systemd.

---

## File Structure

- Modify: `shopify.app.lens-search.toml` — production app URL, auth redirect URL, app proxy config for the new Lens Search app.
- Modify on server only: `.env` — production runtime secrets and internal service addresses; do not commit.
- Review/possibly modify: `Dockerfile` — current app image exposes 3000; if using host/systemd set `PORT=9300`; if using Docker, map only localhost.
- Review: `app/shopify.server.ts` — confirms app uses `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and no active billing enforcement currently.
- Review: `app/lib/image-search/env.server.ts` — confirms all service addresses come from env.
- Review/possibly modify: `services/embedding/pyproject.toml` — Python/Torch compatibility for server Python version.
- Create on server: `/etc/systemd/system/lens-search-web.service` — run Node app on `127.0.0.1:9300`.
- Create on server: `/etc/systemd/system/lens-search-worker.service` — run product index worker.
- Create on server: `/etc/systemd/system/lens-search-embedding.service` — run FastAPI embedding service on `127.0.0.1:8001`.
- Create on server: Nginx/Caddy site for `search.pagelumo.com` — reverse proxy HTTPS to `127.0.0.1:9300`.

---

### Task 1: Lock Shopify app config to the new Lens Search app

**Files:**
- Modify: `shopify.app.lens-search.toml`

- [ ] **Step 1: Confirm this is the app config to deploy**

Run locally:

```bash
cd /Users/apple/Desktop/jttapp/lens-cart-ai
npm run shopify -- app info --config lens-search
```

Expected output contains:

```text
Configuration file  shopify.app.lens-search.toml
App name            Lens Search
Client ID           6d25e60dbb06b6811c827e94c88add91
```

- [ ] **Step 2: Set production URLs in `shopify.app.lens-search.toml`**

Change the file to this production shape:

```toml
client_id = "6d25e60dbb06b6811c827e94c88add91"
name = "Lens Search"
application_url = "https://search.pagelumo.com"
embedded = true

[access_scopes]
scopes = "write_products,write_metaobjects,write_metaobject_definitions,write_app_proxy"
optional_scopes = [ ]
use_legacy_install_flow = false

[auth]
redirect_urls = [ "https://search.pagelumo.com/auth/callback" ]

[webhooks]
api_version = "2026-07"

  [[webhooks.subscriptions]]
  uri = "/webhooks/app/uninstalled"
  topics = [ "app/uninstalled" ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/app/scopes_update"
  topics = [ "app/scopes_update" ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/products/create"
  topics = [ "products/create" ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/products/update"
  topics = [ "products/update" ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/products/delete"
  topics = [ "products/delete" ]

[app_proxy]
url = "/api"
prefix = "apps"
subpath = "lens-cart-ai"

[build]
automatically_update_urls_on_dev = true
```

- [ ] **Step 3: Deploy Shopify app config**

Run:

```bash
cd /Users/apple/Desktop/jttapp/lens-cart-ai
npm run deploy -- --config lens-search
```

Expected: Shopify CLI deploys `application_url`, auth redirect, webhooks, and app proxy for Client ID `6d25e60dbb06b6811c827e94c88add91`.

- [ ] **Step 4: Verify app proxy is not `example.com` or a tunnel**

Run:

```bash
cd /Users/apple/Desktop/jttapp/lens-cart-ai
npm run shopify -- app info --config lens-search
```

Expected: app URL is `https://search.pagelumo.com`, not `https://example.com` and not `trycloudflare.com`.

---

### Task 2: Prepare production `.env` on the server

**Files:**
- Create on server only: `/opt/lens-cart-ai/current/.env`

- [ ] **Step 1: Create server runtime env file**

On the server, create `/opt/lens-cart-ai/current/.env` with these keys. Use the real secret values from the new Lens Search app and company internal services; do not commit this file.

```env
NODE_ENV=production
PORT=9300
HOST=127.0.0.1

DATABASE_URL=postgresql://appuser:<company-db-password>@<company-postgres-internal-host>:15432/appdb

SHOPIFY_API_KEY=6d25e60dbb06b6811c827e94c88add91
SHOPIFY_API_SECRET=<new-lens-search-client-secret>
SHOPIFY_APP_URL=https://search.pagelumo.com
SCOPES=write_products,write_metaobjects,write_metaobject_definitions,write_app_proxy
SHOPIFY_PRODUCT_QUERY=status:active
SHOPIFY_APP_PROXY_PREFIX=/apps/lens-cart-ai

# Production should normally use Shopify App Proxy, so CORS can be empty.
# Only add store origins here for temporary direct-domain testing.
STOREFRONT_CORS_ORIGINS=

MILVUS_ADDRESS=<company-milvus-internal-host>:19530
MILVUS_USERNAME=root
MILVUS_PASSWORD=<company-milvus-password>
MILVUS_COLLECTION=product_image_embeddings_clip_b32_512
MILVUS_COLLECTION_PREFIX=product_image_embeddings
MILVUS_METRIC_TYPE=IP

IMAGE_EMBEDDING_SERVICE_URL=http://127.0.0.1:8001
IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch32
IMAGE_EMBEDDING_MODEL_ALIAS=clip-vit-b-32
IMAGE_EMBEDDING_DIMENSION=512
IMAGE_SEARCH_MIN_SIMILARITY_SCORE=0.25
IMAGE_EMBEDDING_REQUEST_TIMEOUT_MS=45000
IMAGE_EMBEDDING_REQUEST_RETRIES=1
IMAGE_EMBEDDING_CIRCUIT_FAILURE_THRESHOLD=5
IMAGE_EMBEDDING_CIRCUIT_RESET_MS=60000
IMAGE_SEARCH_SYNC_TIMEOUT_MS=90000

UPLOAD_STORAGE_PROVIDER=s3
UPLOAD_STORAGE_BUCKET=shopify-image
UPLOAD_STORAGE_ENDPOINT=<company-s3-internal-or-approved-endpoint>
UPLOAD_STORAGE_REGION=us-east-1
UPLOAD_STORAGE_ACCESS_KEY_ID=<company-s3-access-key>
UPLOAD_STORAGE_SECRET_ACCESS_KEY=<company-s3-secret-key>
UPLOAD_STORAGE_FORCE_PATH_STYLE=true
UPLOAD_STORE_ORIGINALS=true

REDIS_URL=redis://:<company-redis-password>@<company-redis-internal-host>:16379
PRODUCT_INDEX_QUEUE_CONCURRENCY=1
SHOPIFY_PRODUCTS_PAGE_SIZE=50
SHOPIFY_MEDIA_PAGE_SIZE=25
SHOPIFY_VARIANTS_PAGE_SIZE=50
LOG_LEVEL=info
```

- [ ] **Step 2: Do not use local forwarded `127.0.0.1` for company services unless the same tunnels exist on the server**

Current local `.env` uses `127.0.0.1:15432`, `127.0.0.1:16379`, and `127.0.0.1:19530` because VS Code port forwarding is active locally. On the deployment server, use company-internal reachable hostnames/IPs, or create explicit systemd SSH tunnels before starting the app.

- [ ] **Step 3: Confirm different stores are supported by data model, not by env**

No per-store `SHOP` env should be set. The app stores sessions/products by `shopDomain`; Milvus searches filter by `shop_domain`, and collection names are resolved per shop. Do not set `SHOP_CUSTOM_DOMAIN` unless intentionally limiting auth to one custom shop domain.

---

### Task 3: Configure server processes without exposing app ports

**Files:**
- Create on server: `/etc/systemd/system/lens-search-web.service`
- Create on server: `/etc/systemd/system/lens-search-worker.service`
- Create on server: `/etc/systemd/system/lens-search-embedding.service`

- [ ] **Step 1: Web service binds to localhost only**

Create `/etc/systemd/system/lens-search-web.service`:

```ini
[Unit]
Description=Lens Search Shopify Web App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=shopify_ops
WorkingDirectory=/opt/lens-cart-ai/current
EnvironmentFile=/opt/lens-cart-ai/current/.env
Environment=NODE_ENV=production
Environment=PORT=9300
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Worker service runs separately**

Create `/etc/systemd/system/lens-search-worker.service`:

```ini
[Unit]
Description=Lens Search Product Index Worker
After=network-online.target lens-search-web.service
Wants=network-online.target

[Service]
Type=simple
User=shopify_ops
WorkingDirectory=/opt/lens-cart-ai/current
EnvironmentFile=/opt/lens-cart-ai/current/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run worker:product-index
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Embedding service binds to localhost only**

Create `/etc/systemd/system/lens-search-embedding.service`:

```ini
[Unit]
Description=Lens Search CLIP Embedding Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=shopify_ops
WorkingDirectory=/opt/lens-cart-ai/current/services/embedding
Environment=IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch32
Environment=IMAGE_EMBEDDING_MODEL_ALIAS=clip-vit-b-32
Environment=IMAGE_EMBEDDING_DIMENSION=512
Environment=IMAGE_EMBEDDING_MODEL_LOCAL_DIR=/opt/lens-cart-ai/models/openai-mirror/clip-vit-base-patch32
Environment=EMBEDDING_MAX_CONCURRENCY=1
Environment=LOG_LEVEL=INFO
ExecStart=/opt/lens-cart-ai/current/services/embedding/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Open only 80/443 publicly**

Firewall target:

```text
public allowed: 80/tcp, 443/tcp, ssh management port
public blocked: 9300/tcp, 8001/tcp, 15432/tcp, 16379/tcp, 19530/tcp
local allowed: 127.0.0.1:9300, 127.0.0.1:8001
```

---

### Task 4: Configure HTTPS reverse proxy

**Files:**
- Create on server: Nginx or Caddy config for `search.pagelumo.com`

- [ ] **Step 1: Nginx reverse proxy config**

Use this Nginx server block after TLS is issued:

```nginx
server {
    listen 80;
    server_name search.pagelumo.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name search.pagelumo.com;

    ssl_certificate /etc/letsencrypt/live/search.pagelumo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/search.pagelumo.com/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

- [ ] **Step 2: Verify public URL**

Run from outside the server:

```bash
curl -i https://search.pagelumo.com
```

Expected: HTTP response from the React Router app, not connection refused.

---

### Task 5: Build and migrate on the server

**Files:**
- Runtime only

- [ ] **Step 1: Install Node dependencies and build**

Run on server:

```bash
cd /opt/lens-cart-ai/current
npm ci
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Verify database connectivity**

Run on server:

```bash
cd /opt/lens-cart-ai/current
npm exec prisma migrate status
```

Expected: Prisma can reach the PostgreSQL database.

- [ ] **Step 3: Apply migrations**

Run on server:

```bash
cd /opt/lens-cart-ai/current
npm exec prisma migrate deploy
```

Expected: migration `20260601102101_image_search_phase_1` is applied and table `Session` exists.

- [ ] **Step 4: Start services**

Run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lens-search-embedding
sudo systemctl enable --now lens-search-web
sudo systemctl enable --now lens-search-worker
```

- [ ] **Step 5: Verify local-only services**

Run on server:

```bash
curl -i http://127.0.0.1:8001/health
curl -i -X POST http://127.0.0.1:9300/api/image-search/search -F shop=test-klaehgez.myshopify.com
```

Expected embedding health returns JSON with `ok: true`; app search route returns `Image file is required` for missing file.

---

### Task 6: Python embedding environment

**Files:**
- Review/possibly modify: `services/embedding/pyproject.toml`

- [ ] **Step 1: Prefer Python 3.11 if keeping `torch==2.2.2`**

The current file pins:

```toml
torch==2.2.2
transformers==4.46.3
numpy<2
```

If the server uses Python 3.11, keep this to avoid changing embedding behavior before deployment.

- [ ] **Step 2: If the server only has Python 3.12, upgrade Torch deliberately**

Change `services/embedding/pyproject.toml` to a Python-3.12-compatible Torch version and test before deploying. Example CPU-compatible set:

```toml
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.32.0",
  "python-multipart>=0.0.12",
  "pillow>=11.0.0",
  "requests>=2.32.0",
  "numpy<2",
  "torch==2.5.1",
  "transformers==4.46.3",
]
```

Then run:

```bash
cd services/embedding
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pytest
uvicorn app.main:app --host 127.0.0.1 --port 8001
curl http://127.0.0.1:8001/health
```

Expected: tests pass and `/health` reports dimension `512`.

- [ ] **Step 3: Do not leave the Mac model path in production**

Set:

```env
IMAGE_EMBEDDING_MODEL_LOCAL_DIR=/opt/lens-cart-ai/models/openai-mirror/clip-vit-base-patch32
```

The default code path `/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch32` is local-Mac-specific and must not be relied on server-side.

---

### Task 7: Billing decision before launch

**Files:**
- Review: `app/shopify.server.ts`
- Review: `app/routes/app.billing.tsx`

- [ ] **Step 1: Confirm current code has no active Shopify billing enforcement**

Current `app/shopify.server.ts` has no `billing` object in `shopifyApp(...)`, and `app/routes/app.billing.tsx` displays planned pricing text only.

- [ ] **Step 2: Do not assume `SHOPIFY_BILLING_TEST=false` enables real membership billing**

Setting `SHOPIFY_BILLING_TEST=false` alone will not activate membership billing in this current codebase. Real billing requires either Shopify App Pricing configuration in Partner Dashboard or implementing Shopify Billing API checks and subscription requests in code.

- [ ] **Step 3: For this deployment, keep billing out of the critical path**

Deploy search/index functionality first. Add billing as a separate change after production HTTPS, app proxy, and installation flow are verified.

---

### Task 8: Production storefront testing

**Files:**
- Theme editor setting only

- [ ] **Step 1: Direct backend smoke test**

Run from any machine:

```bash
curl -i -X POST https://search.pagelumo.com/api/image-search/search -F shop=test-klaehgez.myshopify.com
```

Expected:

```json
{"error":"Image file is required"}
```

- [ ] **Step 2: App proxy path test**

In the Shopify Theme Editor or storefront app embed, set:

```text
API base URL = /apps/lens-cart-ai
```

Do not use a `trycloudflare.com` URL in production.

- [ ] **Step 3: Upload an image**

Expected server logs include:

```text
image_search.request_started
image_search.completed
```

Expected UI shows product cards.

- [ ] **Step 4: Verify app proxy config**

If `/apps/lens-cart-ai` does not reach the server, check Shopify app config first. The app proxy must point to `https://search.pagelumo.com/api`, not `https://example.com/api` and not a tunnel URL.

---

## Self-Review

**Spec coverage:** Covers server domain/port, no public app port exposure, new Shopify app application URL, env changes, multi-store data behavior, Python/Torch compatibility, billing test mode, app proxy production testing, and internal database/Redis/Milvus addresses.

**Placeholder scan:** Secrets and unknown company-internal hosts are intentionally represented as secret placeholders because they must not be committed or written into the repo. The plan specifies exact env keys and where the real values must be placed.

**Type consistency:** File paths and env names match the inspected codebase: `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `IMAGE_EMBEDDING_SERVICE_URL`, `MILVUS_*`, `REDIS_URL`, `SHOPIFY_APP_PROXY_PREFIX`, and `STOREFRONT_CORS_ORIGINS`.
