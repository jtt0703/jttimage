# Shopify Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lens Search stable on the company server, remove Shopify App Store review blockers, and produce a repeatable deployment path.

**Architecture:** Keep the current external entrypoint `https://search.pagelumo.com` and local app port `127.0.0.1:9300`. Move Web/API, Product Index Worker, and Embedding service from terminal/nohup-style processes into the existing LensCart Docker Compose project under `/home/shopify_ops/lens-cart-ai`. Add missing Shopify compliance routes/config, production health checks, and review-safe app copy.

**Tech Stack:** React Router 7, Shopify App React Router, Prisma/PostgreSQL, BullMQ/Redis, Milvus, MinIO/S3-compatible storage, Python uvicorn embedding service, Docker Compose, Nginx, Shopify CLI.

---

## Scope Guardrail

- All repository edits happen only under `/Users/apple/Desktop/jttapp/lens-cart-ai`.
- All application deployment edits happen only under `/home/shopify_ops/lens-cart-ai`.
- Do not modify, stop, restart, remove, or firewall services that belong to other projects on `65.108.76.202`.
- Commands that inspect global server state are read-only and must be filtered before acting.
- Do not install or modify user/global process managers such as `systemd`, `pm2`, Nginx, Cloudflare, firewall rules, or files outside `/home/shopify_ops/lens-cart-ai`.
- Never use broad process-kill commands such as `pkill -f 'npm run start'`; stop only verified LensCart PIDs whose cwd is `/home/shopify_ops/lens-cart-ai/current` or `/home/shopify_ops/lens-cart-ai/current/services/embedding`.

---

## File Structure

- Modify: `shopify.app.lens-search.toml`
  - Add mandatory privacy compliance webhooks and keep production URLs on `https://search.pagelumo.com`.
- Create: `app/routes/webhooks.customers.data_request.tsx`
  - Authenticate `customers/data_request` compliance webhook and return 200.
- Create: `app/routes/webhooks.customers.redact.tsx`
  - Authenticate `customers/redact` compliance webhook and return 200.
- Create: `app/routes/webhooks.shop.redact.tsx`
  - Authenticate `shop/redact` compliance webhook and return 200.
- Create: `app/routes/api.health.tsx`
  - Return a lightweight JSON health response for process and reverse-proxy checks.
- Modify: `app/root.tsx`
  - Add a root error boundary so public 404/500 responses do not show React Router's default developer page.
- Modify: `app/routes/_index/route.tsx`
  - Replace template landing copy with review-safe Lens Search copy.
- Modify: `app/routes/_index/styles.module.css`
  - Keep the public login page responsive and readable.
- Modify: test files with `as any` lint errors:
  - `app/routes.api.favorites.delete.test.tsx`
  - `app/routes.api.favorites.test.tsx`
  - `app/routes.api.image-search.index-products.test.tsx`
  - `app/routes.app-index-copy.test.ts`
  - `app/routes.app.billing.test.tsx`
  - `app/routes.webhooks.app.uninstalled.test.tsx`
- Create: `services/embedding/Dockerfile`
- Modify on server: `/home/shopify_ops/lens-cart-ai/docker-compose.yml`
  - Add only LensCart-owned `web`, `worker`, and `embedding` services.
- Modify on server: `/home/shopify_ops/lens-cart-ai/shared/.env`
  - Set live billing mode and verify production values.

---

### Task 1: Freeze Current State And Add A Rollback Point

**Files:**
- Read-only verification: `/home/shopify_ops/lens-cart-ai/current`
- Read-only verification: `/home/shopify_ops/lens-cart-ai/shared/.env`
- Read-only verification: `/home/shopify_ops/lens-cart-ai/docker-compose.yml`

- [ ] **Step 1: Capture server process state**

Run on server:

```bash
date -Is
cd /home/shopify_ops/lens-cart-ai
printf '## app procs\n'
ps -eo pid,ppid,user,lstart,cmd --sort=start_time | grep -F '/home/shopify_ops/lens-cart-ai' | grep -v grep || true
printf '## app ports\n'
ss -ltnp 2>/dev/null | grep -E ':9300|:9301|:25432|:26379|:29530|:29000|:29001' || true
printf '## compose ps\n'
docker compose --env-file shared/.env -f docker-compose.yml ps
```

Expected: Web listens on `127.0.0.1:9300`, embedding listens on `127.0.0.1:9301`, and Docker services are healthy.

- [ ] **Step 2: Create a dated server backup**

Run on server:

```bash
set -euo pipefail
backup_dir="/home/shopify_ops/lens-cart-ai/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp -a /home/shopify_ops/lens-cart-ai/current "$backup_dir/current"
cp -a /home/shopify_ops/lens-cart-ai/docker-compose.yml "$backup_dir/docker-compose.yml"
cp -a /home/shopify_ops/lens-cart-ai/shared/.env "$backup_dir/shared.env"
chmod 600 "$backup_dir/shared.env"
echo "$backup_dir"
```

Expected: Command prints the backup directory path and exits 0.

- [ ] **Step 3: Verify local baseline**

Run locally from `/Users/apple/Desktop/jttapp/lens-cart-ai`:

```bash
npm test
npm run typecheck
npm run build
npm run lint
```

Expected before fixes: `test`, `typecheck`, and `build` pass; `lint` fails only on `no-explicit-any` in test files.

---

### Task 2: Move Runtime Processes Into LensCart Docker Compose

**Files:**
- Create: `services/embedding/Dockerfile`
- Modify on server: `/home/shopify_ops/lens-cart-ai/docker-compose.yml`
- Read-only verification on server: `/home/shopify_ops/lens-cart-ai/current`

- [ ] **Step 1: Create embedding Dockerfile in the repo**

Create `/Users/apple/Desktop/jttapp/lens-cart-ai/services/embedding/Dockerfile`:

```dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY services/embedding/pyproject.toml ./pyproject.toml
COPY services/embedding/app ./app

RUN pip install --no-cache-dir -e .

EXPOSE 9301

CMD ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "9301"]
```

- [ ] **Step 2: Build-check the existing Node Dockerfile locally**

Run locally from `/Users/apple/Desktop/jttapp/lens-cart-ai`:

```bash
docker build -t lenscart-web-check .
```

Expected: Image builds successfully. If it fails on production dependencies missing `tsx` for the worker, change the deployment approach so the worker image installs all dependencies or builds a dedicated worker image in this same project directory.

- [ ] **Step 3: Add only LensCart-owned services to server Compose file**

On server, modify only `/home/shopify_ops/lens-cart-ai/docker-compose.yml`. Add these services to the existing `services:` map without changing unrelated services:

```yaml
  web:
    container_name: lenscart-web
    build:
      context: ./current
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - ./shared/.env
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 9300
      DATABASE_URL: postgresql://lenscart:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      MILVUS_ADDRESS: milvus:19530
      IMAGE_EMBEDDING_SERVICE_URL: http://embedding:9301
      UPLOAD_STORAGE_ENDPOINT: http://minio:9000
      IMAGE_EMBEDDING_MODEL_LOCAL_DIR: /models/openai-mirror/clip-vit-base-patch32
    ports:
      - "127.0.0.1:9300:9300"
    volumes:
      - ./models:/models:ro
      - ./shared/logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      milvus:
        condition: service_healthy
      embedding:
        condition: service_started

  worker:
    container_name: lenscart-worker
    build:
      context: ./current
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - ./shared/.env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://lenscart:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      MILVUS_ADDRESS: milvus:19530
      IMAGE_EMBEDDING_SERVICE_URL: http://embedding:9301
      UPLOAD_STORAGE_ENDPOINT: http://minio:9000
      IMAGE_EMBEDDING_MODEL_LOCAL_DIR: /models/openai-mirror/clip-vit-base-patch32
    command: ["npm", "run", "worker:product-index"]
    volumes:
      - ./models:/models:ro
      - ./shared/logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      milvus:
        condition: service_healthy
      embedding:
        condition: service_started

  embedding:
    container_name: lenscart-embedding
    build:
      context: ./current
      dockerfile: services/embedding/Dockerfile
    restart: unless-stopped
    env_file:
      - ./shared/.env
    environment:
      IMAGE_EMBEDDING_MODEL_LOCAL_DIR: /models/openai-mirror/clip-vit-base-patch32
      EMBEDDING_MAX_CONCURRENCY: "1"
      LOG_LEVEL: info
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9301"]
    ports:
      - "127.0.0.1:9301:9301"
    volumes:
      - ./models:/models:ro
      - ./shared/logs:/app/logs
```

Expected: Only `/home/shopify_ops/lens-cart-ai/docker-compose.yml` changes on the server.

- [ ] **Step 4: Validate Compose config from the LensCart directory**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai
docker compose --env-file shared/.env -f docker-compose.yml config >/tmp/lenscart-compose-check.yml
docker compose --env-file shared/.env -f docker-compose.yml config --services
```

Expected services include only this project's Compose services, including `web`, `worker`, and `embedding`. Do not run this command from any other directory.

- [ ] **Step 5: Build only LensCart app containers**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai
docker compose --env-file shared/.env -f docker-compose.yml build web worker embedding
```

Expected: The three LensCart images build successfully.

- [ ] **Step 6: Stop terminal/nohup processes by verified LensCart PID only**

Run on server:

```bash
for pattern in \
  '/home/shopify_ops/lens-cart-ai/current/node_modules/.bin/react-router-serve' \
  'app/workers/product-index.worker.ts' \
  'uvicorn app.main:app --host 127.0.0.1 --port 9301'; do
  for pid in $(pgrep -f "$pattern" || true); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    ppid="$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null || true)"
    pcwd="$(readlink -f "/proc/$ppid/cwd" 2>/dev/null || true)"
    echo "pid=$pid pattern=$pattern cwd=$cwd ppid=$ppid pcwd=$pcwd"
    case "$cwd" in
      /home/shopify_ops/lens-cart-ai/current|/home/shopify_ops/lens-cart-ai/current/services/embedding)
        kill "$pid"
        ;;
    esac
  done
done
sleep 2
```

Expected: Only processes whose cwd is inside `/home/shopify_ops/lens-cart-ai/current` are killed. No other project process is touched.

- [ ] **Step 7: Start only LensCart app containers**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai
docker compose --env-file shared/.env -f docker-compose.yml up -d postgres redis etcd minio minio-init milvus embedding worker web
docker compose --env-file shared/.env -f docker-compose.yml ps
```

Expected: `lenscart-web`, `lenscart-worker`, and `lenscart-embedding` are up, and existing LensCart data services remain healthy.

- [ ] **Step 8: Verify app through local and public entrypoints**

Run on server:

```bash
curl -fsS http://127.0.0.1:9300/auth/login >/dev/null && echo web-ok
curl -fsS http://127.0.0.1:9301/docs >/dev/null && echo embedding-ok
```

Run locally:

```bash
curl -k -fsS https://search.pagelumo.com/auth/login >/dev/null && echo public-ok
```

Expected: `web-ok`, `embedding-ok`, and `public-ok`.

---

### Task 3: Add Shopify Privacy Compliance Webhooks

**Files:**
- Modify: `shopify.app.lens-search.toml`
- Create: `app/routes/webhooks.customers.data_request.tsx`
- Create: `app/routes/webhooks.customers.redact.tsx`
- Create: `app/routes/webhooks.shop.redact.tsx`

- [ ] **Step 1: Write compliance webhook tests**

Create `app/routes.webhooks.compliance.test.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
}));

function args(topic: string): ActionFunctionArgs {
  return {
    request: new Request(`http://localhost/webhooks/${topic}`, { method: "POST" }),
    params: {},
    context: {},
  };
}

describe("privacy compliance webhooks", () => {
  it("acknowledges customers/data_request", async () => {
    mocks.authenticateWebhook.mockResolvedValueOnce({
      shop: "demo.myshopify.com",
      topic: "CUSTOMERS_DATA_REQUEST",
      payload: { shop_domain: "demo.myshopify.com" },
    });
    const { action } = await import("./routes/webhooks.customers.data_request");
    const response = await action(args("customers/data_request"));
    expect(response.status).toBe(200);
  });

  it("acknowledges customers/redact", async () => {
    mocks.authenticateWebhook.mockResolvedValueOnce({
      shop: "demo.myshopify.com",
      topic: "CUSTOMERS_REDACT",
      payload: { shop_domain: "demo.myshopify.com" },
    });
    const { action } = await import("./routes/webhooks.customers.redact");
    const response = await action(args("customers/redact"));
    expect(response.status).toBe(200);
  });

  it("acknowledges shop/redact", async () => {
    mocks.authenticateWebhook.mockResolvedValueOnce({
      shop: "demo.myshopify.com",
      topic: "SHOP_REDACT",
      payload: { shop_domain: "demo.myshopify.com" },
    });
    const { action } = await import("./routes/webhooks.shop.redact");
    const response = await action(args("shop/redact"));
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run compliance tests and verify they fail**

Run:

```bash
npm test -- app/routes.webhooks.compliance.test.tsx
```

Expected: Fails because the three route modules do not exist.

- [ ] **Step 3: Implement `customers/data_request` route**

Create `app/routes/webhooks.customers.data_request.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info({ event: "privacy_webhook.received", shopDomain: shop, topic }, "customer data request webhook received");
  return new Response(null, { status: 200 });
};
```

- [ ] **Step 4: Implement `customers/redact` route**

Create `app/routes/webhooks.customers.redact.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";

type CustomerRedactPayload = {
  shop_domain?: string;
  customer?: { id?: number | string };
  customer_id?: number | string;
};

function customerGidFromPayload(payload: CustomerRedactPayload): string | null {
  const id = payload.customer?.id ?? payload.customer_id;
  return id ? `gid://shopify/Customer/${id}` : null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const customerGid = customerGidFromPayload(payload as CustomerRedactPayload);

  if (customerGid) {
    await prisma.favoriteProduct.deleteMany({
      where: { shopDomain: shop, identityType: "customer", identityId: customerGid },
    });
    await prisma.imageSearchUpload.deleteMany({
      where: { shopDomain: shop, customerGid },
    });
  }

  logger.info(
    { event: "privacy_webhook.processed", shopDomain: shop, topic, customerGidPresent: Boolean(customerGid) },
    "customer redact webhook processed",
  );
  return new Response(null, { status: 200 });
};
```

- [ ] **Step 5: Implement `shop/redact` route**

Create `app/routes/webhooks.shop.redact.tsx`:

```tsx
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await prisma.favoriteProduct.deleteMany({ where: { shopDomain: shop } });
  await prisma.imageSearchUpload.deleteMany({ where: { shopDomain: shop } });
  await prisma.productIndexJob.deleteMany({ where: { shopDomain: shop } });
  await prisma.shopProduct.deleteMany({ where: { shopDomain: shop } });
  await prisma.session.deleteMany({ where: { shop } });

  logger.info({ event: "privacy_webhook.processed", shopDomain: shop, topic }, "shop redact webhook processed");
  return new Response(null, { status: 200 });
};
```

- [ ] **Step 6: Add compliance webhook subscriptions**

Modify `shopify.app.lens-search.toml` under `[webhooks]`:

```toml
  [[webhooks.subscriptions]]
  uri = "/webhooks/customers/data_request"
  topics = [ "customers/data_request" ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/customers/redact"
  topics = [ "customers/redact" ]

  [[webhooks.subscriptions]]
  uri = "/webhooks/shop/redact"
  topics = [ "shop/redact" ]
```

- [ ] **Step 7: Verify compliance tests pass**

Run:

```bash
npm test -- app/routes.webhooks.compliance.test.tsx
```

Expected: Test file passes.

---

### Task 4: Add Health Endpoint And Friendly Root Error Boundary

**Files:**
- Create: `app/routes/api.health.tsx`
- Modify: `app/root.tsx`

- [x] **Step 1: Write health route test**

Create `app/routes.api.health.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { loader } from "./routes/api.health";

describe("api health route", () => {
  it("returns ok json", async () => {
    const response = await loader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "lens-cart-ai",
    });
  });
});
```

- [x] **Step 2: Run health test and verify it fails**

Run:

```bash
npm test -- app/routes.api.health.test.tsx
```

Expected: Fails because `./routes/api.health` does not exist.

- [x] **Step 3: Implement health route**

Create `app/routes/api.health.tsx`:

```tsx
export const loader = async () => {
  return Response.json({
    ok: true,
    service: "lens-cart-ai",
    timestamp: new Date().toISOString(),
  });
};
```

- [x] **Step 4: Add root error boundary**

Modify `app/root.tsx`:

```tsx
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title = status === 404 ? "Page not found" : "Something went wrong";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
      </head>
      <body>
        <main style={{ fontFamily: "Inter, system-ui, sans-serif", margin: "4rem auto", maxWidth: "36rem", padding: "0 1.5rem" }}>
          <h1>{title}</h1>
          <p>Lens Search could not load this page. Please return to Shopify admin or try again in a moment.</p>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
```

- [x] **Step 5: Verify health endpoint**

Run locally:

```bash
npm test -- app/routes.api.health.test.tsx
npm run typecheck
npm run build
```

Expected: All commands exit 0.

---

### Task 5: Replace Template Landing Copy

**Files:**
- Modify: `app/routes/_index/route.tsx`
- Modify: `app/routes/_index/styles.module.css`

- [x] **Step 1: Add copy test**

Create or extend `app/routes.app-index-copy.test.ts` with:

```ts
it("uses production public landing copy", () => {
  const source = readFileSync(join(process.cwd(), "app/routes/_index/route.tsx"), "utf8");

  expect(source).toContain("Lens Search");
  expect(source).toContain("AI image search for Shopify storefronts");
  expect(source).toContain("Upload an image, find matching products, and save favorites");
  expect(source).not.toContain("A short heading about [your app]");
  expect(source).not.toContain("A tagline about [your app]");
  expect(source).not.toContain("Product feature");
});
```

- [x] **Step 2: Run copy test and verify it fails**

Run:

```bash
npm test -- app/routes.app-index-copy.test.ts
```

Expected: Fails because current public copy is still template copy.

- [x] **Step 3: Update public route copy**

Replace the JSX inside `app/routes/_index/route.tsx` with:

```tsx
return (
  <main className={styles.index}>
    <section className={styles.content}>
      <p className={styles.eyebrow}>Lens Search</p>
      <h1 className={styles.heading}>AI image search for Shopify storefronts</h1>
      <p className={styles.text}>
        Upload an image, find matching products, and save favorites from a Shopify storefront experience.
      </p>
      {showForm && (
        <Form className={styles.form} method="post" action="/auth/login">
          <label className={styles.label}>
            <span>Shop domain</span>
            <input className={styles.input} type="text" name="shop" placeholder="example.myshopify.com" />
          </label>
          <button className={styles.button} type="submit">
            Log in
          </button>
        </Form>
      )}
      <ul className={styles.list}>
        <li>Image-based product discovery</li>
        <li>Storefront favorites and upload history</li>
        <li>Background product indexing from Shopify webhooks</li>
      </ul>
    </section>
  </main>
);
```

- [x] **Step 4: Update CSS**

Replace `app/routes/_index/styles.module.css` with:

```css
.index {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: #f7f8f8;
  color: #202223;
}

.content {
  width: min(42rem, 100%);
  display: grid;
  gap: 1.25rem;
}

.eyebrow {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #008060;
}

.heading,
.text {
  margin: 0;
}

.heading {
  font-size: clamp(2rem, 7vw, 4rem);
  line-height: 1;
}

.text {
  font-size: 1.125rem;
  line-height: 1.6;
  color: #4a4f53;
}

.form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.75rem;
  padding-top: 0.5rem;
}

.label {
  display: grid;
  gap: 0.35rem;
  min-width: min(20rem, 100%);
  font-size: 0.95rem;
  font-weight: 600;
}

.input {
  min-height: 2.75rem;
  border: 1px solid #8c9196;
  border-radius: 6px;
  padding: 0 0.75rem;
  font: inherit;
}

.button {
  min-height: 2.75rem;
  border: 0;
  border-radius: 6px;
  padding: 0 1rem;
  background: #008060;
  color: white;
  font: inherit;
  font-weight: 700;
}

.list {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 0 0;
  margin: 0;
  list-style-position: inside;
  color: #4a4f53;
}
```

- [x] **Step 5: Verify public copy**

Run:

```bash
npm test -- app/routes.app-index-copy.test.ts
npm run build
```

Expected: Both commands exit 0.

---

### Task 6: Fix Lint Failures In Tests

**Files:**
- Modify: `app/routes.api.favorites.delete.test.tsx`
- Modify: `app/routes.api.favorites.test.tsx`
- Modify: `app/routes.api.image-search.index-products.test.tsx`
- Modify: `app/routes.app-index-copy.test.ts`
- Modify: `app/routes.app.billing.test.tsx`
- Modify: `app/routes.webhooks.app.uninstalled.test.tsx`

- [x] **Step 1: Replace `as any` with `ActionFunctionArgs` or `LoaderFunctionArgs` helpers**

For action-only helpers, use:

```tsx
import type { ActionFunctionArgs } from "react-router";

function actionArgs(request: Request): ActionFunctionArgs {
  return { request, params: {}, context: {} };
}
```

For loader-only helpers, use:

```tsx
import type { LoaderFunctionArgs } from "react-router";

function loaderArgs(request: Request): LoaderFunctionArgs {
  return { request, params: {}, context: {} };
}
```

For files using both loader and action helpers, import both:

```tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
```

- [x] **Step 2: Update `app/routes.webhooks.app.uninstalled.test.tsx`**

Replace the inline cast:

```tsx
const response = await action({
  request: new Request("http://localhost/webhooks/app/uninstalled", { method: "POST" }),
  params: {},
  context: {},
} as any);
```

with:

```tsx
import type { ActionFunctionArgs } from "react-router";

function actionArgs(request: Request): ActionFunctionArgs {
  return { request, params: {}, context: {} };
}

const response = await action(
  actionArgs(new Request("http://localhost/webhooks/app/uninstalled", { method: "POST" })),
);
```

- [x] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: Exits 0.

---

### Task 7: Switch Production Billing Out Of Test Mode

**Files:**
- Modify on server: `/home/shopify_ops/lens-cart-ai/shared/.env`

- [x] **Step 1: Confirm current billing values**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai/current
grep -E '^(SHOPIFY_BILLING_TEST|BILLING_PLAN_NAME|BILLING_MONTHLY_PRICE|BILLING_CURRENCY_CODE|BILLING_TRIAL_DAYS)=' .env
```

Expected before change: `SHOPIFY_BILLING_TEST=true`.

- [x] **Step 2: Change billing mode**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai
cp shared/.env "shared/.env.before-live-billing.$(date +%Y%m%d-%H%M%S)"
perl -0pi -e 's/^SHOPIFY_BILLING_TEST=.*/SHOPIFY_BILLING_TEST=false/m' shared/.env
grep -E '^(SHOPIFY_BILLING_TEST|BILLING_PLAN_NAME|BILLING_MONTHLY_PRICE|BILLING_CURRENCY_CODE|BILLING_TRIAL_DAYS)=' shared/.env
```

Expected: `SHOPIFY_BILLING_TEST=false`, plan name and price match the Partner Dashboard listing.

- [x] **Step 3: Restart Web and Worker**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai
docker compose --env-file shared/.env -f docker-compose.yml restart web worker
docker compose --env-file shared/.env -f docker-compose.yml ps web worker
```

Expected: `lenscart-web` and `lenscart-worker` are running.

---

### Task 8: Verify Network Exposure And Ask Ops To Close Shared-Server Risks

**Files:**
- No code files.
- Do not change server firewall, hosting provider firewall, or non-LensCart containers in this plan.

- [x] **Step 1: Verify LensCart ports are loopback-only**

Run on server:

```bash
ss -ltnp 2>/dev/null | grep -E ':9300|:9301|:25432|:26379|:29530|:29000|:29001'
```

Expected:

```text
127.0.0.1:9300
127.0.0.1:9301
127.0.0.1:25432
127.0.0.1:26379
127.0.0.1:29530
127.0.0.1:29000
127.0.0.1:29001
```

- [x] **Step 2: Verify public access only uses 80/443**

Run from a local machine:

```bash
for port in 80 443 9300 9301 25432 26379 29530 29000 29001; do
  printf '65.108.76.202:%s ' "$port"
  nc -vz -w 3 65.108.76.202 "$port"
done
```

Expected: `80` and `443` connect; LensCart private ports time out or fail.

- [x] **Step 3: Escalate unrelated exposed server ports**

Send this to company ops:

```text
The LensCart app binds its own database, Redis, Milvus, MinIO, Web, and embedding ports to 127.0.0.1. During review we found the same shared server exposes other services on public IP ports 8001, 19530, and 9091. Please confirm ownership and close or firewall these ports if they are not intentionally public.
```

Expected: Ops either closes the ports or confirms they are intentionally exposed and protected.

Do not stop, restart, or firewall those ports from this LensCart task unless company ops confirms they belong to LensCart.

---

### Task 9: Deploy Shopify App Configuration

**Files:**
- Modify if needed: `shopify.app.lens-search.toml`
- Shopify Partner Dashboard app config.

- [x] **Step 1: Confirm production config**

Run locally:

```bash
grep -E '^(client_id|name|application_url|embedded)' shopify.app.lens-search.toml
grep -A3 '^\[auth\]' shopify.app.lens-search.toml
grep -A30 '^\[webhooks\]' shopify.app.lens-search.toml
grep -A4 '^\[app_proxy\]' shopify.app.lens-search.toml
```

Expected:

```text
application_url = "https://search.pagelumo.com"
redirect_urls = [ "https://search.pagelumo.com/auth/callback" ]
app_proxy url = "/api", prefix = "apps", subpath = "lens-cart-ai"
privacy webhooks are present
```

- [x] **Step 2: Deploy Shopify app config**

Run locally after logging in to Shopify CLI:

```bash
npm run deploy -- --config shopify.app.lens-search.toml
```

Expected: Shopify CLI creates a new app version and reports a successful release. This does not deploy server code.

- [x] **Step 3: Reinstall or open app on the test store**

Open the app from Shopify admin for the test store and verify:

```text
Admin app loads inside Shopify iframe.
Billing page opens and creates a live-mode confirmation flow.
Storefront app proxy calls use /apps/lens-cart-ai/api/... and return 200.
```

Expected: OAuth, app proxy, and billing all work with `https://search.pagelumo.com`.

---

### Task 10: Final Verification Before App Store Submission

**Files:**
- No code files unless a verification fails.

- [x] **Step 1: Run full local verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: All commands exit 0.

Completed 2026-06-15:

```text
npm test: PASS (30 test files, 106 tests)
npm run typecheck: PASS
npm run lint: PASS
npm run build: PASS
```

- [x] **Step 2: Run server verification**

Run on server:

```bash
cd /home/shopify_ops/lens-cart-ai
docker compose --env-file shared/.env -f docker-compose.yml ps web worker embedding postgres redis milvus minio
curl -fsS http://127.0.0.1:9300/api/health
curl -fsS http://127.0.0.1:9301/docs >/dev/null && echo embedding-docs-ok
```

Expected:

```text
health JSON contains "ok":true
embedding-docs-ok
Docker services are healthy
```

Completed 2026-06-15:

```text
Synced local source to /home/shopify_ops/lens-cart-ai/current.
Backup created at /home/shopify_ops/lens-cart-ai/backups/task10-sync-20260615-145503.
Rebuilt and restarted web, worker, and embedding containers.
Docker services were up; postgres, redis, milvus, and minio were healthy.
Local server health returned {"ok":true,"service":"lens-cart-ai",...}.
Embedding docs returned embedding-docs-ok.
```

- [x] **Step 3: Run public verification**

Run locally:

```bash
curl -k -fsS https://search.pagelumo.com/api/health
curl -k -fsS https://search.pagelumo.com/auth/login >/dev/null && echo auth-login-ok
```

Expected: Health JSON contains `"ok":true`; `auth-login-ok` prints.

Completed 2026-06-15:

```text
https://search.pagelumo.com/api/health returned {"ok":true,"service":"lens-cart-ai",...}.
https://search.pagelumo.com/auth/login returned auth-login-ok.
```

- [ ] **Step 4: Prepare Shopify App Store listing**

In Shopify Partner Dashboard, fill:

```text
App name: Lens Search
Production URL: https://search.pagelumo.com
Allowed redirection URL: https://search.pagelumo.com/auth/callback
App proxy: /apps/lens-cart-ai -> https://search.pagelumo.com/api
Pricing: Starter, USD 7.99/month, 14-day trial
Support email: company support mailbox
Privacy policy URL: company privacy policy URL
Terms URL: company terms URL
Test instructions: include test store domain, steps to install, steps to run image search, favorite, upload history, and billing confirmation.
```

Expected: Partner Dashboard has no missing listing fields.

Status 2026-06-15: blocked on Partner Dashboard manual entry/review. Shopify CLI verified the app config for Lens Search, including production URL, auth callback, app proxy, scopes, and compliance webhooks, but CLI does not expose App Store listing field completion.

- [ ] **Step 5: Run Shopify automated checks and submit**

In Partner Dashboard:

```text
Apps -> Lens Search -> Distribution or App Store listing -> Run automated checks -> Fix every reported issue -> Submit for review.
```

Expected: Automated checks pass before submission.

Status 2026-06-15: blocked on Partner Dashboard manual action. Shopify CLI shows an active Lens Search app version created 2026-06-15 06:23:04 UTC, but automated App Store checks and submission must be run from the Partner Dashboard.

---

## Self-Review

**Spec coverage:** The plan covers runtime reliability, duplicate process cleanup, Shopify compliance webhooks, live billing, public copy, health endpoint, lint failures, exposed shared-server ports, Shopify config deployment, and final submission.

**Placeholder scan:** No steps use TBD/TODO or vague "handle later" language.

**Type consistency:** Test helper signatures use `ActionFunctionArgs` and `LoaderFunctionArgs`; route filenames match React Router fs-routes conventions; Compose service names match verification commands.
