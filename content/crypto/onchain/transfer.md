# 链上转账

## 先看结论

链上转账最重要的三件事：

1. 地址正确
2. 网络选对
3. 钱包里预留足够的 gas

很多人第一次转账失败，不是因为地址错了，而是：

- 选错链
- 没有 gas
- 低估了手续费

## 什么是 gas 费

gas 费就是链上转账或合约操作时支付给网络的手续费。

它的作用是：

- 支付验证和打包交易的成本
- 防止网络被垃圾交易刷爆
- 在拥堵时让高优先级交易更容易先被处理

不同链的 gas 规则不一样，但原则相同：

- **在哪条链转账，就用那条链的原生币支付 gas**

## gas 费怎么支付

常见规则如下：

- `Ethereum`：用 `ETH` 支付
- `Arbitrum`：用 `ETH` 支付
- `Optimism`：用 `ETH` 支付
- `Base`：用 `ETH` 支付
- `BNB Smart Chain`：用 `BNB` 支付
- `opBNB`：用 `BNB` 支付
- `TRON`：用 `TRX` 支付
- `Solana`：用 `SOL` 支付

因此：

- 转 `USDT-TRC20`，钱包里也要留一点 `TRX`
- 转 `USDT-ERC20`，钱包里也要留一点 `ETH`
- 转 `USDT-SPL`，钱包里也要留一点 `SOL`

## 转账前怎么准备 gas

1. 先确认自己要走哪条链
2. 往钱包里预留这条链的原生币
3. 先看钱包或交易所显示的预计手续费
4. 第一次大额转账前，先小额测试

## 常见转账链

日常常见的几条链：

- `Ethereum`
- `TRON`
- `Solana`
- `BNB Smart Chain`
- `Arbitrum`
- `Optimism`
- `Base`

## 常见链的费用特点

以下费用是日常转账里常见的经验范围，实际会随拥堵变化。

### Ethereum

- gas 用 `ETH`
- 普通转账费用通常最高
- 转稳定币、做合约交互时费用波动更明显
- 常见是几美元到十几美元，拥堵时更高

### TRON

- gas 主要靠 `TRX`，资源不足时会直接扣 `TRX`
- 转 `USDT-TRC20` 很常用
- 普通转账费用通常低于以太坊
- 常见是几角人民币到几元人民币，资源状态不同会有差异

### Solana

- gas 用 `SOL`
- 单笔费用很低
- 普通转账通常接近忽略不计
- 大多是极小额，常见为几千分之一美元级别

### BNB Smart Chain

- gas 用 `BNB`
- 费用通常明显低于以太坊主网
- 日常转账比较便宜
- 常见是几美分级别

### Arbitrum / Optimism / Base

- gas 都用 `ETH`
- 作为以太坊二层，通常比主网便宜很多
- 普通转账费用常见在几美分到一美元以内
- 拥堵时也会抬升，但通常仍低于以太坊主网

## 选链时怎么判断

可以按这几个原则选：

- 追求便宜：优先看 `Solana`、`TRON`、`BSC`、主流 L2
- 追求生态兼容：优先看 `Ethereum`、`Arbitrum`、`Base`
- 交易所支持面广：`TRON`、`Ethereum`、`BSC` 更常见
- 做 DeFi 或链上协议：优先看目标协议支持哪条链

## 常见错误

- 地址对了，但网络错了
- 钱包里只有稳定币，没有 gas 币
- 转账前没看最小充值金额
- 交易所充值地址支持的网络和转出网络不一致

## 官方来源

- Ethereum Gas 官方说明  
  [https://ethereum.org/developers/docs/gas/](https://ethereum.org/developers/docs/gas/)
- Solana Fees 官方说明  
  [https://solana.com/docs/core/fees](https://solana.com/docs/core/fees)
- Solana 交易费用说明  
  [https://solana.com/learn/understanding-solana-transaction-fees](https://solana.com/learn/understanding-solana-transaction-fees)
- TRON Transactions 官方说明  
  [https://developers.tron.network/docs/tron-protocol-transaction](https://developers.tron.network/docs/tron-protocol-transaction)
- TRON Resource Model 官方说明  
  [https://developers.tron.network/docs/resource-model](https://developers.tron.network/docs/resource-model)
- opBNB Gas and Fees 官方说明  
  [https://docs.bnbchain.org/bnb-opbnb/core-concepts/gas-and-fees/](https://docs.bnbchain.org/bnb-opbnb/core-concepts/gas-and-fees/)
