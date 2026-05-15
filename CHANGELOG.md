# Changelog

本文件记录 `invest-tools` 的主要版本演进。

## V0.5.0

1. 重构整体运行时与数据链路，核心能力迁移到 Cloudflare Worker + D1。
2. 静态页面、认证、持仓、交易流水、已实现盈亏、复盘指标统一接入 Cloudflare。
3. 行情接口迁移到 Worker，直接通过 Yahoo Finance 获取并结合 D1 缓存。
4. 新增账户间转账、换汇、负现金余额等账本能力。
5. 移除对旧独立服务器部署链路的依赖，当前以 Cloudflare 为唯一正式部署目标。

## V0.4.0

1. 行情数据通过 Yahoo Finance 获取。
2. 直接请求会被限流。
3. 通过 Python Web 代理了一次请求，可以拿到数据。

## V0.3.0

1. 重构了前端代码版本。
2. 使用 Google Stitch。

## V0.2.0

1. 加入了资讯信息。
2. 从 API 获取行情数据。
3. 美股股票、汇率：`EODHD`。
4. 韩股：`Python FinanceDataReader`。
5. 期权：`Polygon`。
6. 贵金属 / 外汇：`Polygon`。
7. 加密货币：`Python ccxt.binance`，失败再回退 `Binance / CoinGecko`。
8. 缺点是 API 有限额，解锁需要付费获得配额。

## V0.1.0

1. 版本是手动填入的。
2. 行情数据也是手动填入的。
3. 只有持仓工具。
