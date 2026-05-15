# Cloudflare Migration Blueprint

## 目标

把当前网站从：

- `Express + EJS + MySQL + Python quote proxy`

逐步迁移到：

- `Cloudflare Workers + Static Assets + D1`

## 当前阶段

这轮重构已经补上 4 个迁移支点：

1. `lib/site-content.js`
   - 抽出站点内容加载和 Markdown 富化逻辑
   - 可被 Node 服务和静态构建脚本复用

2. `scripts/build-static-site.mjs`
   - 把 EJS 页面编译到 `dist/`
   - 为 Cloudflare Static Assets 提供可部署结果

3. `src/worker.mjs`
   - 建立 Worker 入口
   - 先处理：
     - 旧路径重定向
     - `/api/health`
     - 静态资源分发
     - 过渡期 API 回源代理

4. `cloudflare/d1/schema.sql`
   - 为 D1 准备 SQLite 口径 schema
   - 对应当前 MySQL 账本模型

## 已完成的已迁接口

### 只读接口

下面这些接口现在已经具备：

- Worker 直读 D1
- D1 缺表时回源到旧 Node 服务

接口列表：

- `/api/auth/session`
- `/api/holdings`
- `/api/transactions`
- `/api/realized-pnl`
- `/api/review-metrics`
- `/api/nav-series`

也就是说，D1 数据一旦准备好，这批接口就能优先在 Cloudflare 侧完成响应。

### 认证接口

下面这些认证接口现在也已经在 Worker 中实现：

- `/api/auth/entry`
- `/api/auth/register`
- `/api/auth/login`
- `/api/auth/logout`

当前行为：

- 优先使用 Worker + D1 完成认证
- D1 缺表时回源到旧 Node 服务
- 已兼容原有 `investment_session` Cookie

### 持仓基础写接口

下面这些持仓基础写接口现在也已经在 Worker 中实现：

- `/api/holdings` `POST`
- `/api/holdings/:id` `PUT`
- `/api/holdings/:id` `DELETE`

当前行为：

- 优先使用 Worker + D1 新增、编辑、删除持仓
- 新增持仓会同步写入 `OPENING_BALANCE` 和初始 lot
- 编辑持仓会同步写入 `SNAPSHOT_ADJUSTMENT`
- D1 缺表时仍然会回源到旧 Node 服务

### 账本写接口

下面这些账本相关写接口现在也已经在 Worker 中实现：

- `/api/holdings/:id/trades`
- `/api/holdings/:id/option-settlement`
- `/api/holdings/:id/option-expire`
- `/api/transactions/:id/revert`

当前行为：

- 优先使用 Worker + D1 完成加仓 / 减仓 / 清仓
- 优先使用 Worker + D1 完成期权行权 / 指派 / 到期
- 优先使用 Worker + D1 完成支持类型的交易撤销
- D1 缺表时仍然会回源到旧 Node 服务

### 行情接口

下面这些行情接口现在也已经在 Worker 中实现：

- `/api/prices/lookup`
- `/api/prices/refresh`
- `/api/prices/refresh/:id`

当前行为：

- 优先使用 Worker 内部的 Yahoo Finance 抓取逻辑
- 优先使用 D1 `market_quotes` 做缓存
- D1 缺表时仍然会回源到旧 Node 服务

需要注意：

- 在中国大陆本机直接跑 `wrangler dev` 时，请求仍然会使用本地网络出口
- 这时 Yahoo Finance 可能直接返回地区封锁页 `403`
- 正式部署到 Cloudflare Edge 后，Worker 的出网位置不再是本机，实际可用性要以线上环境为准

## 推荐迁移顺序

### Phase 1：静态页面先落到 Cloudflare

1. 运行静态构建
2. 用 Worker + Static Assets 托管页面
3. API 暂时通过 `LEGACY_API_ORIGIN` 回源到现有 Node 服务

### Phase 2：数据库迁移到 D1

1. 创建 D1 数据库
2. 导入 `cloudflare/d1/schema.sql`
3. 从 MySQL 导出并迁移：
   - users
   - sessions
   - holdings
   - market_quotes
   - portfolios
   - accounts
   - instruments
   - portfolio_transactions
   - position_lots
   - realized_pnl_ledger
   - price_snapshots
   - fx_snapshots
   - nav_snapshots
   - corporate_actions
   - sync_logs

### 已提供的迁移脚本

当前仓库已经提供：

- [scripts/export-d1-seed.mjs](/Users/houser/Documents/05_investment_website/scripts/export-d1-seed.mjs)

它会：

1. 读取 `.env` / `.env.example` 里的 MySQL 连接
2. 从当前 MySQL 导出账本相关表
3. 生成 D1 可执行 SQL：
   - [cloudflare/d1/seed.sql](/Users/houser/Documents/05_investment_website/cloudflare/d1/seed.sql)

可用命令：

```bash
npm run d1:seed:build
```

如果你要直接导入本地 D1：

```bash
npm run d1:seed:local
```

这个命令会按顺序执行：

1. 重新导出最新 `seed.sql`
2. 应用 [cloudflare/d1/schema.sql](/Users/houser/Documents/05_investment_website/cloudflare/d1/schema.sql)
3. 应用 [cloudflare/d1/seed.sql](/Users/houser/Documents/05_investment_website/cloudflare/d1/seed.sql)

### Phase 3：把 `/api/*` 迁到 Worker

建议按下面顺序拆：

1. 只读接口
   - `/api/config/public`
   - `/api/holdings`
   - `/api/transactions`
   - `/api/realized-pnl`
   - `/api/review-metrics`
   - `/api/nav-series`

2. 认证接口
   - `/api/auth/session`
   - `/api/auth/entry`
   - `/api/auth/logout`

3. 行情源与缓存策略收尾
   - 验证线上 Worker 对 Yahoo Finance 的可达性
   - 如有需要，为 Yahoo 抓取增加 Cloudflare 侧兜底代理/兼容策略
   - 彻底移除本地 `quote_proxy.py` 依赖

## 行情代理重写方向

现有 `quote_proxy.py` 不能直接部署到 Workers。

后续要把它重写为：

- Worker 内部的 Yahoo Finance fetch 逻辑
- 配合 D1 `market_quotes` 做缓存
- 逐步替代现有 Python 代理进程

## 当前可用命令

```bash
npm run build:static
npm run cf:dev
npm run cf:deploy
```

## 本地 Cloudflare 调试

1. 复制配置模板

```bash
cp .dev.vars.example .dev.vars
```

2. 保持现有 Node 服务运行在 `127.0.0.1:4173`

3. 启动 Worker 本地开发

```bash
npm run cf:dev
```

默认会：

- 先构建 `dist/`
- 再由 Worker 托管静态页面
- `/api/*` 暂时回源到 `LEGACY_API_ORIGIN`

### 本地回源说明

`wrangler dev` 在部分本地环境里，可能无法稳定访问宿主机的 `127.0.0.1`。

如果你发现：

- 静态页面正常
- Worker 自己的 `/api/health`、`/api/config/public` 正常
- 但其他 `/api/*` 回源超时或断开

优先把 `.dev.vars` 里的：

```bash
LEGACY_API_ORIGIN=http://127.0.0.1:4173
```

改成当前机器的局域网地址，例如：

```bash
LEGACY_API_ORIGIN=http://192.168.110.248:4173
```

这只是开发期的过渡方案。最终目标仍然是把核心 `/api/*` 全部迁到 Worker + D1。

## 注意

这轮只是把 Cloudflare 骨架搭起来，当前业务逻辑仍然以本地 `server.js` 为主。
