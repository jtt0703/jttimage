# Image Search 第一期开发展示与索引设计

日期：2026-05-29  
项目目录：`/Users/apple/Desktop/jttapp/lens-cart-ai`

## 1. 背景与目标

本项目是 Shopify React Router App。第一期重点不是单独做一个后台测试页，而是完成面向店铺前台的图搜功能闭环。

第一期目标：

```txt
后台索引商品图片
  ↓
Shopify Admin API 拉商品、variant、图片
  ↓
PostgreSQL 保存商品业务数据和索引状态
  ↓
独立 Python FastAPI embedding 服务生成 CLIP image embedding
  ↓
Milvus 保存商品图片向量
  ↓
前台右下角悬浮球打开 Image Search 弹窗
  ↓
用户上传图片，返回相似商品 grid
  ↓
点击商品跳转 Shopify 商品详情页
  ↓
点击 Add to Cart 只加入购物车，不跳转、不关闭弹窗
  ↓
商品详情页下方显示 Similar Products 推荐区块
```

公司当前重点：

- 前台悬浮窗直接打开 Image Search 页面/弹窗。
- Image Search 结果商品可跳转商品详情页。
- Add to Cart 只加购物车，不跳转、不关闭弹窗。
- 商品详情页需要 Similar Products 推荐区块。
- 第一版 Similar Products 做视觉相似推荐；搭配推荐只预留，不完整实现。

第一期不做：

- 文字搜索。
- 对话导购。
- Smart Cart。
- 评论证据推荐。
- 完整搭配推荐。
- A/B Test。
- 数据分析报表。
- 图片裁剪/框选搜索。
- 多排序选项。
- 复杂个性化推荐。

## 2. 当前项目状态

项目目前仍接近 Shopify React Router App 模板状态：

- `prisma/schema.prisma` 仍是 SQLite datasource。
- Prisma 只有 `Session` model。
- `app/routes/app._index.tsx` 仍是模板的 Generate product 示例。
- `extensions/` 还没有完整 Theme App Extension 功能。

第一期需要把 app 改为：

- 使用 PostgreSQL。
- 新增商品、variant、图片、索引 job、收藏相关表。
- 后台首页替换为 Image Search 索引管理页。
- 新增 Theme App Extension：App Embed + PDP App Block/Section。
- 新增 Node 后端与 Milvus、Python embedding 服务的集成。

## 3. 整体架构

```txt
Shopify App 后台 /app
  └─ Index product images / Re-index product images

Shopify Admin API
  └─ 拉取测试商品、variant、商品图片

PostgreSQL
  ├─ shop_products
  ├─ shop_product_variants
  ├─ shop_product_images
  ├─ product_index_jobs
  └─ customer_favorites

Python FastAPI Embedding Service
  └─ CLIP ViT-B/16，输出 512 维 image embedding

Milvus
  └─ product_image_embeddings，FloatVector(512)

Theme App Extension
  ├─ App Embed：右下角悬浮球 + Image Search 弹窗
  └─ PDP App Block/Section：Similar Products 区块

Shopify Storefront
  ├─ 商品卡片点击跳转 /products/{handle}
  └─ Add to Cart 调 /cart/add.js，不跳转、不关闭当前弹窗/页面
```

模块分工：

```txt
PostgreSQL：商品是谁、多少钱、能不能买、图片索引状态、收藏。
Milvus：图片向量相似度检索。
Python FastAPI：生成 CLIP image embedding。
Node Shopify App：业务编排、Shopify API、PostgreSQL、Milvus、前后台 API。
Theme App Extension：店铺前台 UI 与交互。
```

## 4. 环境配置

本地 `.env` 需要配置：

```env
DATABASE_URL=postgresql://app_user:<POSTGRES_PASSWORD>@127.0.0.1:25433/appdb

MILVUS_ADDRESS=127.0.0.1:29530
MILVUS_USERNAME=root
MILVUS_PASSWORD=<MILVUS_ROOT_PASSWORD>
MILVUS_COLLECTION=product_image_embeddings

IMAGE_EMBEDDING_SERVICE_URL=http://127.0.0.1:<EMBEDDING_PORT>
IMAGE_EMBEDDING_MODEL=clip-vit-b-16
IMAGE_EMBEDDING_DIMENSION=512
```

注意：

- 密码和真实 key 不写进代码或文档示例。
- 第一版 embedding 服务是本地或独立部署的 Python FastAPI 服务，不是公司托管 embedding API。
- Milvus collection 维度固定为 512；未来如果换成 1024 维或其他模型，需要新建 collection 并重新索引商品图片。

## 5. Embedding 服务设计

### 5.1 服务定位

Embedding 服务独立于 Shopify React Router app。

职责：

```txt
输入图片 URL 或图片文件
  ↓
加载 CLIP ViT-B/16
  ↓
生成 512 维 image embedding
  ↓
返回 model、dimension、embedding
```

选择独立 Python FastAPI 的原因：

- Python / PyTorch 生态更适合 CLIP。
- Node app 不直接加载 ML 模型，部署更轻。
- 后续可单独把 embedding 服务迁移到 GPU 环境。
- CLIP ViT-B/16 原生支持图文同空间 512 维向量，后续文字搜索可复用模型路线。

### 5.2 模型

```txt
模型：CLIP ViT-B/16
模型标识：clip-vit-b-16
向量维度：512
建议归一化：L2 normalize
```

建议 Milvus 使用 cosine 或 inner product；如果 embedding 已 L2 normalize，inner product 和 cosine 排序效果等价。

### 5.3 接口

#### `GET /health`

返回：

```json
{
  "ok": true,
  "model": "clip-vit-b-16",
  "dimension": 512
}
```

#### `POST /embed/image`

商品索引阶段至少支持 image URL：

```json
{
  "imageUrl": "https://cdn.shopify.com/..."
}
```

前台 Image Search 上传图时，Node 后端可以转发 multipart 文件或 buffer 给 Python 服务。接口预留 multipart 支持。

返回：

```json
{
  "model": "clip-vit-b-16",
  "dimension": 512,
  "embedding": [0.0123, -0.0456]
}
```

Node 后端必须校验：

```txt
model == clip-vit-b-16
dimension == 512
embedding.length == 512
```

#### 后续预留：`POST /embed/text`

第一期不实现文字搜，但预留：

```json
{
  "text": "black rectangular sunglasses"
}
```

返回同样为 512 维 embedding，用于后续文字搜索、图文混合搜索和对话导购推荐。

## 6. PostgreSQL schema 设计

PostgreSQL 是业务真相源。第一期需要 5 张表：

```txt
shop_products
shop_product_variants
shop_product_images
product_index_jobs
customer_favorites
```

### 6.1 `shop_products`

一行一个 Shopify product。

关键字段：

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

- 商品卡片展示标题、handle、主图、价格。
- 商品详情跳转使用 `/products/{handle}`。
- 多店铺隔离依赖 `shop_domain`。

### 6.2 `shop_product_variants`

一行一个 Shopify variant。

关键字段：

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

关键要求：

```txt
shopify_variant_numeric_id = Shopify Admin GraphQL legacyResourceId
```

前台 Add to Cart 必须用 numeric variant ID：

```txt
POST /cart/add.js
id = shopify_variant_numeric_id
quantity = 1
```

不能只保存 GraphQL GID。

### 6.3 `shop_product_images`

一行一张 Shopify product media image。

关键字段：

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

成功写入 Milvus 后回写：

```txt
embedding_status = indexed
embedding_provider = fastapi-clip
embedding_model = clip-vit-b-16
embedding_dimension = 512
milvus_collection = product_image_embeddings
milvus_vector_id = <stable_vector_id>
last_embedded_at = now()
embedding_error = null
```

失败时：

```txt
embedding_status = failed
embedding_error = 错误摘要
```

### 6.4 `product_index_jobs`

记录一次后台索引任务。

关键字段：

```txt
id
shop_domain
status
source_filter
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

设计原则：

- 单张图片 embedding 失败不终止整个 job。
- Shopify API、PostgreSQL、Milvus、embedding 服务连接等致命错误才让 job 进入 `failed`。
- `images_failed > 0` 时 job 可以仍为 `completed`，后台要清晰显示失败图片数量。

### 6.5 `customer_favorites`

保存登录用户收藏。匿名访客收藏第一版保存在 localStorage。

关键字段：

```txt
id
shop_domain
customer_id
shopify_customer_gid
shopify_product_gid
shopify_variant_gid
source_surface
created_at
updated_at
```

唯一约束：

```txt
(shop_domain, customer_id, shopify_product_gid)
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

如果第一期无法稳定获得 storefront customer identity，收藏 UI 仍必须有；匿名 localStorage 必须有；登录用户 PostgreSQL 收藏可以放到第一期后半段完成。

## 7. Milvus collection 设计

Collection 名称：

```txt
product_image_embeddings
```

向量维度：

```txt
512
```

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

### 7.1 `vector_id`

Milvus 主键，与 `shop_product_images.milvus_vector_id` 对应。

稳定生成方式：

```txt
sha256(shop_domain + "::" + shopify_media_gid + "::" + embedding_model)
```

这样 re-index 同一图片同一模型时可以覆盖或先 delete 再 insert，避免重复向量无限增长。

### 7.2 过滤要求

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

### 7.3 PostgreSQL 与 Milvus 的关系

一张商品图对应一条 Milvus vector：

```txt
shop_product_images.id
  ↔ shop_product_images.milvus_vector_id
  ↔ product_image_embeddings.vector_id
```

搜索时：

```txt
Milvus 返回 vector_id / shopify_product_gid / shopify_media_gid / score
  ↓
后端按 shop_domain 回查 PostgreSQL
  ↓
拼出商品卡片数据
```

前台不直接访问 Milvus。

## 8. Shopify Admin API 同步流程

后台索引使用当前店铺 admin session：

```ts
authenticate.admin(request)
```

开发阶段默认过滤测试商品：

```txt
tag:lenscart-test status:active
```

该过滤不能作为生产 hard-code。应封装为：

```json
{
  "query": "tag:lenscart-test status:active",
  "mode": "development_test_products"
}
```

### 8.1 GraphQL 查询字段

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

### 8.2 PostgreSQL upsert

对每个 product：

1. upsert `shop_products`。
2. upsert `shop_product_variants`。
3. upsert `shop_product_images`。

`min_price` 从 variants 最低价计算。  
`total_inventory` 从 variants `inventoryQuantity` 汇总。

商品卡片默认 variant 选择：

```txt
优先第一个 available_for_sale variant
如果没有 available variant，fallback 到第一个 variant，并返回 availableForSale=false
```

图片 `is_featured` 判断：

```txt
media.id == featuredMedia.id
```

图片 `position` 使用 media 列表顺序。

### 8.3 Embedding + Milvus 写入

对本次需要索引的图片：

```txt
1. embedding_status = processing
2. 调用 Python FastAPI POST /embed/image
3. 校验 model/dimension/embedding length
4. 生成 stable vector_id
5. 写入 Milvus
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

## 9. 后台 `/app` 索引入口

后台首页替换模板示例功能，变为 Image Search Indexing 管理页。

页面结构：

```txt
Image Search Indexing
├─ 说明文案
├─ Index product images
├─ Re-index product images
├─ Last index job card
│  ├─ status
│  ├─ source_filter
│  ├─ products_seen
│  ├─ variants_seen
│  ├─ images_seen
│  ├─ images_indexed
│  ├─ images_failed
│  ├─ started_at
│  ├─ completed_at
│  └─ error_message
└─ Helper text: Development filter tag:lenscart-test status:active
```

### 9.1 `Index product images`

增量索引：

```txt
拉取 Shopify 当前测试商品
upsert PostgreSQL
只处理新图片、状态异常、模型/URL 变化的图片
写 Milvus
回写索引状态
```

### 9.2 `Re-index product images`

强制重建：

```txt
拉取 Shopify 当前测试商品
upsert PostgreSQL
将本次范围内图片强制设为 pending
重新生成 embedding
覆盖或重写 Milvus vector
回写索引状态
```

### 9.3 后端路由

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
  "imagesFailed": 0
}
```

后台最新 job 可以由 `/app` loader 直接查 PostgreSQL，第一期不必额外做 `GET latest job` API。

## 10. 前台 Theme App Extension

第一期包含两个前台能力：

```txt
App Embed：全站右下角悬浮球 + Image Search 弹窗
PDP App Block/Section：商品详情页 Similar Products 区块
```

### 10.1 App Embed：右下角悬浮球

位置：页面右下角。

点击行为：打开 Image Search 弹窗。

后续该悬浮球会扩展成统一 AI 导购入口，但第一期只打开图搜。

### 10.2 Image Search 弹窗布局

参考用户提供的 UI：

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
      ├─ 找相似按钮/图标（预留）
      ├─ Add to Cart 按钮
      ├─ 商品标题
      ├─ 可选尺码/variant title
      └─ 价格
```

第一期必须实现：

- 上传图片。
- 图片预览。
- 搜索加载状态。
- 商品结果 grid。
- 空结果状态。
- 错误提示。
- 关闭弹窗。
- 点击商品跳转详情页。
- Add to Cart 不跳转、不关闭。
- 收藏按钮。
- Available Products Only。
- Sort by: Most Relevant 静态展示或单选项。

第一期预留但不完整实现：

- 最近上传图片缩略图：可先 local-only 最近上传预览。
- 找相似按钮：UI 预留，后续支持基于某个结果继续找相似。
- 图片裁剪/框选。
- 多排序选项。
- 评论证据。

### 10.3 Image Search 用户流程

```txt
用户点击右下角悬浮球
  ↓
打开 Image Search Modal
  ↓
用户上传图片
  ↓
左侧显示图片预览
  ↓
前端提交 multipart/form-data 到 /api/image-search/search
  ↓
后端生成 query image embedding
  ↓
Milvus 按 shop_domain 检索相似商品图片
  ↓
PostgreSQL 拼商品卡片数据
  ↓
右侧 grid 展示结果
```

### 10.4 商品卡片跳转

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

### 10.5 Add to Cart

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

### 10.6 收藏

匿名访客：

```txt
localStorage 保存收藏状态
```

登录用户：

```txt
如果能稳定获得 customer identity，则调用收藏 API 写 PostgreSQL
```

收藏按钮点击后：

- 切换心形状态。
- 不跳转。
- 不关闭弹窗。

Image Search 来源：

```txt
source_surface = image_search
```

## 11. PDP Similar Products

### 11.1 位置

商品详情页下方，作为 Theme App Extension 的 product page app block / section，由商家在 Theme Editor 中放置到 PDP 合适位置。

展示：

```txt
Similar Products
└─ 横向或网格商品卡片
```

### 11.2 推荐逻辑

第一期只做视觉相似推荐：

```txt
当前商品 featured image
  ↓
查 PostgreSQL 该图片是否 indexed
  ↓
用对应 milvus_vector_id / vector 检索 Milvus
  ↓
排除当前商品自身
  ↓
返回相似商品卡片
```

已确认规则：

```txt
优先使用当前商品 featured image 对应的已索引向量。
如果 featured image 未 indexed，fallback 到该商品第一张 indexed 图片。
如果当前商品没有任何 indexed 图片，则隐藏区块或显示空状态。
```

第一期不做完整搭配推荐，但预留：

- `Complete the Look`。
- product_type/category rules。
- cart-aware recommendations。
- review evidence rerank。

### 11.3 PDP Similar Products 接口

```txt
GET /api/recommendations/similar-products
```

参数：

```txt
shop=<myshopify domain>
productGid=<gid://shopify/Product/...>
limit=10
availableOnly=true
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

```txt
1. 根据 shop_domain + productGid 找当前商品 indexed featured image。
2. 如果没有，找第一张 indexed image。
3. 如果还没有，返回空 results。
4. 查 Milvus 时排除当前商品。
5. 按 product 去重。
6. 查 PostgreSQL 拼商品卡片。
```

### 11.4 PDP 商品卡片交互

与 Image Search 商品卡片保持一致：

- 点击卡片主体跳转 `/products/{handle}`。
- 点击 Add to Cart 调 `/cart/add.js`，不跳转、不刷新。
- 点击收藏切换状态，不跳转。

PDP 来源：

```txt
source_surface = pdp_similar_products
```

## 12. 后端前台 API

### 12.1 Image Search 搜索接口

```txt
POST /api/image-search/search
```

认证：

- 前台匿名访客可用。
- 必须校验 `shop_domain`。
- 所有 Milvus/PostgreSQL 查询必须按 `shop_domain` 过滤。

输入：

```txt
multipart/form-data
image=<file>
shop=<myshopify domain>
limit=12
availableOnly=true|false
customerId=<optional>
```

输出：

```json
{
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
  ]
}
```

安全要求：

- 只接受合理大小图片。
- 只接受 `image/jpeg`、`image/png`、`image/webp`。
- `shop` 必须是合法 myshopify domain。
- 不信任前端传来的 product/variant 数据。
- 所有查询强制按 `shop_domain` 过滤。

### 12.2 PDP Similar Products 接口

```txt
GET /api/recommendations/similar-products
```

参数：

```txt
shop
productGid
limit
availableOnly
```

行为见第 11 节。

### 12.3 收藏接口

```txt
GET /api/favorites
POST /api/favorites
DELETE /api/favorites
```

第一期策略：

```txt
匿名访客：不调用后端，localStorage 保存。
登录用户：如果能稳定获得 customerId，则写 PostgreSQL。
```

收藏不能阻塞图搜核心链路。如果 customer identity 不稳定，先完整实现 localStorage 收藏，后端表和 API 保留。

## 13. Milvus 检索策略

### 13.1 Image Search

```txt
query embedding = uploaded image embedding
filter = shop_domain == current shop
if availableOnly:
  filter += available_for_sale == true
topK = limit * 2 或 limit * 3
```

Milvus 返回图片级结果；后端需要按商品去重：

```txt
按 shopify_product_gid 去重
保留 similarityScore 最高的一条
最多返回 limit 个商品
```

### 13.2 PDP Similar Products

```txt
source = 当前商品 featured indexed image
filter = shop_domain == current shop
filter += shopify_product_gid != 当前商品
if availableOnly:
  filter += available_for_sale == true
topK = limit * 2 或 limit * 3
```

同样按 `shopify_product_gid` 去重。

## 14. 前台状态与错误处理

### 14.1 Image Search 状态

```txt
idle
uploading/searching
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

### 14.2 PDP Similar Products 状态

```txt
loading
success
empty
error
hidden
```

行为：

- 无索引数据时隐藏区块或显示轻量空状态。
- 接口失败不能阻塞 PDP 主内容。

### 14.3 Add to Cart 状态

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

### 14.4 收藏状态

```txt
favorited
not_favorited
saving
error
```

收藏失败不应影响搜索结果展示或商品跳转。

## 15. 测试计划

按分块验证，不等全部完成才测试。

### 15.1 环境配置测试

验证：

```txt
DATABASE_URL 可连接
MILVUS_ADDRESS 可连接
IMAGE_EMBEDDING_SERVICE_URL /health 正常
```

### 15.2 PostgreSQL schema 测试

确认表存在：

```txt
shop_products
shop_product_variants
shop_product_images
product_index_jobs
customer_favorites
```

### 15.3 Shopify Admin API 拉商品测试

使用：

```txt
tag:lenscart-test status:active
```

期望拉到：

```txt
25 products
25 variants
25 images
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
products_seen = 25
variants_seen = 25
images_seen = 25
images_indexed = 25
images_failed = 0
```

PostgreSQL：

```txt
shop_products = 25
shop_product_variants = 25
shop_product_images = 25
所有 shop_product_images.embedding_status = indexed
embedding_dimension = 512
embedding_model = clip-vit-b-16
milvus_vector_id 非空
```

Milvus：

```txt
product_image_embeddings = 25 vectors
```

### 15.5 Image Search API 测试

调用：

```txt
POST /api/image-search/search
```

期望：

- 返回 results。
- 每条有 `title`、`handle`、`imageUrl`、`price`、`currencyCode`、`variantId`。
- `similarityScore` 有值。
- `variantId` 是 numeric ID。

### 15.6 前台 Image Search 弹窗测试

验证：

- 点击悬浮球打开弹窗。
- 上传图片显示预览。
- 右侧显示结果 grid。
- 点击商品卡片跳转 `/products/{handle}`。
- 点击 Add to Cart 不跳转、不关闭弹窗。
- 加购成功按钮显示 `Added`。
- 收藏心形可切换。
- Available Products Only 可影响结果。

### 15.7 PDP Similar Products 测试

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

虽然本设计覆盖完整第一期闭环，实施时应分块推进：

```txt
1. PostgreSQL schema + Prisma 迁移。
2. Python FastAPI embedding 服务 health 和 /embed/image。
3. Milvus collection 初始化和写入封装。
4. Shopify Admin API 商品同步与 PostgreSQL upsert。
5. 后台 /app 索引按钮和 product_index_jobs 展示。
6. 商品图片 embedding + Milvus upsert + PostgreSQL 回写。
7. Image Search 后端搜索接口。
8. Theme App Extension App Embed：悬浮球 + Image Search 弹窗。
9. Add to Cart、商品详情跳转、收藏 localStorage。
10. PDP Similar Products 接口和 App Block/Section。
11. 端到端验证和错误状态打磨。
```

## 17. 关键设计决定汇总

```txt
1. 第一期开完整闭环：后台索引 + 前台 Image Search + PDP Similar Products。
2. Embedding 服务使用独立 Python FastAPI + CLIP ViT-B/16。
3. 向量维度从此前讨论的 1024 改为 512。
4. Milvus collection 使用 FloatVector(512)。
5. PostgreSQL 是业务真相源，Milvus 只负责相似度检索。
6. 商品卡片点击跳转 /products/{handle}。
7. Add to Cart 使用 variant numeric ID 调 /cart/add.js，不跳转、不关闭弹窗。
8. Shopify Admin API 必须拉 legacyResourceId、currencyCode、Shopify CDN image URL。
9. 后台索引按钮放在 /app 首页。
10. PDP Similar Products 优先使用当前商品 featured image 的 indexed vector。
11. 第一版 Similar Products 做视觉相似；搭配推荐只预留。
12. 匿名收藏 localStorage；登录用户收藏视 customer identity 能力写 PostgreSQL。
13. 所有 PostgreSQL 和 Milvus 操作必须按 shop_domain 隔离。
```
