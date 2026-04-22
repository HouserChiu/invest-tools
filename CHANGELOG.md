# Changelog

本文件记录 `invest-tools` 的主要版本演进。

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
