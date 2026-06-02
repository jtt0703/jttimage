# 2026-05-29 图搜功能讨论总结 / 下次会话 Handoff

## 1. 当前项目状态

项目目录：

```txt
/Users/apple/Desktop/jttapp/lens-cart-ai
```

当前项目是 Shopify React Router App 模板，已有基础文件：

```txt
app/
extensions/
prisma/schema.prisma
shopify.app.toml
shopify.web.toml
package.json
```

当前技术栈：

```txt
Shopify React Router App
React Router 7
TypeScript
Prisma
Shopify App Bridge
Shopify Admin GraphQL API
Theme App Extension，后续要做前台悬浮窗
```

当前 `prisma/schema.prisma` 还是模板状态，只有 `Session` 表，datasource 仍是 SQLite，需要在后续实现时改为 PostgreSQL。

## 2. 产品完整目标

这个 App 不是单独的图搜插件，而是 Shopify 店铺前台的统一 AI 导购悬浮窗。

完整目标：

```txt
店铺前台右下角悬浮球
  ↓
打开统一导购容器
  ├─ 图搜
  ├─ 文字搜
  ├─ 查看购物车 / Smart Cart
  └─ 对话导购
```

重要原则：

- 功能不要被简化掉。
- 只是开发顺序要一个功能一个功能来。
- 每做完一块都要及时测试，接口测试或运行测试。
- 当前第一期先做图搜，但后续文字搜、购物车、对话导购都要继续完成。

## 3. 第一期开工功能：前台图搜

用户最终选择第一期直接做前台方案，而不是只做后台测试页。

第一期目标：

```txt
右下角悬浮球
  ↓
打开 Image Search 弹窗
  ↓
用户上传图片
  ↓
后端生成 1024 维 image embedding
  ↓
Milvus 检索相似商品图片
  ↓
PostgreSQL 查询商品展示数据
  ↓
前台展示商品 grid
  ↓
用户可以 Add to Cart 和收藏
```

不在第一期做：

```txt
文字搜索
Smart Cart / 购物车推荐页
对话导购
评论证据推荐
数据分析报表
A/B Test
图片裁剪选区搜索
```

这些不是不要，而是后续独立模块继续设计和开发。

## 4. 第一版前台 UI 方向

用户提供了一张参考图：`/Users/apple/Desktop/download-3.png`。

期望 UI：

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
   ├─ Available Products Only
   ├─ Sort by: Most Relevant
   └─ 商品结果 Grid
      ├─ 商品图片
      ├─ 收藏按钮
      ├─ Add to Cart 按钮
      ├─ 商品标题
      ├─ 价格
      └─ 可选尺码/变体信息
```

第一期必须做：

```txt
上传图片
图片预览
图搜结果 grid
商品标题
商品图片
价格
Add to Cart
收藏
加载状态
空结果状态
错误提示
关闭弹窗
```

第一期可预留但不完整做：

```txt
最近上传图片缩略图
Available Products Only 的完整交互
Sort by Most Relevant 的多排序选项
单品继续找相似
图片裁剪/框选区域
评论证据展示
```

Add to Cart 行为：

```txt
点击 Add to Cart
  ↓
调用 Shopify Ajax Cart API /cart/add.js
  ↓
按钮变成 Added
  ↓
不跳转页面
不关闭弹窗
不清空搜索结果
```

## 5. Embedding 模型讨论

用户希望 Milvus 使用 1024 维向量。

结论：

```txt
第一版必须选一个输出 1024 维 image embedding 的模型。
Milvus collection 创建时 dimension 固定为 1024。
如果未来换成非 1024 维模型，需要新建 collection 并重新索引商品图片。
```

用户会向公司要 embedding API。

给公司的说明方向：

```txt
图搜功能需要多模态 image embedding 模型，把商品图片和用户上传图片转换为 1024 维向量，再写入 Milvus 做相似度检索。

该模型不是用来生成图片，也不是用来聊天，而是用于视觉相似度搜索，适合 Shopify 商品图搜、相似款推荐、搭配推荐等电商场景。

建议第一版使用公司账号下的托管 API，而不是个人账号承担费用。后续如有成本或数据合规要求，可以迁移到自托管模型。
```

API Key 未到时，开发可以先用 `MockEmbeddingProvider`：

```txt
MockEmbeddingProvider 生成 1024 维 mock vector
RealEmbeddingProvider 等公司 API 到手后接入
```

Mock 可以跑通：

```txt
PostgreSQL
Milvus
索引接口
图搜接口
前台 UI
Add to Cart
收藏
```

但不能验证真实“图片像不像”。

## 6. Milvus 的角色

Milvus 用于向量相似度检索。

一句话分工：

```txt
Milvus 负责“像不像”
PostgreSQL 负责“这个商品是谁、多少钱、能不能买、谁收藏了它”
```

Milvus 可以存标量字段，但不要作为主业务数据库。

推荐 Milvus 存：

```txt
vector_id
embedding FloatVector(1024)
shop_domain
shopify_product_gid
shopify_media_gid
shopify_variant_gid
available_for_sale
product_type
status
created_at_unix
```

检索时必须按店铺隔离：

```txt
shop_domain == 当前店铺
```

如果启用 Available Products Only，则加：

```txt
available_for_sale == true
```

## 7. PostgreSQL 决策

用户已经在云服务器创建好了 PostgreSQL 数据库。

结论：

```txt
第一版直接使用 PostgreSQL，不再使用 SQLite 过渡。
```

后续要把 Prisma datasource 改成：

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

用户后续需要准备：

```txt
DATABASE_URL
```

注意不要把数据库密码直接贴进聊天里，应通过 `.env` 配置。

## 8. Shopify 测试商品准备

另一个会话正在准备测试商品：

```txt
墨镜 5 个
包 5 个
外套 5 个
鞋 5 个
裙子/配饰 5 个
```

建议商品要求：

```txt
每个商品有清晰主图
每个商品至少一个 variant
variant 有价格
商品状态 active
有库存或可购买
handle 正常
图片类别明显
```

可选但推荐 tags：

```txt
lenscart-test
sunglasses
bag
outerwear
shoes
dress
accessory
```

开发阶段可以用 Shopify Admin API 过滤测试商品：

```txt
tag:lenscart-test status:active
```

但生产环境不能 hard-code 这个过滤条件。

## 9. 商品数据什么时候写入 PostgreSQL 和 Milvus

商品不是用户搜索时才转向量，而是提前索引。

第一版索引入口建议是商家后台按钮：

```txt
Index product images
Re-index product images
```

索引流程：

```txt
Shopify Admin API 拉商品
  ↓
保存商品、变体、图片元数据到 PostgreSQL
  ↓
调用 embedding provider 生成 1024 维向量
  ↓
向量写入 Milvus
  ↓
更新 PostgreSQL 图片 embedding 状态和 milvus_vector_id
```

真实图搜必须先有索引数据：

```txt
没有 Milvus 向量：无法搜索相似图片
没有 PostgreSQL 元数据：无法展示商品标题、价格、图片、variantId
```

代码开发可以先用 mock 数据，但真实端到端测试必须先完成商品索引。

## 10. 数据库 schema handoff 文档

另一个会话写了：

```txt
/Users/apple/Desktop/jttapp/outputs/shopify_product_import_template/lenscart-product-data-schema-handoff.md
```

我们已经审阅并修改过。

保留主体表：

```txt
shop_products
shop_product_variants
shop_product_images
product_index_jobs
```

新增/修正：

```txt
customer_favorites
shop_product_variants.shopify_variant_numeric_id
Milvus available_for_sale
前台返回 variantId / variantGid / isFavorited
Shopify Admin GraphQL 查询增加 shop.currencyCode 和 variant.legacyResourceId
```

重要原因：

- Shopify Ajax Cart `/cart/add.js` 需要 variant numeric ID，不是 GraphQL GID。
- 登录用户收藏需要写 PostgreSQL。
- 匿名访客收藏第一版只保存在 localStorage，不写后端数据库。
- Available Products Only 最好在 Milvus 检索阶段过滤。

## 11. 推荐 PostgreSQL 表

### `shop_products`

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

### `shop_product_variants`

一行一个 variant。

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

`shopify_variant_numeric_id` 必须有，因为 Add to Cart 要用。

### `shop_product_images`

一张商品图片一行，也是一条 Milvus vector 的来源。

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

### `product_index_jobs`

记录商家点击索引按钮后的运行状态。

关键字段：

```txt
id
shop_domain
status
source_filter
products_seen
images_seen
images_indexed
images_failed
error_message
started_at
completed_at
created_at
updated_at
```

### `customer_favorites`

只保存登录用户收藏。

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

匿名访客收藏不写 PostgreSQL，第一版保存在前端 localStorage。

## 12. API 初步方向

后续正式设计文档还没写完，但已讨论出方向。

### 商品索引接口

```txt
POST /api/image-search/index-products
```

作用：

```txt
通过 Shopify Admin API 拉商品
写 PostgreSQL
生成 embedding
写 Milvus
记录 product_index_jobs
```

### 图搜接口

```txt
POST /api/image-search/search
```

输入：

```txt
image file
shop
limit
availableOnly
customerId 可选
```

输出：

```txt
results: [
  {
    productId,
    variantId,      // numeric id for /cart/add.js
    variantGid,
    title,
    handle,
    imageUrl,
    price,
    currencyCode,
    availableForSale,
    similarityScore,
    isFavorited
  }
]
```

### 收藏接口

```txt
GET /api/favorites
POST /api/favorites
DELETE /api/favorites
```

只用于登录用户写 PostgreSQL。匿名访客本地保存。

### 加购

前台直接调用 Shopify Ajax Cart API：

```txt
POST /cart/add.js
```

使用：

```txt
variantId = shopify_variant_numeric_id
quantity = 1
```

## 13. 评论证据和推荐

用户希望未来图搜结果不仅按图片相似度返回，还能结合真实用户评价推荐，并在结果中展示真实评价证据。

结论：

```txt
评论证据方向正确，但不要和第一版图搜核心一起完整开发。
```

原因：评论证据本身是独立链路：

```txt
接入 Judge.me / Loox / Okendo / CSV
同步评论
清洗评论
抽取标签
保存 review evidence
重排图搜结果
前台展示评价证据
```

第一版只预留 UI/字段可能性，不做完整评论推荐。

后续评论证据模块完成后，图搜排序可以升级为：

```txt
similarityScore + ratingScore + reviewTagScore + availabilityScore
```

## 14. 事件分析

第一版不做事件分析。

用户要求：

```txt
现在先跑通功能，不分析数据。
等图搜、文字搜、购物车都完成后，再统一设计分析体系。
```

所以第一版不建：

```txt
SearchEvent
ProductClickEvent
AddToCartEvent
FavoriteEvent
RecommendationEvent
```

## 15. 下次会话建议继续做什么

下次应该继续完成图搜第一期正式设计，而不是直接写代码。

当前 brainstorming 流程状态：

```txt
已完成：
- 查看项目结构
- 确认第一期选择前台 C 方案
- 确认右下角悬浮球 + Image Search 弹窗
- 确认 PostgreSQL + Milvus + 1024 维 embedding
- 确认测试商品和 Shopify Admin API 数据来源
- 审阅并修正 schema handoff

未完成：
- 正式写 image-search design spec
- spec 自检
- 用户审阅 spec
- 写 implementation plan
- 开始代码实现
```

建议下次第一步：

```txt
继续完善并写入：
lens-cart-ai/docs/superpowers/specs/2026-05-29-image-search-design.md
```

正式设计文档应覆盖：

```txt
1. 功能范围
2. 前台 UI 与交互
3. PostgreSQL schema
4. Milvus collection
5. Shopify Admin API 同步流程
6. EmbeddingProvider 抽象
7. 商品索引流程
8. 图搜接口
9. 收藏逻辑
10. Add to Cart 逻辑
11. 错误处理
12. 分块测试计划
13. 不做项和后续模块
```

用户特别强调：

```txt
图搜具体怎么开发非常重要。
但今天讨论的所有内容也都重要。
下一次一定要基于这里继续，不要重新简化或推翻已确认方向。
```
