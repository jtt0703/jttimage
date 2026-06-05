# LensCart AI Production Runbook

本文档用于上线部署和排查当前图片搜索/商品图片索引链路。

## 1. 服务组成

生产环境至少需要启动以下服务：

1. **Web/API 服务**
   - 启动命令：`npm run start`
   - 负责 Shopify Admin 页面、Storefront App Proxy API、webhook 接收、图片搜索同步响应。

2. **Product Index Worker**
   - 启动命令：`npm run worker:product-index`
   - 负责消费 BullMQ 队列中的商品图片索引任务。
   - 如果不启动，后台索引 job 会停留在 `queued`。

3. **Redis**
   - BullMQ 队列依赖。
   - 环境变量：`REDIS_URL`。

4. **PostgreSQL**
   - 主数据源，保存 Shopify 商品、图片、variant、索引状态、用户上传记录。

5. **Milvus**
   - 向量检索索引。
   - 当前策略：每个店铺一个 collection。

6. **Embedding Python 服务**
   - 启动示例：
     ```bash
     cd services/embedding
     uvicorn app.main:app --host 127.0.0.1 --port 8001
     ```
   - CPU 环境建议：`EMBEDDING_MAX_CONCURRENCY=1` 或 `2`。

7. **S3-compatible object storage**
   - bucket：`shopify-image`
   - 当前用于保存用户上传搜索图片的原图和缩略图。

## 2. 必要环境变量

### Web/API 与 Worker 公共变量

```env
DATABASE_URL=postgresql://...

SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://...
SCOPES=write_products,write_metaobjects,write_metaobject_definitions,write_app_proxy

REDIS_URL=redis://127.0.0.1:6379
PRODUCT_INDEX_QUEUE_CONCURRENCY=1
LOG_LEVEL=info
```

### S3/RustFS/MinIO 兼容存储

```env
UPLOAD_STORAGE_PROVIDER=s3
UPLOAD_STORAGE_BUCKET=shopify-image
UPLOAD_STORAGE_ENDPOINT=http://91.98.177.221:9000
UPLOAD_STORAGE_REGION=us-east-1
UPLOAD_STORAGE_ACCESS_KEY_ID=...
UPLOAD_STORAGE_SECRET_ACCESS_KEY=...
UPLOAD_STORAGE_FORCE_PATH_STYLE=true
UPLOAD_STORE_ORIGINALS=true
```

如果后续配置 CDN 公网访问缩略图，可加：

```env
UPLOAD_STORAGE_PUBLIC_BASE_URL=https://cdn.novaads.ai/...
```

如果不配置 `UPLOAD_STORAGE_PUBLIC_BASE_URL`，前端会继续通过 App Proxy 的 `/storage/uploads/*` 路由代理读取对象。

### Embedding 服务

Node 侧：

```env
IMAGE_EMBEDDING_SERVICE_URL=http://127.0.0.1:8001
IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch32
IMAGE_EMBEDDING_MODEL_ALIAS=clip-vit-b-32
IMAGE_EMBEDDING_DIMENSION=512
IMAGE_EMBEDDING_REQUEST_TIMEOUT_MS=45000
IMAGE_EMBEDDING_REQUEST_RETRIES=1
IMAGE_EMBEDDING_CIRCUIT_FAILURE_THRESHOLD=5
IMAGE_EMBEDDING_CIRCUIT_RESET_MS=60000
IMAGE_SEARCH_SYNC_TIMEOUT_MS=90000
IMAGE_SEARCH_MIN_SIMILARITY_SCORE=0.25
```

Python 侧：

```env
IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch32
IMAGE_EMBEDDING_MODEL_ALIAS=clip-vit-b-32
IMAGE_EMBEDDING_DIMENSION=512
IMAGE_EMBEDDING_MODEL_LOCAL_DIR=/path/to/openai-mirror/clip-vit-base-patch32
EMBEDDING_MAX_CONCURRENCY=1
IMAGE_URL_FETCH_TIMEOUT_SECONDS=20
LOG_LEVEL=info
```

### Milvus

```env
MILVUS_ADDRESS=127.0.0.1:19530
MILVUS_USERNAME=root
MILVUS_PASSWORD=
MILVUS_COLLECTION=product_image_embeddings_512
MILVUS_COLLECTION_PREFIX=product_image_embeddings
MILVUS_METRIC_TYPE=IP
```

说明：

- `MILVUS_COLLECTION` 保留为兼容 fallback。
- 实际线上查询/索引会按 `shopDomain + modelAlias + dimension + prefix` 生成每店 collection。

### Shopify 商品同步

```env
SHOPIFY_PRODUCT_QUERY=status:active
SHOPIFY_PRODUCTS_PAGE_SIZE=50
SHOPIFY_MEDIA_PAGE_SIZE=25
SHOPIFY_VARIANTS_PAGE_SIZE=50
```

## 3. 部署步骤

### 3.1 安装依赖

```bash
npm install
```

### 3.2 数据库迁移和 Prisma 生成

```bash
npm run setup
```

等价于：

```bash
npx prisma generate
npx prisma migrate deploy
```

### 3.3 构建 Web/API

```bash
npm run build
```

### 3.4 启动 Web/API

```bash
npm run start
```

### 3.5 启动 Product Index Worker

单独进程启动：

```bash
npm run worker:product-index
```

建议部署为独立 worker dyno/container/process，不要只依赖 Web/API 进程。

## 4. 首次上线后的索引重建

本次改造将 Milvus 改为每店一个 collection，并且模型统一到 `clip-vit-base-patch32`。旧 patch16 或旧 shared collection 数据不应继续混用。

推荐步骤：

1. 部署 Web/API 和 Worker。
2. 确认 Redis、PostgreSQL、Milvus、Embedding 服务都可用。
3. 在 Admin 页面对店铺触发 `force` re-index。
4. 或调用索引 API，使 job 入队。
5. 确认 `product_index_jobs` 状态：
   - `queued` → `running` → `completed`
6. 确认 `shop_product_images`：
   - `embedding_status = 'indexed'`
   - `milvus_collection` 为每店 collection，而不是旧 shared collection。
7. 抽样 storefront 图片搜索，确认结果只来自当前店铺。

如需批量重建所有店铺，建议后续增加一个 admin-only 脚本批量为所有 `Session.shop` 创建 `force` job。

## 5. 关键日志事件

### 图片搜索

- `image_search.request_started`
- `upload_storage.save_started`
- `upload_storage.save_completed`
- `embedding.request_started`
- `embedding.request_completed`
- `milvus.search_completed`
- `image_search.completed`
- `image_search.failed`
- `image_search.timeout`

### 商品索引

- `product_index.enqueue_requested`
- `product_index.enqueued`
- `product_index.worker_job_started`
- `product_index.started`
- `product_index.image_indexed`
- `product_index.image_failed`
- `product_index.completed`
- `product_index.failed`

### Milvus

- `milvus.collection_resolved`
- `milvus.collection_created`
- `milvus.collection_loaded`
- `milvus.upsert_completed`
- `milvus.search_completed`
- `milvus.delete_completed`
- `milvus.error`

### Shopify sync/webhook

- `shopify_sync.page_fetch_started`
- `shopify_sync.page_fetch_completed`
- `shopify_sync.pagination_warning`
- `shopify_sync.product_upserted`
- `shopify_webhook.received`
- `shopify_webhook.enqueued`
- `shopify_webhook.processed`
- `shopify_webhook.failed`

## 6. 常见问题排查

### 6.1 索引 job 一直 queued

检查：

1. Worker 是否启动：
   ```bash
   npm run worker:product-index
   ```
2. `REDIS_URL` 是否一致。
3. Redis 是否可连。
4. 日志中是否有：
   - `product_index.worker_started`
   - `product_index.worker_job_started`

### 6.2 图片搜索超时

检查：

1. Python embedding 服务是否正常：
   ```bash
   curl http://127.0.0.1:8001/health
   ```
2. CPU 环境下 `EMBEDDING_MAX_CONCURRENCY` 是否过大。
3. 是否需要提高：
   ```env
   IMAGE_EMBEDDING_REQUEST_TIMEOUT_MS=60000
   IMAGE_SEARCH_SYNC_TIMEOUT_MS=90000
   ```
4. 日志中查看：
   - `embedding.request_timeout`
   - `image_search.timeout`

### 6.3 返回结果为空

检查：

1. 商品是否已完成索引：
   ```sql
   SELECT embedding_status, count(*)
   FROM shop_product_images
   WHERE shop_domain = '<shop>'
   GROUP BY embedding_status;
   ```
2. Milvus collection 是否是当前店铺 collection。
3. 商品是否满足：
   - `status = 'ACTIVE'`
   - 如果 `availableOnly=true`，还需要 `available_for_sale = true`
4. `IMAGE_SEARCH_MIN_SIMILARITY_SCORE` 是否过高。

### 6.4 S3 图片无法访问

检查：

1. `UPLOAD_STORAGE_PROVIDER=s3`
2. `UPLOAD_STORAGE_BUCKET=shopify-image`
3. `UPLOAD_STORAGE_ENDPOINT` 是否是 S3 API 端口，不是 console 端口。
4. `UPLOAD_STORAGE_FORCE_PATH_STYLE=true`
5. 如果没有 CDN/public base URL，确认 `/storage/uploads/*` 路由能代理读取对象。

### 6.5 Shopify 删除商品后仍被检索到

检查：

1. `products/delete` webhook 是否已部署到 Shopify：
   ```bash
   npm run deploy
   ```
2. 日志是否有：
   - `shopify_webhook.received`
   - `milvus.delete_completed`
   - `shopify_webhook.processed`
3. PostgreSQL 是否仍有该商品：
   ```sql
   SELECT * FROM shop_products
   WHERE shop_domain = '<shop>'
     AND shopify_product_gid = 'gid://shopify/Product/<id>';
   ```

## 7. 上线前验证清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] `npx prisma validate` 通过
- [ ] Web/API 启动正常
- [ ] Product Index Worker 启动正常
- [ ] Redis 可连接
- [ ] Embedding `/health` 返回 patch32
- [ ] S3 bucket `shopify-image` 可写入 original + thumbnail
- [ ] Admin 触发索引后 job 能 completed
- [ ] Storefront 图片搜索能返回当前店铺商品
- [ ] 删除商品 webhook 能删除 PG 数据和 Milvus vectors

## 8. 安全提醒

- 不要把 S3 access key/secret 写入 git。
- 之前在聊天里暴露过的对象存储 secret 建议上线前重新生成。
- 用户上传原图默认会保存，隐私条款/数据保留策略需要和产品侧确认。
- 如需长期保存用户原图，建议后续增加生命周期清理任务或对象存储 lifecycle policy。
