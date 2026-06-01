# Image Search Phase 1 Merged Design

> Superseded: this file is a merge-process reference only. Use `docs/superpowers/specs/2026-06-01-image-search-unified-design.md` as the final Phase 1 implementation spec.

日期：2026-06-01  
项目目录：`/Users/apple/Desktop/jttapp/lens-cart-ai`  
来源文档：

- `docs/superpowers/specs/2026-05-29-image-search-design.md`
- `docs/superpowers/specs/2026-06-01-image-search-design.md`

## 1. 文档定位

本文档是 Image Search 第一期设计合并过程中的参考稿。最终实现以 `2026-06-01-image-search-unified-design.md` 为准。

合并原则：

- 采用 `2026-06-01-image-search-design.md` 更清晰的产品化目标、非目标、部署说明和验收标准。
- 保留 `2026-05-29-image-search-design.md` 更适合实际落地的 Shopify、PostgreSQL、Milvus、Admin API、Theme App Extension 和测试细节。
- 对冲突点做出明确选择，避免实现阶段出现多个接口名、模型名、collection 名或 schema 方案。

两份历史文档和本文件都只保留作为参考；第一期开发的唯一主 spec 是 `2026-06-01-image-search-unified-design.md`。

## 2. 背景与目标

本项目是 Shopify React Router App。当前项目仍接近 Shopify app 模板状态：

- `prisma/schema.prisma` 仍是 SQLite datasource。
- Prisma 只有 `Session` model。
- `app/routes/app._index.tsx` 仍是模板的 Generate product 示例。
- `extensions/` 还没有完整 Theme App Extension 功能。

第一期目标不是只做后台测试页，而是打通面向 Shopify storefront 的图搜闭环：

```txt
后台索引 Shopify 商品图片
  ↓
PostgreSQL 保存商品、variant、图片、索引状态
  ↓
Python FastAPI CLIP 服务生成 512 维 embedding
  ↓
Milvus 保存和检索商品图片向量
  ↓
Theme App Extension 提供前台悬浮 Image Search modal
  ↓
用户上传图片，看到相似商品 grid
  ↓
商品卡片可跳转 Shopify 原生 PDP
  ↓
Add to Cart 使用 /cart/add.js，不跳转、不关闭弹窗
  ↓
PDP 下方显示 Similar Products
```

第一期完成后，商家可以在后台触发商品图片索引，买家可以在前台通过上传图片找到视觉相似商品，并可以从 Image Search modal 或 PDP Similar Products 区块直接加购商品。

## 3. 第一版范围

### 3.1 包含

第一期包含：

- Shopify 后台 `/app` 索引管理入口。
- Prisma datasource 从当前 SQLite/template 状态迁移到 PostgreSQL。
- PostgreSQL 保存商品、variant、图片、索引 job、upload history、favorites。
- 独立 Python FastAPI embedding 服务。
- Milvus 512 维商品图片向量 collection。
- Theme App Extension：
  - App Embed：右下角悬浮入口 + Image Search modal。
  - Product App Block/Section：PDP Similar Products。
- 前台 Image Search：
  - 上传图片。
  - 图片 preview。
  - recent uploads。
  - visually similar product grid。
  - favorite toggle。
  - Available Products Only。
  - Sort by Most Relevant 静态展示或唯一选项。
  - Add to Cart 不跳转、不关闭 modal。
- PDP Similar Products：
  - 视觉相似推荐。
  - 排除当前商品。
  - 复用商品卡片、favorite、Ajax add-to-cart 行为。

### 3.2 不包含

第一期不包含：

- Text search。
- Chat-based shopping assistant。
- Smart Cart。
- Review evidence。
- AI explanation snippets。
- Complete-the-look / outfit recommendation。
- A/B testing dashboard。
- 手动图片裁剪/框选。
- 多排序策略。
- 替换 Shopify 原生 PDP。
- 复杂个性化推荐。

第一期可以为 text search、chat、Smart Cart、review evidence 和 complete-the-look 预留字段或接口扩展点，但不能让这些功能阻塞图搜闭环交付。

## 4. 关键技术决策

```txt
Embedding model:
openai/clip-vit-base-patch16

Embedding dimension:
512

Embedding service endpoint:
GET /health
POST /embed/image

Embedding response field:
embedding

Milvus collection:
product_image_embeddings_512

Milvus metric:
inner product with L2-normalized vectors

Image Search API:
POST /api/image-search/search

PDP Similar Products API:
GET /api/recommendations/similar-products

Index API:
POST /api/image-search/index-products

PostgreSQL schema:
shop_products
shop_product_variants
shop_product_images
product_index_jobs
image_search_uploads
favorite_products

Add to Cart:
use Shopify Admin GraphQL legacyResourceId / numeric variant ID

PDP Similar source image:
featured indexed image first,
fallback to first indexed image,
otherwise hide section or return empty state

Favorites:
anonymous localStorage first,
backend sync by anonymousId/customer identity when available

Recent uploads:
localStorage immediate continuity,
optional backend/object storage support for production
```

## 5. Overall Architecture

```txt
Shopify Admin App /app
  └─ 索引管理页：Index / Re-index product images

Shopify Admin GraphQL API
  └─ 拉取 product、variant、media、price、availability、legacyResourceId

PostgreSQL
  ├─ 商品业务数据
  ├─ variant numeric id
  ├─ 图片 embedding 状态
  ├─ 索引 job 状态
  ├─ upload history
  └─ favorites

Python FastAPI Embedding Service
  └─ openai/clip-vit-base-patch16，输出 512 维 L2-normalized embedding

Milvus
  └─ product_image_embeddings_512，负责图片向量相似检索

Theme App Extension
  ├─ App Embed：右下角悬浮入口 + Image Search modal
  └─ Product App Block/Section：PDP Similar Products

Shopify Storefront
  ├─ 商品卡片点击跳转 /products/{handle}
  └─ Add to Cart 调 /cart/add.js，不跳转、不关闭弹窗
```

职责边界：

- PostgreSQL 是业务真相源：商品是谁、价格、库存、variant numeric id、图片索引状态、收藏、上传记录都以 PostgreSQL 为准。
- Milvus 只负责向量检索，不作为商品展示数据来源。
- Node Shopify App 负责业务编排：Admin API、PostgreSQL、Milvus、Embedding 服务都由 Node 后端统一协调。
- Embedding 服务独立部署：Node 不加载 PyTorch，只通过 HTTP 调 FastAPI。
- Theme App Extension 不直接访问 Milvus 或 Admin API：只调用本 app 的前台 API，以及 Shopify Ajax Cart API。

## 6. 数据流

### 6.1 商品索引数据流

```txt
商家打开 /app
  ↓
点击 Index product images 或 Re-index product images
  ↓
Node 后端 authenticate.admin(request)
  ↓
调用 Shopify Admin GraphQL API
  ↓
拉取 product、variant、media、currencyCode、legacyResourceId
  ↓
upsert PostgreSQL:
  - shop_products
  - shop_product_variants
  - shop_product_images
  - product_index_jobs
  ↓
找出需要 embedding 的图片
  ↓
调用 FastAPI POST /embed/image
  ↓
校验 model、dimension、embedding.length
  ↓
生成 stable vector_id
  ↓
写入 Milvus product_image_embeddings_512
  ↓
回写 shop_product_images.embedding_status
  ↓
更新 product_index_jobs 统计
```

索引规则：

- 开发阶段可以默认用 `tag:lenscart-test status:active` 过滤测试商品。
- 该过滤不能 hard-code 成生产逻辑，必须作为 source filter 配置保存。
- 单张图片 embedding 失败不终止整个 job。
- 只有 Shopify API、PostgreSQL、Milvus、embedding 服务连接等致命错误才让 job 失败。
- `images_failed > 0` 时 job 仍可为 `completed`，但后台必须显示失败数量。

### 6.2 前台 Image Search 数据流

```txt
用户点击右下角悬浮入口
  ↓
打开 Image Search modal
  ↓
用户上传图片
  ↓
前端显示 preview，并记录 recent upload
  ↓
前端 POST /api/image-search/search
  ↓
Node 后端校验 shop、图片类型、图片大小
  ↓
调用 FastAPI POST /embed/image 生成 query embedding
  ↓
Milvus 按 shop_domain + available_for_sale 过滤检索
  ↓
后端按 product 去重
  ↓
回查 PostgreSQL 拼商品卡片数据
  ↓
返回 results、favorites、recentUploads、queryMeta
  ↓
前台展示商品 grid
```

商品卡片行为：

- 图片、标题、卡片主体点击跳转 `/products/{handle}`。
- Add to Cart、Favorite、Find Similar 预留按钮必须阻止冒泡。
- Add to Cart 调 Shopify Ajax Cart API：

```txt
POST /cart/add.js
id = shopify_variant_numeric_id
quantity = 1
```

- 成功后按钮显示 `Added`。
- 不跳转、不关闭 modal、不清空结果。
- 不打开购物车页。
- 不可售商品显示 `Sold out` 或 `Unavailable`。

### 6.3 PDP Similar Products 数据流

```txt
用户打开 Shopify 原生 PDP /products/{handle}
  ↓
Theme App Extension Product Block 加载
  ↓
前端请求 GET /api/recommendations/similar-products
  ↓
Node 后端根据 shop_domain + productGid 找当前商品
  ↓
优先找 featured image 对应 indexed vector
  ↓
如果没有，fallback 到第一张 indexed image
  ↓
如果仍没有，返回空 results
  ↓
Milvus 检索相似图片，排除当前商品
  ↓
按 shopify_product_gid 去重
  ↓
回查 PostgreSQL 拼商品卡片
  ↓
PDP 下方展示 Similar Products
```

PDP Similar Products 不能影响 PDP 主内容：

- 请求失败时隐藏或显示轻量错误状态。
- 无索引数据时隐藏或显示轻量空状态。
- 推荐商品必须排除当前商品。
- Add to Cart 和 Favorite 行为与 Image Search modal 商品卡片一致。

## 7. API Design

### 7.1 Admin / Indexing API

```txt
POST /api/image-search/index-products
```

认证：

```txt
authenticate.admin(request)
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

可选 source filter：

```json
{
  "mode": "incremental",
  "sourceFilter": {
    "query": "tag:lenscart-test status:active",
    "mode": "development_test_products"
  }
}
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
  "imagesFailed": 0
}
```

后台最新 job 可以由 `/app` loader 直接查 PostgreSQL；第一期不需要额外做 latest job API。

### 7.2 Storefront Image Search API

```txt
POST /api/image-search/search
```

认证与安全：

- 前台匿名访客可用。
- 必须校验 `shop` / `shopDomain` 是合法 myshopify domain。
- 所有 PostgreSQL 和 Milvus 查询必须强制按 `shop_domain` 过滤。
- 不信任前端传来的 product / variant 数据。

输入：

```txt
multipart/form-data
image=<file>
shop=<myshopify domain>
anonymousId=<uuid/string>
limit=12
availableOnly=true|false
customerId=<optional>
```

输出：

```json
{
  "uploadId": "uuid",
  "results": [
    {
      "productId": "internal-or-gid",
      "productGid": "gid://shopify/Product/...",
      "variantId": "1234567890",
      "variantGid": "gid://shopify/ProductVariant/...",
      "title": "3170/S Rectangular Sunglasses",
      "handle": "3170-s-rectangular-sunglasses",
      "imageUrl": "https://cdn.shopify.com/...",
      "price": "244.00",
      "currencyCode": "CAD",
      "availableForSale": true,
      "similarityScore": 0.91,
      "isFavorited": false
    }
  ],
  "favorites": [],
  "recentUploads": [],
  "queryMeta": {
    "model": "openai/clip-vit-base-patch16",
    "dimension": 512,
    "availableOnly": true
  }
}
```

### 7.3 Storefront Similar Products API

```txt
GET /api/recommendations/similar-products
```

参数：

```txt
shop=<myshopify domain>
productGid=<gid://shopify/Product/...>
limit=10
availableOnly=true
anonymousId=<optional>
```

输出：

```json
{
  "sourceProductId": "gid://shopify/Product/...",
  "sourceImageId": "gid://shopify/MediaImage/...",
  "results": []
}
```

行为：

1. 根据 `shop_domain + productGid` 找当前商品。
2. 优先找当前商品 featured image 的 indexed vector。
3. 如果没有，找第一张 indexed image。
4. 如果仍没有，返回空 `results`。
5. 查 Milvus 时排除当前商品。
6. 按 `shopify_product_gid` 去重。
7. 查 PostgreSQL 拼商品卡片。

### 7.4 Favorites API

```txt
GET /api/favorites
POST /api/favorites
DELETE /api/favorites/:productId
```

第一期策略：

- 匿名用户 localStorage 必须可用。
- 后端 favorites API 可以用 `anonymousId` 同步。
- 如果 storefront customer identity 可用，则写入 `customer_gid`。
- customer identity 不稳定时，不能阻塞图搜核心链路。
- 收藏失败不能影响搜索结果展示或商品跳转。

### 7.5 Upload History API

```txt
GET /api/upload-history
POST /api/upload-history
```

第一期策略：

- 前端 localStorage 立即保存 recent upload preview。
- 后端搜索成功时可以保存 upload metadata。
- 生产环境使用 S3 / R2 / MinIO。
- 本地开发可以使用 gitignored `storage/uploads`。

## 8. Shopify Admin GraphQL 同步要求

后台索引使用当前店铺 admin session：

```ts
authenticate.admin(request)
```

开发阶段默认过滤测试商品：

```txt
tag:lenscart-test status:active
```

该过滤不能作为生产 hard-code，应封装为 source filter。

必须查询字段：

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
- `shop.currencyCode` 用作价格 currency。
- `variant.legacyResourceId` 用于 `/cart/add.js`。
- `media.image.url` 使用 Shopify CDN URL。
- `min_price` 从 variants 最低价计算。
- `total_inventory` 从 variants `inventoryQuantity` 汇总。

默认商品卡片 variant 选择：

```txt
优先第一个 available_for_sale variant
如果没有 available variant，fallback 到第一个 variant，并返回 availableForSale=false
如果没有 variant，则商品不可加购
```

图片 `is_featured` 判断：

```txt
media.id == featuredMedia.id
```

图片 `position` 使用 media 列表顺序。

## 9. PostgreSQL Data Model

使用 Prisma + PostgreSQL。第一期采用拆表设计，不采用单个 `ProductIndex` 扁平表。

### 9.1 `shop_products`

一行一个 Shopify product。

核心字段：

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

- 商品卡片展示。
- PDP 跳转 `/products/{handle}`。
- 多店铺隔离。
- Similar Products 排除当前商品。

### 9.2 `shop_product_variants`

一行一个 Shopify variant。

核心字段：

```txt
id
product_id
shop_domain
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

关键规则：

```txt
shopify_variant_numeric_id = Shopify Admin GraphQL legacyResourceId
```

前台 Add to Cart 必须使用：

```txt
POST /cart/add.js
id = shopify_variant_numeric_id
quantity = 1
```

### 9.3 `shop_product_images`

一行一张 Shopify product media image。

核心字段：

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
milvus_vector_id 为空
force re-index
embedding_status = failed 且用户重新触发索引
```

成功后回写：

```txt
embedding_status = indexed
embedding_provider = fastapi-clip
embedding_model = openai/clip-vit-base-patch16
embedding_dimension = 512
milvus_collection = product_image_embeddings_512
milvus_vector_id = stable vector id
last_embedded_at = now()
embedding_error = null
```

失败后回写：

```txt
embedding_status = failed
embedding_error = 错误摘要
```

### 9.4 `product_index_jobs`

记录一次后台索引任务。

核心字段：

```txt
id
shop_domain
status
source_filter
mode
products_seen
variants_seen
images_seen
images_indexed
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

设计规则：

- 单张图片失败不终止整个 job。
- 致命错误才让 job 进入 `failed`。
- `images_failed > 0` 时 job 可为 `completed`。
- 后台 `/app` 必须显示最近 job 状态和失败数量。

### 9.5 `image_search_uploads`

保存最近上传图片元数据，不把 full-size image binary 存 PostgreSQL。

核心字段：

```txt
id
shop_domain
anonymous_id
customer_gid
image_storage_key
thumbnail_url
original_filename
content_type
file_size
created_at
```

配置：

```txt
UPLOAD_STORAGE_PROVIDER=local | s3
UPLOAD_STORAGE_BUCKET=
UPLOAD_STORAGE_ENDPOINT=
UPLOAD_STORAGE_ACCESS_KEY_ID=
UPLOAD_STORAGE_SECRET_ACCESS_KEY=
UPLOAD_STORAGE_PUBLIC_BASE_URL=
```

### 9.6 `favorite_products`

保存收藏状态，支持匿名用户和未来登录 customer 合并。

核心字段：

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

匿名唯一约束：

```txt
(shop_domain, anonymous_id, shopify_product_gid)
```

如果 `customer_gid` 可用，后续可增加 customer 唯一约束：

```txt
(shop_domain, customer_gid, shopify_product_gid)
```

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

## 10. Milvus Collection Design

### 10.1 Collection

```txt
product_image_embeddings_512
```

### 10.2 Dimension

```txt
512
```

### 10.3 Metric

```txt
inner product
```

要求：

```txt
所有 image embedding 写入前必须 L2 normalize。
query image embedding 也必须 L2 normalize。
```

对于 L2-normalized CLIP embedding，inner product 排序等价于 cosine similarity。

### 10.4 Fields

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

### 10.5 Stable `vector_id`

```txt
sha256(shop_domain + "::" + shopify_media_gid + "::" + embedding_model)
```

好处：

- 同一图片同一模型重复索引时不会无限增长。
- force re-index 可 delete + insert 或 upsert。
- PostgreSQL `shop_product_images.milvus_vector_id` 可稳定关联 Milvus。

### 10.6 查询规则

所有 Milvus 检索必须带：

```txt
shop_domain == 当前店铺
```

如果启用 Available Products Only：

```txt
available_for_sale == true
```

PDP Similar Products 还必须排除：

```txt
shopify_product_gid != 当前商品
```

### 10.7 去重规则

Milvus 返回图片级结果；后端返回商品级结果。

因此 Image Search 和 PDP Similar Products 都必须：

```txt
按 shopify_product_gid 去重
保留 similarityScore 最高的一条
最多返回 limit 个商品
```

为了抵消去重和 PostgreSQL 过滤，Milvus 查询：

```txt
topK = limit * 2 或 limit * 3
```

## 11. Embedding Service Design

### 11.1 技术栈

```txt
Python FastAPI
PyTorch
Hugging Face Transformers
Model: openai/clip-vit-base-patch16
```

Node app 不加载 PyTorch，只通过 HTTP 调用 embedding 服务。

### 11.2 Runtime config

```txt
IMAGE_EMBEDDING_SERVICE_URL=http://127.0.0.1:<EMBEDDING_PORT>
IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch16
IMAGE_EMBEDDING_DIMENSION=512
```

如果已有代码使用短命名，可以在实现中兼容：

```txt
EMBEDDING_API_URL
EMBEDDING_DIMENSION
```

主 spec 使用 `IMAGE_EMBEDDING_*`，因为语义更明确。

### 11.3 `GET /health`

返回：

```json
{
  "ok": true,
  "model": "openai/clip-vit-base-patch16",
  "dimension": 512
}
```

### 11.4 `POST /embed/image`

输入支持两种方式：

1. 商品索引阶段：image URL。
2. 前台图搜阶段：multipart image file 或 Node 转发 buffer。

返回：

```json
{
  "model": "openai/clip-vit-base-patch16",
  "dimension": 512,
  "embedding": [0.0123, -0.0456]
}
```

Node 后端必须校验：

```txt
model == openai/clip-vit-base-patch16
dimension == 512
embedding.length == 512
embedding 已 L2 normalize 或由后端再次 normalize
```

### 11.5 后续预留

第一期不实现 text search，但模型路线允许未来增加：

```txt
POST /embed/text
```

未来用于：

- text search
- image + text hybrid search
- chat assistant recommendation
- review-aware rerank 的候选生成

## 12. Theme App Extension Design

第一期包含两个 storefront surface：

```txt
App Embed:
右下角悬浮入口 + Image Search modal

Product App Block / Section:
PDP Similar Products
```

### 12.1 Image Search modal layout

```txt
Image Search Modal
├─ Header
│  ├─ Image Search 标题
│  └─ 关闭按钮
├─ Left Panel
│  ├─ 当前上传图片 preview
│  ├─ Upload New Image 按钮
│  └─ 最近上传图片 thumbnails
└─ Right Panel
   ├─ Available Products Only checkbox
   ├─ Sort by: Most Relevant
   └─ Product Result Grid
      ├─ product image
      ├─ favorite button
      ├─ find similar button/icon 预留
      ├─ Add to Cart button
      ├─ title
      ├─ variant / size label
      └─ price
```

第一期必须实现：

- 打开 / 关闭 modal。
- 上传图片。
- 图片 preview。
- 搜索 loading。
- 商品结果 grid。
- 空状态。
- 错误状态。
- 商品点击跳转 `/products/{handle}`。
- Add to Cart 不跳转、不关闭 modal。
- 收藏按钮。
- Available Products Only。
- Sort by Most Relevant 静态展示或唯一选项。
- recent uploads localStorage 展示。

第一期预留但不完整实现：

- Find Similar based on result product。
- 图片裁剪 / 框选。
- 多排序。
- review evidence。
- complete-the-look。

### 12.2 Storefront state model

前台脚本管理：

```txt
modalOpen
selectedUploadImage
searchStatus
searchResults
addToCartStateByVariant
favoriteStateByProduct
recentUploads
availableOnly
error
emptyState
anonymousId
```

localStorage keys：

```txt
lensCartAi.anonymousId
lensCartAi.recentUploads
lensCartAi.favoriteProducts
```

规则：

- 没有 anonymousId 时前端生成并保存。
- recent uploads 先 localStorage 保存，搜索失败后仍然可见。
- favorite toggle 立即更新 UI，再尝试同步后端。
- 后端同步失败不能回滚核心搜索结果。
- 如果以后拿到 customer identity，可以把 anonymous favorites/upload history 合并到 customer。

### 12.3 PDP Similar Products UI

位置：

```txt
Shopify native product detail page 下方，由商家在 Theme Editor 中放置。
```

展示：

```txt
Similar Products
└─ horizontal cards 或 compact grid
```

行为：

- 加载中显示轻量 loading 或 skeleton。
- 无 indexed source image 时隐藏或轻量 empty。
- API 失败不能影响 PDP 主内容。
- 推荐结果不包含当前商品。
- 商品卡片行为与 Image Search 一致：
  - card body 点击 `/products/{handle}`
  - Add to Cart 调 `/cart/add.js`
  - favorite toggle 不跳转

## 13. Error Handling

### 13.1 前台 Image Search

状态：

```txt
idle
uploading/searching
success
empty
error
```

错误文案：

```txt
Unsupported file:
Please upload a JPG, PNG, or WebP image.

File too large:
Image is too large. Please upload a smaller image.

Embedding failed:
We couldn't analyze this image. Please try again.

No results:
No similar products found.

Backend error:
Something went wrong. Please try again.
```

限制：

```txt
accepted content types:
image/jpeg
image/png
image/webp

max file size:
5MB
```

### 13.2 Add to Cart

状态：

```txt
idle
adding
added
error
disabled
```

行为：

- 成功：显示 `Added`。
- 失败：恢复 `Add to Cart`，显示 `Unable to add item to cart. Please try again.`
- 不可售：禁用按钮，显示 `Sold out` 或 `Unavailable`。

### 13.3 Favorites

状态：

```txt
favorited
not_favorited
saving
error
```

行为：

- 点击后立即切换 UI。
- 后端失败时可以显示轻量提示。
- 收藏失败不能影响搜索结果或跳转。

### 13.4 Backend

后端必须：

- 校验 shop domain。
- 校验图片类型和大小。
- 不信任前端传来的 product / variant 数据。
- 所有 PostgreSQL 和 Milvus 查询强制按 `shop_domain` 过滤。
- embedding response 必须校验 model / dimension / length。
- Milvus 失败返回受控错误。
- PostgreSQL 缺失商品记录时过滤该结果。
- 索引失败写入 `embedding_error` 和 `product_index_jobs`。
- 记录 request id / job id，方便排查。

## 14. Upload Storage

生产 upload images 和 thumbnails 使用 S3-compatible object storage，例如：

- AWS S3
- Cloudflare R2
- MinIO

配置：

```txt
UPLOAD_STORAGE_PROVIDER=s3
UPLOAD_STORAGE_BUCKET=
UPLOAD_STORAGE_ENDPOINT=
UPLOAD_STORAGE_ACCESS_KEY_ID=
UPLOAD_STORAGE_SECRET_ACCESS_KEY=
UPLOAD_STORAGE_PUBLIC_BASE_URL=
```

本地开发可使用 filesystem storage：

```txt
UPLOAD_STORAGE_PROVIDER=local
```

本地文件路径建议使用 gitignored：

```txt
storage/uploads
```

第一期实现优先级：

1. localStorage recent uploads 保证前台体验。
2. 后端保存 upload metadata。
3. 对象存储作为生产部署能力补齐。

## 15. Testing Strategy

按分块验证，不等全部完成才测试。

### 15.1 环境测试

验证：

```txt
DATABASE_URL 可连接 PostgreSQL
Milvus 可连接
Embedding service GET /health 正常
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

### 15.3 Shopify Admin API 测试

用开发 filter：

```txt
tag:lenscart-test status:active
```

确认能拿到：

```txt
products
variants
images
shop.currencyCode
variant.legacyResourceId
media.image.url
```

### 15.4 后台索引链路测试

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
milvus_vector_id 非空
```

Milvus：

```txt
product_image_embeddings_512 有对应 vectors
```

### 15.5 Image Search API 测试

调用：

```txt
POST /api/image-search/search
```

期望每条 result 有：

```txt
productGid
variantId numeric
variantGid
title
handle
imageUrl
price
currencyCode
availableForSale
similarityScore
isFavorited
```

### 15.6 前台 Image Search 测试

验证：

- 点击悬浮入口打开 modal。
- 上传图片显示 preview。
- loading 后显示结果 grid。
- 商品卡片主体跳转 `/products/{handle}`。
- Add to Cart 不跳转、不关闭 modal。
- 加购成功显示 `Added`。
- 收藏按钮可切换并保持。
- Available Products Only 会影响结果。
- recent uploads 在搜索失败后仍显示。
- 错误和空状态显示在 modal 内。

### 15.7 PDP Similar Products 测试

验证：

- PDP 下方出现 Similar Products。
- 推荐商品不包含当前商品。
- featured image 没 indexed 时 fallback 第一张 indexed image。
- 没有 indexed image 时不影响 PDP 主内容。
- 点击推荐商品跳转详情。
- Add to Cart 不跳转、不刷新。
- Favorite 不触发跳转。

## 16. Implementation Order

```txt
1. Prisma/PostgreSQL schema 迁移。
2. Python FastAPI embedding 服务：GET /health 和 POST /embed/image。
3. Milvus collection 初始化与 vector repository 封装。
4. Shopify Admin GraphQL 商品同步与 PostgreSQL upsert。
5. 后台 /app 索引管理页和 product_index_jobs 展示。
6. 商品图片 embedding + Milvus 写入 + PostgreSQL 状态回写。
7. Image Search 后端搜索 API。
8. Favorite 和 upload history API/localStorage 合作机制。
9. Theme App Extension App Embed：悬浮入口 + Image Search modal。
10. 商品卡片跳转、Add to Cart、收藏、recent uploads。
11. PDP Similar Products API。
12. Theme App Extension Product App Block/Section。
13. 端到端验证和错误状态打磨。
```

## 17. Deployment Notes

本地开发启动顺序：

```txt
1. PostgreSQL
2. Milvus
3. services/embedding FastAPI service
4. Shopify React Router app
5. Theme App Extension preview
6. Product indexing job
```

生产部署：

- Shopify app backend 和 FastAPI embedding service 分开部署。
- `IMAGE_EMBEDDING_SERVICE_URL` 尽量使用内网地址。
- 使用 managed PostgreSQL。
- 使用 managed 或 self-hosted Milvus。
- 使用 S3-compatible object storage 保存 upload assets。
- Milvus collection dimension 必须在索引前固定为 512。
- 更换 embedding model 或 dimension 时必须新建 collection 并重新索引。

## 18. Acceptance Criteria

第一期完成时必须满足：

- Storefront 悬浮入口能打开 Image Search modal。
- Modal 支持上传图片、preview、recent uploads、favorite、result grid。
- 上传图片调用真实 FastAPI CLIP embedding 服务。
- 搜索使用 Milvus 512 维向量并从 PostgreSQL 返回商品展示数据。
- 商品卡片点击跳转 Shopify 原生 PDP。
- Add to Cart 使用 `/cart/add.js`，不跳转、不关闭 modal。
- Add to Cart 使用 Shopify numeric variant ID。
- Favorites 可切换并重新访问。
- PDP 显示基于 indexed product image vector 的 Similar Products。
- Similar Products 优先用 featured indexed image，fallback 第一张 indexed image。
- Product indexing 能从 Shopify Admin product data 填充 PostgreSQL 和 Milvus。
- Embedding、search、add-to-cart、favorites、upload history、similar products 错误都有受控 UI 状态。

## 19. Final Decisions Summary

```txt
1. 第一期开完整闭环：后台索引 + 前台 Image Search + PDP Similar Products。
2. Embedding 服务使用独立 Python FastAPI + openai/clip-vit-base-patch16。
3. 向量维度固定为 512。
4. Milvus collection 使用 product_image_embeddings_512。
5. Milvus metric 使用 L2-normalized vectors + inner product。
6. PostgreSQL 是业务真相源，Milvus 只负责相似度检索。
7. PostgreSQL 使用 product / variant / image / job / upload / favorite 拆表设计。
8. 商品卡片点击跳转 /products/{handle}。
9. Add to Cart 使用 variant numeric ID 调 /cart/add.js，不跳转、不关闭 modal。
10. Shopify Admin API 必须拉 legacyResourceId、currencyCode、Shopify CDN image URL。
11. 后台索引按钮放在 /app 首页。
12. PDP Similar Products 优先使用当前商品 featured image 的 indexed vector，fallback 第一张 indexed image。
13. 第一版 Similar Products 做视觉相似；搭配推荐只预留。
14. 匿名收藏和 recent uploads localStorage 必须可用；后端可用时按 anonymousId/customer identity 同步。
15. 所有 PostgreSQL 和 Milvus 操作必须按 shop_domain 隔离。
```
