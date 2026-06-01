# Image Search 第一期统一开发设计

日期：2026-06-01  
项目目录：`/Users/apple/Desktop/jttapp/lens-cart-ai`  
来源文档：

- `docs/superpowers/specs/2026-05-29-image-search-design.md`
- `docs/superpowers/specs/2026-06-01-image-search-design.md`

本文件是两份设计的统一开发版。底层数据、索引、Shopify Admin API 和 Milvus 细节以 2026-05-29 版为基础；前台产品闭环、匿名状态、上传历史、错误处理、测试和验收标准吸收 2026-06-01 版内容。

## 1. 设计目标

第一期交付一个可真实运行的 Shopify 店铺前台 Image Search 闭环，而不是后台 mock 或单页 demo。

核心用户流程：

```txt
后台索引 Shopify 商品、variant、图片
  ↓
PostgreSQL 保存商品业务数据、variant numeric id、索引状态和用户状态
  ↓
Python FastAPI embedding 服务生成 CLIP image embedding
  ↓
Milvus 保存 512 维商品图片向量
  ↓
店铺前台右下角悬浮入口打开 Image Search 弹窗
  ↓
用户上传图片，返回视觉相似商品 grid
  ↓
点击商品跳转 Shopify 原生商品详情页 /products/{handle}
  ↓
点击 Add to Cart 调 Shopify Ajax Cart API，不跳转、不关闭弹窗
  ↓
商品详情页下方显示 Similar Products 推荐区块
```

第一期必须完成：

- Storefront Theme App Extension：全站浮动图搜入口和 PDP Similar Products 区块。
- Shopify React Router app 后端：索引、搜索、推荐、收藏、上传历史 API。
- 独立 Python FastAPI embedding 服务：使用 CLIP ViT-B/16，输出 512 维 L2-normalized image embedding。
- PostgreSQL：作为商品、variant、图片索引状态、索引 job、上传历史、收藏状态的业务真相源。
- Milvus：作为商品图片向量检索引擎。
- 后台 `/app` 首页：替换模板示例，提供商品图片索引管理入口。

## 2. 非目标

第一期不做：

- 文字搜索。
- 对话导购。
- Smart Cart。
- 评论证据推荐。
- 完整搭配或 Complete the Look 推荐逻辑。
- A/B Test 和数据分析报表。
- 手动图片裁剪、框选搜索。
- 多排序策略。
- 复杂个性化推荐。
- 替换 Shopify 原生商品详情页。

这些能力只保留接口和数据模型上的扩展余地，不进入第一期实现范围。

## 3. 总体架构

```txt
Shopify Admin 后台 /app
  └─ 触发 Index / Re-index product images

Shopify Admin GraphQL API
  └─ 拉取 product、variant、media image、currency、legacyResourceId

PostgreSQL
  ├─ shop_products
  ├─ shop_product_variants
  ├─ shop_product_images
  ├─ product_index_jobs
  ├─ image_search_uploads
  └─ favorite_products

Python FastAPI Embedding Service
  └─ openai/clip-vit-base-patch16，输出 512 维 L2-normalized embedding

Milvus
  └─ product_image_embeddings_512，FloatVector(512)

Theme App Extension
  ├─ App Embed：右下角悬浮入口 + Image Search 弹窗
  └─ Product App Block：PDP Similar Products 区块

Shopify Storefront
  ├─ 商品卡片跳转 /products/{handle}
  └─ Add to Cart 调 /cart/add.js，不跳转、不关闭当前 UI
```

职责边界：

- Theme App Extension 负责前台 UI、localStorage 状态、Shopify Ajax Cart 调用。
- Shopify app 后端负责 API 编排、Shopify 鉴权、shop 隔离、PostgreSQL、Milvus、embedding 服务调用和响应整形。
- Python FastAPI 只负责 image-to-vector，不接触 Shopify 业务数据。
- PostgreSQL 是业务真相源，保存商品展示数据、variant numeric id、索引状态、上传历史和收藏。
- Milvus 只保存向量检索所需字段，不作为商品展示数据源。

## 4. 关键统一决策

### 4.1 API 命名

采用更清晰、可扩展的 2026-05-29 风格：

```txt
POST /api/image-search/search
GET  /api/recommendations/similar-products
POST /api/image-search/index-products
GET  /api/favorites
POST /api/favorites
DELETE /api/favorites
GET  /api/upload-history
```

### 4.2 Embedding 服务接口

统一为：

```txt
GET  /health
POST /embed/image
```

未来文字搜索预留：

```txt
POST /embed/text
```

### 4.3 Embedding 模型标识

底层模型使用 Hugging Face 标识：

```txt
openai/clip-vit-base-patch16
```

业务 alias 使用：

```txt
clip-vit-b-16
```

后端校验时同时记录底层模型和 alias，避免不同服务使用不同字符串导致误判。

### 4.4 Milvus collection

统一使用带维度后缀的 collection：

```txt
product_image_embeddings_512
```

原因：未来如果切换 1024 维或其他模型，可以新建 collection 并重新索引，避免不同维度向量混入同一 collection。

### 4.5 Variant numeric id

必须保存 Shopify Admin GraphQL `variant.legacyResourceId`，字段名为：

```txt
shopify_variant_numeric_id
```

Shopify Ajax Cart API `/cart/add.js` 使用 numeric variant id，不使用 GraphQL GID。该字段是 Add to Cart 能否稳定工作的关键字段。

### 4.6 收藏策略

匿名用户第一期必须可收藏，前端 localStorage 是必做能力。后端 `favorite_products` 表和 API 同时支持 `anonymousId`，便于跨设备或登录合并扩展。

如果第一期无法稳定获得 storefront customer identity：

- UI 收藏仍完整工作。
- localStorage 收藏必须可恢复。
- 后端收藏 API 可只使用 `anonymousId`。
- `customerGid` 合并逻辑延后，不影响第一期验收。

### 4.7 上传图片存储

PostgreSQL 不存 full-size image binary。上传图片和缩略图使用对象存储接口：

- 本地开发：gitignored `storage/uploads`。
- 生产：S3、Cloudflare R2、MinIO 或其他 S3-compatible object storage。

## 5. 环境配置

本地 `.env` 需要配置：

```env
DATABASE_URL=postgresql://app_user:<POSTGRES_PASSWORD>@127.0.0.1:25433/appdb

MILVUS_ADDRESS=127.0.0.1:29530
MILVUS_USERNAME=root
MILVUS_PASSWORD=<MILVUS_ROOT_PASSWORD>
MILVUS_COLLECTION=product_image_embeddings_512
MILVUS_METRIC_TYPE=IP

IMAGE_EMBEDDING_SERVICE_URL=http://127.0.0.1:8001
IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch16
IMAGE_EMBEDDING_MODEL_ALIAS=clip-vit-b-16
IMAGE_EMBEDDING_DIMENSION=512

UPLOAD_STORAGE_PROVIDER=local
UPLOAD_STORAGE_LOCAL_DIR=storage/uploads
UPLOAD_STORAGE_PUBLIC_BASE_URL=

UPLOAD_STORAGE_BUCKET=
UPLOAD_STORAGE_ENDPOINT=
UPLOAD_STORAGE_ACCESS_KEY_ID=
UPLOAD_STORAGE_SECRET_ACCESS_KEY=
```

生产环境将 `UPLOAD_STORAGE_PROVIDER` 改为 `s3`，并配置 bucket、endpoint、access key 和 public base URL。

注意：

- 密码、真实 key、access token 不写进代码或提交到文档示例。
- `IMAGE_EMBEDDING_SERVICE_URL` 在生产中应尽量只允许后端服务访问。
- Milvus collection 维度固定 512；切换模型维度必须新建 collection 并重新索引。

## 6. Embedding 服务设计

### 6.1 服务定位

路径：

```txt
services/embedding
```

技术：

- Python FastAPI。
- PyTorch。
- Hugging Face Transformers。
- Model：`openai/clip-vit-base-patch16`。

职责：

```txt
输入图片 URL 或图片文件
  ↓
加载 CLIP ViT-B/16 image encoder
  ↓
生成 512 维 image embedding
  ↓
L2 normalize
  ↓
返回 model、modelAlias、dimension、embedding
```

Node Shopify app 不直接加载 PyTorch，只通过 HTTP 调用 embedding 服务。

### 6.2 `GET /health`

返回：

```json
{
  "ok": true,
  "model": "openai/clip-vit-base-patch16",
  "modelAlias": "clip-vit-b-16",
  "dimension": 512
}
```

### 6.3 `POST /embed/image`

索引阶段支持 image URL：

```json
{
  "imageUrl": "https://cdn.shopify.com/..."
}
```

前台搜索阶段支持 multipart image file：

```txt
multipart/form-data
image=<file>
```

返回：

```json
{
  "model": "openai/clip-vit-base-patch16",
  "modelAlias": "clip-vit-b-16",
  "dimension": 512,
  "embedding": [0.0123, -0.0456]
}
```

后端必须校验：

```txt
model == IMAGE_EMBEDDING_MODEL
modelAlias == IMAGE_EMBEDDING_MODEL_ALIAS
dimension == 512
embedding.length == 512
embedding 已 L2 normalize，norm 接近 1
```

### 6.4 未来预留：`POST /embed/text`

第一期不实现文字搜索，但保留同模型图文空间路线：

```json
{
  "text": "black rectangular sunglasses"
}
```

返回同为 512 维 embedding，用于后续文字搜索、图文混合搜索和对话导购推荐。

## 7. PostgreSQL 数据模型

使用 Prisma + PostgreSQL。表名采用 snake_case，代码模型名可采用 PascalCase。

### 7.1 `shop_products`

一行一个 Shopify product。

字段：

```txt
id
shop_domain
shopify_product_gid
title
handle
status
vendor
product_type
tags
featured_image_url
min_price
currency_code
total_inventory
available_for_sale
raw_shopify_payload
last_synced_at
created_at
updated_at
```

唯一约束：

```txt
(shop_domain, shopify_product_gid)
```

用途：

- 商品卡片展示标题、handle、主图、价格、可售状态。
- 商品详情跳转使用 `/products/{handle}`。
- 多店铺隔离依赖 `shop_domain`。

### 7.2 `shop_product_variants`

一行一个 Shopify variant。

字段：

```txt
id
product_id
shop_domain
shopify_product_gid
shopify_variant_gid
shopify_variant_numeric_id
title
sku
price
compare_at_price
available_for_sale
inventory_quantity
raw_shopify_payload
created_at
updated_at
```

唯一约束：

```txt
(shop_domain, shopify_variant_gid)
```

关键要求：

```txt
shopify_variant_numeric_id = Shopify Admin GraphQL legacyResourceId
```

建议在 Prisma 中把 `shopify_variant_numeric_id` 存为 `String`，避免 JavaScript number 精度和 BigInt JSON 序列化问题。前端 Add to Cart 直接把该字符串作为 `/cart/add.js` 的 `id` 发送。

默认商品卡片 variant 选择：

```txt
优先第一个 available_for_sale variant
如果没有可售 variant，fallback 到第一个 variant，并返回 availableForSale=false
```

### 7.3 `shop_product_images`

一行一张 Shopify product media image。

字段：

```txt
id
product_id
shop_domain
shopify_product_gid
shopify_media_gid
shopify_image_gid
image_url
alt_text
position
width
height
is_featured
image_url_hash
embedding_status
embedding_provider
embedding_model
embedding_model_alias
embedding_dimension
milvus_collection
milvus_vector_id
last_embedded_at
embedding_error
created_at
updated_at
```

唯一约束：

```txt
(shop_domain, shopify_media_gid)
```

`embedding_status`：

```txt
pending
processing
indexed
failed
```

需要重新 embedding 的情况：

```txt
新图片
image_url_hash 变化
embedding_model 变化
embedding_dimension != 512
milvus_collection != product_image_embeddings_512
milvus_vector_id 为空
force re-index
embedding_status = failed 且用户重新触发索引
```

成功写入 Milvus 后回写：

```txt
embedding_status = indexed
embedding_provider = clip_http
embedding_model = openai/clip-vit-base-patch16
embedding_model_alias = clip-vit-b-16
embedding_dimension = 512
milvus_collection = product_image_embeddings_512
milvus_vector_id = <stable_vector_id>
last_embedded_at = now()
embedding_error = null
```

失败时：

```txt
embedding_status = failed
embedding_error = 错误摘要
```

### 7.4 `product_index_jobs`

记录一次后台索引任务。

字段：

```txt
id
shop_domain
status
mode
source_filter
products_seen
variants_seen
images_seen
images_indexed
images_skipped
images_failed
error_message
started_at
completed_at
created_at
updated_at
```

`status`：

```txt
queued
running
completed
failed
```

`mode`：

```txt
incremental
force
```

设计原则：

- 单张图片 embedding 失败不终止整个 job。
- Shopify API、PostgreSQL、Milvus、embedding 服务连接等致命错误才让 job 进入 `failed`。
- `images_failed > 0` 时 job 仍可为 `completed`，后台必须显示失败图片数量。

### 7.5 `image_search_uploads`

保存 shopper 上传历史 metadata，不保存 full-size binary。

字段：

```txt
id
shop_domain
anonymous_id
customer_gid
image_storage_key
thumbnail_url
original_filename
content_type
byte_size
search_status
created_at
```

`search_status`：

```txt
completed
failed
```

上传历史策略：

- 成功上传并完成搜索后，保存 metadata 和 thumbnail。
- 搜索失败时，前端仍保留本次预览；后端可保存 `failed` metadata 便于排查，但 recent uploads 默认只展示成功记录。
- 不把图片 binary 存进 PostgreSQL。

### 7.6 `favorite_products`

保存匿名或登录用户收藏。

字段：

```txt
id
shop_domain
anonymous_id
customer_gid
shopify_product_gid
shopify_variant_gid
source_surface
created_at
updated_at
```

唯一约束：

```txt
(shop_domain, anonymous_id, shopify_product_gid)
(shop_domain, customer_gid, shopify_product_gid)
```

如果 Prisma 对 nullable unique 的行为不能完全表达业务约束，service 层必须在写入前按 `shop_domain + identity + product` 做幂等 upsert。

`source_surface`：

```txt
image_search
pdp_similar_products
text_search
cart
chat
```

第一期主要使用：

```txt
image_search
pdp_similar_products
```

## 8. Milvus collection 设计

Collection 名称：

```txt
product_image_embeddings_512
```

向量维度：

```txt
512
```

Metric：

```txt
IP
```

因为 embedding 已 L2 normalize，inner product 和 cosine similarity 排序等价。索引和搜索必须都使用 normalized embedding。

字段：

```txt
vector_id
embedding FloatVector(512)
shop_domain
shopify_product_gid
shopify_media_gid
shopify_variant_gid
available_for_sale
product_type
status
created_at_unix
```

### 8.1 `vector_id`

Milvus 主键，与 `shop_product_images.milvus_vector_id` 对应。

稳定生成方式：

```txt
sha256(shop_domain + "::" + shopify_media_gid + "::" + embedding_model + "::512")
```

这样 re-index 同一图片同一模型时可以覆盖或先 delete 再 insert，避免重复向量无限增长。

### 8.2 过滤要求

所有 Milvus 检索必须带：

```txt
shop_domain == 当前店铺
```

如果启用 Available Products Only：

```txt
available_for_sale == true
```

PDP Similar Products 还必须排除当前商品：

```txt
shopify_product_gid != 当前商品
```

### 8.3 PostgreSQL 与 Milvus 的关系

一张商品图对应一条 Milvus vector：

```txt
shop_product_images.id
  ↔ shop_product_images.milvus_vector_id
  ↔ product_image_embeddings_512.vector_id
```

搜索时：

```txt
Milvus 返回 vector_id / shopify_product_gid / shopify_media_gid / score
  ↓
后端按 shop_domain 回查 PostgreSQL
  ↓
过滤 missing、inactive、stale records
  ↓
按商品去重
  ↓
拼出 ProductCardDTO
```

前台不直接访问 Milvus。

## 9. Shopify Admin API 同步流程

后台索引使用当前店铺 admin session：

```ts
authenticate.admin(request)
```

开发阶段默认过滤测试商品：

```txt
tag:lenscart-test status:active
```

该过滤不能生产 hard-code。应封装为 job 的 `source_filter`：

```json
{
  "query": "tag:lenscart-test status:active",
  "mode": "development_test_products"
}
```

生产时可改为空查询、指定 collection、指定 tag 或后台配置。

### 9.1 GraphQL 查询字段

必须查询：

```graphql
query ImageSearchProducts($query: String!, $first: Int!) {
  shop {
    myshopifyDomain
    currencyCode
  }
  products(first: $first, query: $query) {
    nodes {
      id
      title
      handle
      status
      vendor
      productType
      tags
      featuredMedia {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
            width
            height
          }
        }
      }
      media(first: 10) {
        nodes {
          ... on MediaImage {
            id
            image {
              id
              url
              altText
              width
              height
            }
          }
        }
      }
      variants(first: 10) {
        nodes {
          id
          legacyResourceId
          title
          sku
          price
          compareAtPrice
          availableForSale
          inventoryQuantity
        }
      }
    }
  }
}
```

关键点：

- `shop.myshopifyDomain` 用作 `shop_domain`。
- `shop.currencyCode` 用于商品价格展示。
- `variant.legacyResourceId` 用于 Storefront Ajax Cart。
- `media.image.url` 使用 Shopify CDN URL，不使用 CSV 原始 URL。

### 9.2 PostgreSQL upsert

对每个 product：

1. upsert `shop_products`。
2. upsert `shop_product_variants`。
3. upsert `shop_product_images`。

`min_price` 从 variants 最低价计算。  
`total_inventory` 从 variants `inventoryQuantity` 汇总。  
`available_for_sale` 从 variants 任一可售状态计算。

图片 `is_featured` 判断：

```txt
media.id == featuredMedia.id
```

图片 `position` 使用 media 列表顺序。

### 9.3 Embedding + Milvus 写入

对本次需要索引的图片：

```txt
1. embedding_status = processing
2. 调用 Python FastAPI POST /embed/image
3. 校验 model/modelAlias/dimension/embedding length/norm
4. 生成 stable vector_id
5. 写入 Milvus product_image_embeddings_512
6. 回写 PostgreSQL indexed 状态
```

如果 Milvus SDK 不支持真正 upsert：

```txt
delete where vector_id == 当前 vector_id
insert 新 vector
flush
```

单张图片失败：

```txt
embedding_status = failed
embedding_error = 错误摘要
images_failed + 1
继续下一张图片
```

## 10. 后台 `/app` 索引入口

后台首页替换模板 Generate product 示例，变为 Image Search Indexing 管理页。

页面结构：

```txt
Image Search Indexing
├─ Index product images
├─ Re-index product images
├─ Last index job
│  ├─ status
│  ├─ mode
│  ├─ source_filter
│  ├─ products_seen
│  ├─ variants_seen
│  ├─ images_seen
│  ├─ images_indexed
│  ├─ images_skipped
│  ├─ images_failed
│  ├─ started_at
│  ├─ completed_at
│  └─ error_message
└─ Development filter helper: tag:lenscart-test status:active
```

### 10.1 `Index product images`

增量索引：

```txt
拉取 Shopify 当前测试商品
upsert PostgreSQL
只处理新图片、状态异常、模型/URL/collection 变化的图片
写 Milvus
回写索引状态
```

### 10.2 `Re-index product images`

强制重建：

```txt
拉取 Shopify 当前测试商品
upsert PostgreSQL
将本次范围内图片强制设为 pending
重新生成 embedding
覆盖或重写 Milvus vector
回写索引状态
```

### 10.3 后端路由

```txt
POST /api/image-search/index-products
```

输入：

```json
{
  "mode": "incremental"
}
```

或：

```json
{
  "mode": "force"
}
```

认证：

```txt
后台接口使用 authenticate.admin(request)
```

输出：

```json
{
  "jobId": "uuid",
  "status": "completed",
  "productsSeen": 25,
  "variantsSeen": 25,
  "imagesSeen": 25,
  "imagesIndexed": 25,
  "imagesSkipped": 0,
  "imagesFailed": 0
}
```

后台最新 job 可由 `/app` loader 直接查 PostgreSQL，第一期不必额外做 latest job API。

## 11. Storefront API 设计

Theme App Extension 调用后端 API 时必须带当前店铺 domain 和 anonymous id。优先通过 Shopify App Proxy 暴露 storefront API，避免跨域和增强请求校验；本地 preview 或代理未配置时可使用 app URL + 限定 CORS。

所有 storefront API 必须：

- 校验 `shop` 是合法 myshopify domain。
- 强制按 `shop_domain` 过滤 PostgreSQL 和 Milvus。
- 不信任前端传来的 product、variant、price、availability 数据。
- 限制图片类型和大小。
- 返回稳定的 ProductCardDTO。

### 11.1 ProductCardDTO

搜索和推荐接口统一返回：

```json
{
  "productGid": "gid://shopify/Product/...",
  "variantGid": "gid://shopify/ProductVariant/...",
  "variantId": "1234567890",
  "title": "3170/S Rectangular Sunglasses",
  "handle": "3170-s-rectangular-sunglasses",
  "imageUrl": "https://cdn.shopify.com/...",
  "price": "244.00",
  "compareAtPrice": null,
  "currencyCode": "CAD",
  "availableForSale": true,
  "variantTitle": "Default Title",
  "similarityScore": 0.91,
  "isFavorited": false
}
```

`variantId` 必须是 `shopify_variant_numeric_id`。

### 11.2 Image Search 搜索接口

```txt
POST /api/image-search/search
```

输入：

```txt
multipart/form-data
image=<file>
shop=<myshopify domain>
anonymousId=<uuid>
limit=12
availableOnly=true|false
sort=most_relevant
customerGid=<optional>
```

约束：

```txt
image/jpeg, image/png, image/webp
max size = 5MB
limit default = 12
limit max = 48
sort 第一版只支持 most_relevant
```

Flow：

1. Validate shop、anonymousId、file type、file size。
2. 保存上传 metadata 和 thumbnail，full-size image 写入 upload storage。
3. 调用 embedding 服务 `/embed/image`。
4. 校验返回向量。
5. 查询 Milvus，filter 包含 `shop_domain` 和可选 `available_for_sale == true`。
6. raw topK 使用 `max(limit * 3, 36)`，给 PostgreSQL 过滤和按商品去重留余量。
7. 按 `shop_domain` 回查 PostgreSQL 商品、variant、图片。
8. 过滤 missing、inactive、stale records。
9. 按 `shopify_product_gid` 去重，保留 similarityScore 最高结果。
10. 叠加 favorite state 和 recent uploads。
11. 返回 ProductCardDTO 列表。

输出：

```json
{
  "uploadId": "uuid",
  "results": [],
  "favorites": ["gid://shopify/Product/..."],
  "recentUploads": [
    {
      "id": "uuid",
      "thumbnailUrl": "https://...",
      "createdAt": "2026-06-01T00:00:00.000Z"
    }
  ],
  "queryMeta": {
    "embeddingModel": "openai/clip-vit-base-patch16",
    "embeddingModelAlias": "clip-vit-b-16",
    "dimension": 512,
    "limit": 12,
    "availableOnly": true
  }
}
```

### 11.3 PDP Similar Products 接口

```txt
GET /api/recommendations/similar-products
```

参数：

```txt
shop=<myshopify domain>
productGid=<gid://shopify/Product/...>
anonymousId=<optional>
limit=10
availableOnly=true
```

Flow：

1. 根据 `shop_domain + productGid` 找当前商品。
2. 优先找当前商品 featured image 对应的 indexed vector。
3. 如果 featured image 未 indexed，fallback 到该商品第一张 indexed image。
4. 如果当前商品没有 indexed image，返回空 results。
5. 用 source vector 查询 Milvus。
6. filter 包含 `shop_domain`、`shopify_product_gid != 当前商品` 和可选 `available_for_sale == true`。
7. raw topK 使用 `max(limit * 3, 30)`。
8. 按 product 去重。
9. 回查 PostgreSQL 拼 ProductCardDTO。

输出：

```json
{
  "sourceProductGid": "gid://shopify/Product/...",
  "sourceMediaGid": "gid://shopify/MediaImage/...",
  "results": []
}
```

该接口不在页面浏览时重新生成 embedding。

### 11.4 Favorites API

```txt
GET /api/favorites
POST /api/favorites
DELETE /api/favorites
```

`GET /api/favorites` 参数：

```txt
shop
anonymousId
customerGid=<optional>
```

`POST /api/favorites` body：

```json
{
  "shop": "example.myshopify.com",
  "anonymousId": "uuid",
  "customerGid": null,
  "shopifyProductGid": "gid://shopify/Product/...",
  "shopifyVariantGid": "gid://shopify/ProductVariant/...",
  "sourceSurface": "image_search"
}
```

`DELETE /api/favorites` body：

```json
{
  "shop": "example.myshopify.com",
  "anonymousId": "uuid",
  "customerGid": null,
  "shopifyProductGid": "gid://shopify/Product/..."
}
```

收藏 API 必须幂等：

- 重复收藏返回当前 favorited 状态。
- 删除不存在的收藏返回 not favorited。
- 收藏失败不阻塞搜索结果展示。

### 11.5 Upload History API

```txt
GET /api/upload-history
```

参数：

```txt
shop
anonymousId
customerGid=<optional>
limit=8
```

返回最近成功上传的缩略图 metadata。

独立 `POST /api/upload-history` 第一期开内部 service 即可，不对前台公开单独调用；搜索接口负责创建上传历史。

## 12. Theme App Extension 前台设计

第一期包含两个 storefront surface：

```txt
App Embed：全站右下角悬浮入口 + Image Search 弹窗
Product App Block：商品详情页 Similar Products 区块
```

### 12.1 localStorage state

前台脚本管理：

```txt
lensCartAi.v1.anonymousId
lensCartAi.v1.recentUploads.<shopDomain>
lensCartAi.v1.favoriteProducts.<shopDomain>
```

状态职责：

- anonymous id：首次访问生成 UUID。
- recent uploads：优先使用后端成功 thumbnail；搜索失败时保留当前会话预览。
- favorite products：匿名收藏即时更新，后端同步失败时仍保留本地状态。

### 12.2 Floating Image Search Modal

弹窗布局：

```txt
Image Search Modal
├─ Header
│  ├─ Image Search 标题
│  └─ 关闭按钮
├─ Left Panel
│  ├─ 当前上传图片预览
│  ├─ Upload New Image 按钮
│  └─ 最近上传图片缩略图
└─ Right Panel
   ├─ Available Products Only checkbox
   ├─ Sort by: Most Relevant
   └─ 商品结果 Grid
      ├─ 商品图片
      ├─ 收藏按钮
      ├─ 找相似按钮/图标预留
      ├─ Add to Cart 按钮
      ├─ 商品标题
      ├─ variant title / size label
      └─ 价格
```

第一期必须实现：

- 点击悬浮入口打开弹窗。
- 上传 JPG、PNG、WebP。
- 上传图片预览。
- 搜索 loading 状态。
- 商品结果 grid。
- 空结果状态。
- 错误提示。
- 关闭弹窗。
- 点击商品跳转详情页。
- Add to Cart 不跳转、不关闭。
- 收藏按钮。
- Available Products Only。
- Sort by: Most Relevant 静态展示或单选项。
- 最近上传图片缩略图。

第一期预留但不完整实现：

- 找相似按钮：UI 可预留，后续支持基于某个结果继续找相似。
- 图片裁剪/框选。
- 多排序选项。
- 评论证据。

### 12.3 商品卡片跳转

卡片主体点击区域：

- 商品图片。
- 商品标题。
- 商品价格区域。
- 卡片非按钮区域。

点击跳转：

```txt
/products/{handle}
```

以下按钮必须阻止冒泡，不触发跳转：

- Add to Cart。
- 收藏。
- 找相似按钮。

### 12.4 Add to Cart

点击 Add to Cart：

```txt
POST /cart/add.js
Content-Type: application/json

{
  "id": variantId,
  "quantity": 1
}
```

其中：

```txt
variantId = shop_product_variants.shopify_variant_numeric_id
```

成功后：

- 按钮显示 `Added`。
- 弹窗保持打开。
- 搜索结果保持不变。
- 页面不跳转。
- 不打开购物车页。

失败时：

- 按钮恢复 `Add to Cart`。
- 显示 `Unable to add item to cart. Please try again.`。

如果 `availableForSale = false`：

- 按钮禁用。
- 显示 `Sold out` 或 `Unavailable`。

### 12.5 PDP Similar Products

商品详情页下方由 Product App Block 渲染：

```txt
Similar Products
└─ 横向或网格商品卡片
```

数据来源：

```txt
当前 Shopify product numeric id
  ↓
前端组装 productGid = gid://shopify/Product/{{ product.id }}
  ↓
GET /api/recommendations/similar-products
```

展示规则：

- 推荐商品不包含当前商品。
- 商品卡片交互与 Image Search 结果保持一致。
- 无索引数据时隐藏区块或显示轻量空状态。
- 接口失败不能阻塞 PDP 主内容。

## 13. 前台状态与错误处理

### 13.1 Image Search 状态

```txt
idle
uploading
searching
success
empty
error
```

错误文案：

```txt
图片格式不支持：Please upload a JPG, PNG, or WebP image.
图片太大：Image is too large. Please upload a smaller image.
embedding 服务失败：We couldn't analyze this image. Please try again.
Milvus 无结果：No similar products found.
后端错误：Something went wrong. Please try again.
```

### 13.2 PDP Similar Products 状态

```txt
loading
success
empty
error
hidden
```

行为：

- 无 indexed source image 时隐藏区块或显示轻量空状态。
- 接口失败不能阻塞 PDP 主内容。

### 13.3 Add to Cart 状态

```txt
idle
adding
added
error
disabled
```

错误文案：

```txt
Unable to add item to cart. Please try again.
```

### 13.4 收藏状态

```txt
favorited
not_favorited
saving
error
```

收藏失败不影响搜索结果展示或商品跳转。本地状态优先保持用户即时反馈，后台同步失败时可显示轻量 inline error。

## 14. 安全与隔离要求

- Storefront API 必须校验 `shop` 格式，并确保该 shop 已安装 app 或有有效 session 记录。
- 所有 PostgreSQL 查询必须按 `shop_domain` 过滤。
- 所有 Milvus 查询必须按 `shop_domain` 过滤。
- 前端传来的 product、variant、price、availability 都不可信。
- 图片上传只接受 JPG、PNG、WebP。
- 图片大小限制 5MB。
- 上传文件名不作为存储 key，存储 key 使用 UUID 或 hash。
- Embedding 服务错误不向用户暴露内部堆栈。
- 后端日志记录 request id、shop_domain、operation、job id，但不记录敏感 key。
- 生产环境 embedding 服务和 Milvus 不对公网开放。

## 15. 测试策略

### 15.1 环境配置测试

验证：

```txt
DATABASE_URL 可连接
MILVUS_ADDRESS 可连接
IMAGE_EMBEDDING_SERVICE_URL /health 正常
UPLOAD_STORAGE_PROVIDER 可写入 thumbnail
```

### 15.2 PostgreSQL schema 测试

确认表存在：

```txt
shop_products
shop_product_variants
shop_product_images
product_index_jobs
image_search_uploads
favorite_products
```

确认关键约束：

```txt
(shop_domain, shopify_product_gid)
(shop_domain, shopify_variant_gid)
(shop_domain, shopify_media_gid)
```

### 15.3 Embedding 服务测试

验证：

- Valid image 返回 model、modelAlias、dimension 512、embedding。
- Invalid image 返回受控错误。
- embedding length = 512。
- vector norm 接近 1。
- `/health` 返回当前模型和维度。

### 15.4 Shopify Admin API 拉商品测试

使用：

```txt
tag:lenscart-test status:active
```

期望拉到：

```txt
products
variants
media images
shop.currencyCode
variant.legacyResourceId
media.image.url
```

### 15.5 后台索引链路测试

点击：

```txt
Index product images
```

期望：

```txt
product_index_jobs.status = completed
products_seen > 0
variants_seen > 0
images_seen > 0
images_indexed > 0
```

PostgreSQL：

```txt
shop_product_images.embedding_status = indexed
embedding_dimension = 512
embedding_model = openai/clip-vit-base-patch16
embedding_model_alias = clip-vit-b-16
milvus_collection = product_image_embeddings_512
milvus_vector_id 非空
```

Milvus：

```txt
product_image_embeddings_512 中存在对应 vector
```

### 15.6 Image Search API 测试

调用：

```txt
POST /api/image-search/search
```

期望：

- 返回 `uploadId`。
- 返回 `results`。
- 每条 result 有 `title`、`handle`、`imageUrl`、`price`、`currencyCode`、`variantId`。
- `variantId` 是 numeric variant id 字符串。
- `similarityScore` 有值。
- `availableOnly=true` 时不返回 unavailable 商品。
- missing PostgreSQL records 被过滤。

### 15.7 Favorites 和 Upload History 测试

验证：

- 匿名收藏写入 localStorage。
- 后端 `POST /api/favorites` 幂等。
- `DELETE /api/favorites` 删除后再次删除仍成功返回 not favorited。
- `GET /api/favorites` 按 shop 和 anonymousId 隔离。
- 成功搜索后 `GET /api/upload-history` 返回 thumbnail。
- 另一个 shop 看不到当前 shop 的收藏和上传历史。

### 15.8 前台 Image Search 弹窗测试

验证：

- 点击悬浮入口打开弹窗。
- 上传图片显示预览。
- 搜索时有 loading 状态。
- 右侧显示结果 grid。
- 点击商品卡片跳转 `/products/{handle}`。
- 点击 Add to Cart 不跳转、不关闭弹窗。
- 加购成功按钮显示 `Added`。
- 收藏心形可切换，刷新后匿名收藏仍保留。
- Available Products Only 可影响结果。
- 错误和空状态显示在弹窗内。

### 15.9 PDP Similar Products 测试

打开商品详情页：

```txt
/products/{handle}
```

验证：

- Similar Products 区块出现。
- 推荐商品不包含当前商品。
- 点击推荐商品跳转详情。
- 点击 Add to Cart 不跳转、不刷新页面。
- 无索引数据时不影响 PDP 主页面。

## 16. 实施顺序建议

按可验证切片推进：

```txt
1. PostgreSQL datasource 切换到 PostgreSQL，添加 Prisma schema 和迁移。
2. Python FastAPI embedding 服务 health 和 /embed/image。
3. Milvus collection 初始化和写入/检索封装。
4. Shopify Admin API 商品同步与 PostgreSQL upsert。
5. 后台 /app 索引按钮和 product_index_jobs 展示。
6. 商品图片 embedding + Milvus upsert + PostgreSQL 回写。
7. Image Search 后端搜索接口。
8. Upload storage、upload history、thumbnail metadata。
9. Favorites API 和 anonymousId localStorage contract。
10. Theme App Extension App Embed：悬浮入口 + Image Search 弹窗。
11. Add to Cart、商品详情跳转、收藏 localStorage。
12. PDP Similar Products 接口和 Product App Block。
13. 端到端验证和错误状态打磨。
```

## 17. 验收标准

第一期完成时必须满足：

- 后台 `/app` 可以触发商品图片索引和强制重建索引。
- 索引能从 Shopify Admin API 拉取 product、variant、media image、currency、legacyResourceId。
- PostgreSQL 保存商品、variant、图片、索引 job、上传历史、收藏数据。
- Milvus `product_image_embeddings_512` 保存 512 维 normalized image vectors。
- 上传图片调用真实 FastAPI CLIP embedding 服务，不使用 mock embedding。
- Storefront 浮动入口可以打开 Image Search 弹窗。
- 弹窗包含上传图片、最近图片、收藏状态、Available Products Only、结果 grid、Add to Cart。
- 搜索结果来自 Milvus 近邻检索和 PostgreSQL 商品数据回查。
- 商品卡片点击跳转 Shopify 原生 `/products/{handle}`。
- Add to Cart 通过 `/cart/add.js` 工作，不跳转、不关闭弹窗。
- Add to Cart 使用 `shopify_variant_numeric_id`。
- 收藏可切换并在匿名用户刷新后保留。
- Product detail page 显示视觉相似 Similar Products。
- Similar Products 不包含当前商品。
- 错误、空状态、不可售状态都有受控 UI。
- 所有 PostgreSQL 和 Milvus 操作按 `shop_domain` 隔离。

## 18. 后续扩展边界

第一期完成后可以按以下方向扩展：

- `/embed/text` 支持文字搜索。
- 基于结果卡片的 find similar。
- 图片裁剪/框选搜索。
- Complete the Look 搭配推荐。
- Customer identity 合并匿名收藏和上传历史。
- 商品 webhook 增量索引。
- 多排序策略和 rerank。
- Review evidence 和 AI explanation。

这些扩展不能改变第一期已确定的核心 contract：PostgreSQL 是业务真相源、Milvus 只做向量检索、Add to Cart 使用 numeric variant id、所有数据按 shop_domain 隔离。
