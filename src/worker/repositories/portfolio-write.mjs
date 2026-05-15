import { randomUUID } from "node:crypto";
import { all, first, run } from "./d1-client.mjs";
import { mapHoldingRow } from "../lib/mappers.mjs";

function createId() {
  return randomUUID();
}

function normalizeNullableText(value) {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || null;
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function toSqlDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getCurrentDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeHolding(raw = {}) {
  const payload = {
    id: String(raw.id || createId()),
    assetType: String(raw.assetType || "stock"),
    positionSide: String(raw.positionSide || "long"),
    platform: String(raw.platform || ""),
    market: String(raw.market || ""),
    symbol: String(raw.symbol || "").trim().toUpperCase(),
    name: String(raw.name || "").trim(),
    currency: String(raw.currency || "").trim().toUpperCase(),
    quantity: Number(raw.quantity) || 0,
    costPrice: Number(raw.costPrice) || 0,
    currentPrice: Number(raw.currentPrice) || 0,
    fxRate: Number(raw.fxRate) || 1,
    targetAllocation: Number(raw.targetAllocation) || 0,
    notes: String(raw.notes || "").trim(),
    underlying: String(raw.underlying || "").trim().toUpperCase(),
    optionType: String(raw.optionType || ""),
    strikePrice: raw.strikePrice === "" || raw.strikePrice == null ? null : Number(raw.strikePrice) || 0,
    expiryDate: toDateOnly(raw.expiryDate),
    contractMultiplier: Number(raw.contractMultiplier) || (raw.assetType === "option" ? 100 : 1),
  };

  if (!payload.platform || !payload.symbol || !payload.name || !payload.currency) {
    throw new Error("platform, symbol, name, currency are required");
  }

  if (payload.assetType !== "option") {
    payload.positionSide = "long";
    payload.underlying = "";
    payload.optionType = "";
    payload.strikePrice = null;
    payload.expiryDate = null;
    payload.contractMultiplier = 1;
  }

  if (payload.assetType === "crypto") {
    payload.market = "CRYPTO";
  }

  if (payload.assetType === "macro") {
    payload.market = "FX";
  }

  return payload;
}

function computeHoldingBookCost(holding) {
  const quantity = Number(holding.quantity || 0);
  const costPrice = Number(holding.costPrice || 0);
  const fxRate = Number(holding.fxRate || 1) || 1;
  const multiplier = Number(holding.contractMultiplier || 1) || 1;

  if (holding.assetType === "cash") {
    return quantity * fxRate;
  }

  return quantity * costPrice * multiplier * fxRate;
}

function inferHoldingStatus(holding) {
  return Number(holding.quantity || 0) === 0 ? "CLOSED" : "OPEN";
}

function toUsdAmount(amount, fxRate) {
  return Number(amount || 0) * (Number(fxRate || 1) || 1);
}

function parseMetadataJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

async function withTransaction(env, callback) {
  return callback();
}

async function findOrCreateDefaultPortfolio(env, userId) {
  const existing = await first(
    env,
    "SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1 LIMIT 1",
    [userId]
  );
  if (existing) return existing;

  const portfolio = {
    id: createId(),
    userId,
    name: "默认组合",
    baseCurrency: "USD",
    description: "系统为历史持仓自动创建的默认组合",
  };

  await run(
    env,
    `INSERT INTO portfolios (id, user_id, name, base_currency, description, is_default, status)
     VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE')`,
    [portfolio.id, portfolio.userId, portfolio.name, portfolio.baseCurrency, portfolio.description]
  );

  return first(env, "SELECT * FROM portfolios WHERE id = ? LIMIT 1", [portfolio.id]);
}

async function findOrCreateLedgerAccount(env, userId, portfolioId, holding) {
  const accountName = `${holding.platform} 账户`;
  const existing = await first(
    env,
    `SELECT * FROM accounts
     WHERE user_id = ? AND portfolio_id = ? AND platform = ? AND name = ?
     LIMIT 1`,
    [userId, portfolioId, holding.platform, accountName]
  );
  if (existing) return existing;

  const account = {
    id: createId(),
    userId,
    portfolioId,
    name: accountName,
    platform: holding.platform,
    marketScope: holding.market || null,
    baseCurrency: holding.currency || "USD",
  };

  await run(
    env,
    `INSERT INTO accounts (
      id, user_id, portfolio_id, name, platform, market_scope, base_currency, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      account.id,
      account.userId,
      account.portfolioId,
      account.name,
      account.platform,
      account.marketScope,
      account.baseCurrency,
    ]
  );

  return first(env, "SELECT * FROM accounts WHERE id = ? LIMIT 1", [account.id]);
}

async function findOrCreateInstrument(env, holding) {
  const underlying = normalizeNullableText(holding.underlying);
  const optionType = normalizeNullableText(holding.optionType);
  const strikePrice = holding.strikePrice == null ? null : Number(holding.strikePrice);
  const expiryDate = toDateOnly(holding.expiryDate);

  const existing = await first(
    env,
    `SELECT * FROM instruments
     WHERE asset_type = ?
       AND market = ?
       AND symbol = ?
       AND quote_currency = ?
       AND ((underlying_symbol IS NULL AND ? IS NULL) OR underlying_symbol = ?)
       AND ((option_type IS NULL AND ? IS NULL) OR option_type = ?)
       AND ((strike_price IS NULL AND ? IS NULL) OR strike_price = ?)
       AND ((expiry_date IS NULL AND ? IS NULL) OR expiry_date = ?)
     LIMIT 1`,
    [
      holding.assetType,
      holding.market,
      holding.symbol,
      holding.currency,
      underlying,
      underlying,
      optionType,
      optionType,
      strikePrice,
      strikePrice,
      expiryDate,
      expiryDate,
    ]
  );
  if (existing) return existing;

  const instrument = {
    id: createId(),
    assetType: holding.assetType,
    market: holding.market,
    symbol: holding.symbol,
    displaySymbol: holding.symbol,
    name: holding.name,
    quoteCurrency: holding.currency,
    underlyingSymbol: underlying,
    optionType,
    strikePrice,
    expiryDate,
    contractMultiplier: Number(holding.contractMultiplier || 1),
  };

  await run(
    env,
    `INSERT INTO instruments (
      id, asset_type, market, symbol, display_symbol, name, quote_currency,
      underlying_symbol, option_type, strike_price, expiry_date,
      contract_multiplier, exchange_code, yahoo_symbol, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
    [
      instrument.id,
      instrument.assetType,
      instrument.market,
      instrument.symbol,
      instrument.displaySymbol,
      instrument.name,
      instrument.quoteCurrency,
      instrument.underlyingSymbol,
      instrument.optionType,
      instrument.strikePrice,
      instrument.expiryDate,
      instrument.contractMultiplier,
      instrument.symbol,
    ]
  );

  return first(env, "SELECT * FROM instruments WHERE id = ? LIMIT 1", [instrument.id]);
}

async function ensureLedgerRefsForHolding(env, userId, holding) {
  const portfolio = await findOrCreateDefaultPortfolio(env, userId);
  const account = await findOrCreateLedgerAccount(env, userId, portfolio.id, holding);
  const instrument = await findOrCreateInstrument(env, holding);

  return {
    portfolioId: portfolio.id,
    accountId: account.id,
    instrumentId: instrument.id,
  };
}

async function findCashHoldingByAccountCurrency(env, userId, accountId, currency) {
  return first(
    env,
    `SELECT *
     FROM holdings
     WHERE user_id = ?
       AND account_id = ?
       AND asset_type = 'cash'
       AND currency = ?
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [userId, accountId, currency]
  );
}

async function findLatestHoldingByPlatform(env, userId, platform) {
  return first(
    env,
    `SELECT *
     FROM holdings
     WHERE user_id = ?
       AND platform = ?
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [userId, platform]
  );
}

async function resolveCashContext(env, userId, payload = {}) {
  const platform = String(payload.platform || "").trim();
  const currency = String(payload.currency || "").trim().toUpperCase();
  if (!platform || !currency) {
    throw new Error("platform and currency are required");
  }

  const portfolio = await findOrCreateDefaultPortfolio(env, userId);
  const latestHolding = await findLatestHoldingByPlatform(env, userId, platform);
  const market = String(payload.market || latestHolding?.market || "").trim() || "US";
  const fxRate = Number(payload.fxRate);
  const resolvedFxRate =
    Number.isFinite(fxRate) && fxRate > 0
      ? fxRate
      : Number(latestHolding?.fx_rate || 1) || 1;

  const refs = await ensureLedgerRefsForHolding(env, userId, {
    assetType: "cash",
    platform,
    market,
    symbol: `${currency}-CASH`,
    name: `${platform} ${currency} 现金`,
    currency,
    quantity: 0,
    costPrice: 1,
    currentPrice: 1,
    fxRate: resolvedFxRate,
    targetAllocation: 0,
    notes: "",
  });

  return {
    userId,
    portfolioId: refs.portfolioId,
    accountId: refs.accountId,
    platform,
    market,
    currency,
    fxRate: resolvedFxRate,
  };
}

async function findOrCreateCashHoldingForContext(env, context) {
  const existing = await findCashHoldingByAccountCurrency(env, context.userId, context.accountId, context.currency);
  if (existing) {
    return existing;
  }

  const cashHolding = {
    id: createId(),
    userId: context.userId,
    portfolioId: context.portfolioId,
    accountId: context.accountId,
    instrumentId: null,
    assetType: "cash",
    positionSide: "long",
    platform: context.platform,
    market: context.market,
    symbol: `${context.currency}-CASH`,
    name: `${context.platform} ${context.currency} 现金`,
    currency: context.currency,
    quantity: 0,
    costPrice: 1,
    currentPrice: 1,
    fxRate: context.fxRate,
    targetAllocation: 0,
    notes: "系统自动创建的账户现金持仓",
    underlying: "",
    optionType: "",
    strikePrice: null,
    expiryDate: null,
    contractMultiplier: 1,
    status: "OPEN",
    openedAt: toSqlDateTime(new Date()),
    closedAt: null,
    bookCostTotal: 0,
    realizedPnlTotal: 0,
  };

  const instrument = await findOrCreateInstrument(env, cashHolding);
  cashHolding.instrumentId = instrument.id;

  await run(
    env,
    `INSERT INTO holdings (
      id, user_id, portfolio_id, account_id, instrument_id,
      asset_type, position_side, platform, market, symbol, name, currency,
      quantity, cost_price, current_price, fx_rate, target_allocation, notes,
      underlying, option_type, strike_price, expiry_date, contract_multiplier,
      status, opened_at, closed_at, book_cost_total, realized_pnl_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cashHolding.id,
      cashHolding.userId,
      cashHolding.portfolioId,
      cashHolding.accountId,
      cashHolding.instrumentId,
      cashHolding.assetType,
      cashHolding.positionSide,
      cashHolding.platform,
      cashHolding.market,
      cashHolding.symbol,
      cashHolding.name,
      cashHolding.currency,
      cashHolding.quantity,
      cashHolding.costPrice,
      cashHolding.currentPrice,
      cashHolding.fxRate,
      cashHolding.targetAllocation,
      cashHolding.notes,
      cashHolding.underlying,
      cashHolding.optionType,
      cashHolding.strikePrice,
      cashHolding.expiryDate,
      cashHolding.contractMultiplier,
      cashHolding.status,
      cashHolding.openedAt,
      cashHolding.closedAt,
      cashHolding.bookCostTotal,
      cashHolding.realizedPnlTotal,
    ]
  );

  return getHoldingRow(env, context.userId, cashHolding.id);
}

async function findOrCreateCashHoldingForTrade(env, userId, holdingRow) {
  const cashCurrency = String(holdingRow.currency || holdingRow.trade_currency || "").trim().toUpperCase();
  if (!cashCurrency) {
    throw new Error("Cash settlement currency is missing");
  }

  const existing = await findCashHoldingByAccountCurrency(env, userId, holdingRow.account_id, cashCurrency);
  if (existing) return existing;

  const openedAt = new Date();
  const cashHolding = {
    id: createId(),
    userId,
    portfolioId: holdingRow.portfolio_id,
    accountId: holdingRow.account_id,
    instrumentId: null,
    assetType: "cash",
    positionSide: "long",
    platform: holdingRow.platform,
    market: holdingRow.market || "",
    symbol: `${cashCurrency}-CASH`,
    name: `${holdingRow.platform} ${cashCurrency} 现金`,
    currency: cashCurrency,
    quantity: 0,
    costPrice: 1,
    currentPrice: 1,
    fxRate: Number(holdingRow.fx_rate || 1) || 1,
    targetAllocation: 0,
    notes: "系统自动创建的账户现金持仓",
    underlying: "",
    optionType: "",
    strikePrice: null,
    expiryDate: null,
    contractMultiplier: 1,
    status: "OPEN",
    openedAt: toSqlDateTime(openedAt),
    closedAt: null,
    bookCostTotal: 0,
    realizedPnlTotal: 0,
  };

  const instrument = await findOrCreateInstrument(env, cashHolding);
  cashHolding.instrumentId = instrument.id;

  await run(
    env,
    `INSERT INTO holdings (
      id, user_id, portfolio_id, account_id, instrument_id,
      asset_type, position_side, platform, market, symbol, name, currency,
      quantity, cost_price, current_price, fx_rate, target_allocation, notes,
      underlying, option_type, strike_price, expiry_date, contract_multiplier,
      status, opened_at, closed_at, book_cost_total, realized_pnl_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cashHolding.id,
      cashHolding.userId,
      cashHolding.portfolioId,
      cashHolding.accountId,
      cashHolding.instrumentId,
      cashHolding.assetType,
      cashHolding.positionSide,
      cashHolding.platform,
      cashHolding.market,
      cashHolding.symbol,
      cashHolding.name,
      cashHolding.currency,
      cashHolding.quantity,
      cashHolding.costPrice,
      cashHolding.currentPrice,
      cashHolding.fxRate,
      cashHolding.targetAllocation,
      cashHolding.notes,
      cashHolding.underlying,
      cashHolding.optionType,
      cashHolding.strikePrice,
      cashHolding.expiryDate,
      cashHolding.contractMultiplier,
      cashHolding.status,
      cashHolding.openedAt,
      cashHolding.closedAt,
      cashHolding.bookCostTotal,
      cashHolding.realizedPnlTotal,
    ]
  );

  return getHoldingRow(env, userId, cashHolding.id);
}

async function applyCashBalanceImpact(env, userId, holdingRow, cashDeltaAmount, payload = {}) {
  if (!Number.isFinite(cashDeltaAmount) || cashDeltaAmount === 0) {
    return null;
  }

  const cashHoldingRow = await findOrCreateCashHoldingForTrade(env, userId, holdingRow);
  if (!cashHoldingRow) {
    throw new Error("Cash holding could not be created for this account");
  }

  const cashHolding = mapHoldingRow(cashHoldingRow);
  const nextQuantity = Number(cashHolding.quantity || 0) + cashDeltaAmount;
  const nextBookCostTotal = nextQuantity * (Number(cashHolding.fxRate || 1) || 1);
  const nextStatus = nextQuantity === 0 ? "CLOSED" : "OPEN";
  const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
  const sourceRef =
    String(payload.sourceRef || holdingRow.source_ref || `holding:${holdingRow.id || ""}`).trim() ||
    `holding:${holdingRow.id || ""}`;

  await insertPortfolioTransaction(env, {
    userId,
    portfolioId: cashHoldingRow.portfolio_id,
    accountId: cashHoldingRow.account_id,
    instrumentId: cashHoldingRow.instrument_id,
    holdingId: cashHoldingRow.id,
    transactionType: cashDeltaAmount >= 0 ? "CASH_INFLOW" : "CASH_OUTFLOW",
    side: "LONG",
    tradeDate,
    quantity: Math.abs(cashDeltaAmount),
    unitPrice: 1,
    grossAmount: cashDeltaAmount,
    feeAmount: 0,
    taxAmount: 0,
    netAmount: cashDeltaAmount,
    tradeCurrency: cashHolding.currency,
    fxRateToUsd: Number(cashHolding.fxRate || 1) || 1,
    sourceRef,
    notes: payload.notes || null,
    metadataJson: JSON.stringify({
      linkedHoldingId: holdingRow.id,
      linkedAction: payload.action || null,
      cashDeltaAmount,
    }),
  });

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = 1,
         current_price = 1,
         status = ?,
         closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
         book_cost_total = ?,
         fx_rate = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [
      nextQuantity,
      nextStatus,
      nextStatus,
      toSqlDateTime(tradeDate),
      nextBookCostTotal,
      Number(cashHolding.fxRate || 1) || 1,
      cashHolding.id,
      userId,
    ]
  );

  const row = await getHoldingRow(env, userId, cashHolding.id);
  return row ? mapHoldingRow(row) : null;
}

async function appendCashLedgerEntry(env, userId, cashHoldingRow, cashDeltaAmount, payload = {}) {
  if (!Number.isFinite(cashDeltaAmount) || cashDeltaAmount === 0) {
    return null;
  }

  const cashHolding = mapHoldingRow(cashHoldingRow);
  const nextQuantity = Number(cashHolding.quantity || 0) + cashDeltaAmount;
  const nextBookCostTotal = nextQuantity * (Number(cashHolding.fxRate || 1) || 1);
  const nextStatus = nextQuantity === 0 ? "CLOSED" : "OPEN";
  const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();

  await insertPortfolioTransaction(env, {
    userId,
    portfolioId: cashHoldingRow.portfolio_id,
    accountId: cashHoldingRow.account_id,
    instrumentId: cashHoldingRow.instrument_id,
    holdingId: cashHoldingRow.id,
    transactionType: payload.transactionType || (cashDeltaAmount >= 0 ? "CASH_INFLOW" : "CASH_OUTFLOW"),
    side: "LONG",
    tradeDate,
    quantity: Math.abs(cashDeltaAmount),
    unitPrice: Number(payload.unitPrice || 1) || 1,
    grossAmount: cashDeltaAmount,
    feeAmount: Number(payload.feeAmount || 0) || 0,
    taxAmount: Number(payload.taxAmount || 0) || 0,
    netAmount: cashDeltaAmount,
    tradeCurrency: cashHolding.currency,
    fxRateToUsd: Number(cashHolding.fxRate || 1) || 1,
    sourceRef: String(payload.sourceRef || `holding:${cashHoldingRow.id}`).trim(),
    notes: payload.notes || null,
    metadataJson: payload.metadataJson || null,
  });

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = 1,
         current_price = 1,
         status = ?,
         closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
         book_cost_total = ?,
         fx_rate = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [
      nextQuantity,
      nextStatus,
      nextStatus,
      toSqlDateTime(tradeDate),
      nextBookCostTotal,
      Number(cashHolding.fxRate || 1) || 1,
      cashHoldingRow.id,
      userId,
    ]
  );

  const row = await getHoldingRow(env, userId, cashHoldingRow.id);
  return row ? mapHoldingRow(row) : null;
}

async function insertPortfolioTransaction(env, payload) {
  const transactionId = payload.id || createId();
  await run(
    env,
    `INSERT INTO portfolio_transactions (
      id, user_id, portfolio_id, account_id, instrument_id, holding_id,
      transaction_type, side, trade_date, settle_date,
      quantity, unit_price, gross_amount, fee_amount, tax_amount, net_amount,
      trade_currency, fx_rate_to_usd, realized_pnl_amount,
      cost_basis_method, external_trade_id, source_type, source_ref, notes, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionId,
      payload.userId,
      payload.portfolioId,
      payload.accountId,
      payload.instrumentId,
      payload.holdingId,
      payload.transactionType,
      payload.side,
      payload.tradeDate,
      payload.settleDate || payload.tradeDate,
      payload.quantity,
      payload.unitPrice,
      payload.grossAmount,
      payload.feeAmount || 0,
      payload.taxAmount || 0,
      payload.netAmount,
      payload.tradeCurrency,
      payload.fxRateToUsd || 1,
      payload.realizedPnlAmount || 0,
      payload.costBasisMethod || "FIFO",
      payload.externalTradeId || null,
      payload.sourceType || "HOLDING_UI",
      payload.sourceRef || null,
      payload.notes || null,
      payload.metadataJson || null,
    ]
  );
  return transactionId;
}

async function writeHoldingLedgerTransaction(env, userId, holding, refs, transactionType, previousHolding = null) {
  const quantity = Number(holding.quantity || 0);
  const costPrice = Number(holding.costPrice || 0);
  const contractMultiplier = Number(holding.contractMultiplier || 1) || 1;
  const grossAmountTrade =
    holding.assetType === "cash"
      ? quantity
      : quantity * costPrice * contractMultiplier;
  const tradeDate = toDateOnly(holding.openedAt) || getCurrentDateString();
  const metadata = {
    holdingSnapshot: {
      assetType: holding.assetType,
      positionSide: holding.positionSide,
      platform: holding.platform,
      market: holding.market,
      symbol: holding.symbol,
      name: holding.name,
      currency: holding.currency,
      quantity: holding.quantity,
      costPrice: holding.costPrice,
      currentPrice: holding.currentPrice,
      fxRate: holding.fxRate,
      targetAllocation: holding.targetAllocation,
      notes: holding.notes,
      underlying: holding.underlying,
      optionType: holding.optionType,
      strikePrice: holding.strikePrice,
      expiryDate: holding.expiryDate,
      contractMultiplier: holding.contractMultiplier,
    },
  };
  if (previousHolding) {
    metadata.previousSnapshot = previousHolding;
  }

  return insertPortfolioTransaction(env, {
    userId,
    portfolioId: refs.portfolioId,
    accountId: refs.accountId,
    instrumentId: refs.instrumentId,
    holdingId: holding.id,
    transactionType,
    side: holding.positionSide === "short" ? "SHORT" : "LONG",
    tradeDate,
    quantity,
    unitPrice: holding.assetType === "cash" ? 1 : costPrice,
    grossAmount: grossAmountTrade,
    netAmount: grossAmountTrade,
    tradeCurrency: holding.currency,
    fxRateToUsd: Number(holding.fxRate || 1) || 1,
    sourceRef: `holding:${holding.id}`,
    notes: holding.notes || null,
    metadataJson: JSON.stringify(metadata),
    sourceType: "HOLDING_UI",
  });
}

async function createPositionLot(env, payload) {
  await run(
    env,
    `INSERT INTO position_lots (
      id, user_id, portfolio_id, account_id, instrument_id, holding_id,
      open_transaction_id, open_date, lot_side,
      original_quantity, remaining_quantity, open_unit_price,
      open_fx_rate_to_usd, trade_currency, status, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.id || createId(),
      payload.userId,
      payload.portfolioId,
      payload.accountId,
      payload.instrumentId,
      payload.holdingId,
      payload.openTransactionId,
      payload.openDate,
      payload.lotSide,
      payload.originalQuantity,
      payload.remainingQuantity,
      payload.openUnitPrice,
      payload.openFxRateToUsd || 1,
      payload.tradeCurrency,
      payload.status || "OPEN",
      payload.closedAt || null,
    ]
  );
}

async function getHoldingRow(env, userId, holdingId) {
  return first(env, "SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1", [holdingId, userId]);
}

async function recomputeHoldingFromLedger(env, userId, holdingId) {
  const holdingRow = await getHoldingRow(env, userId, holdingId);
  if (!holdingRow) {
    throw new Error("Holding not found");
  }

  const holding = mapHoldingRow(holdingRow);
  const multiplier = Number(holding.contractMultiplier || 1) || 1;
  const fxRate = Number(holding.fxRate || 1) || 1;

  const lotTotals = await first(
    env,
    `SELECT
       COALESCE(SUM(remaining_quantity), 0) AS total_quantity,
       COALESCE(SUM(remaining_quantity * open_unit_price * ? * open_fx_rate_to_usd), 0) AS book_cost_total
     FROM position_lots
     WHERE holding_id = ?
       AND user_id = ?
       AND remaining_quantity > 0`,
    [multiplier, holdingId, userId]
  );

  const realizedTotals = await first(
    env,
    `SELECT COALESCE(SUM(realized_pnl_usd), 0) AS realized_total
     FROM realized_pnl_ledger
     WHERE holding_id = ?
       AND user_id = ?`,
    [holdingId, userId]
  );

  const newQuantity = Number(lotTotals?.total_quantity || 0);
  const newBookCostTotal = Number(lotTotals?.book_cost_total || 0);
  const newRealizedPnlTotal = Number(realizedTotals?.realized_total || 0);
  const newCostPrice = newQuantity > 0 ? newBookCostTotal / (newQuantity * multiplier * fxRate) : 0;
  const nextStatus = newQuantity > 0 ? "OPEN" : "CLOSED";

  let closedAt = null;
  if (nextStatus === "CLOSED") {
    const closeRow = await first(
      env,
      `SELECT MAX(trade_date) AS latest_close_date
       FROM portfolio_transactions
       WHERE holding_id = ?
         AND user_id = ?
         AND transaction_type = 'CLOSE_POSITION'`,
      [holdingId, userId]
    );
    closedAt = toDateOnly(closeRow?.latest_close_date) || holding.closedAt || getCurrentDateString();
  }

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = ?,
         status = ?,
         closed_at = ?,
         book_cost_total = ?,
         realized_pnl_total = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [newQuantity, newCostPrice, nextStatus, closedAt, newBookCostTotal, newRealizedPnlTotal, holdingId, userId]
  );

  const row = await getHoldingRow(env, userId, holdingId);
  return row ? mapHoldingRow(row) : null;
}

async function reverseCashSettlementForTrade(env, userId, tradeRow) {
  const cashTransactionType = Number(tradeRow.net_amount || 0) >= 0 ? "CASH_INFLOW" : "CASH_OUTFLOW";
  const cashTx = await first(
    env,
    `SELECT *
     FROM portfolio_transactions
     WHERE user_id = ?
       AND account_id = ?
       AND source_ref = ?
       AND transaction_type = ?
       AND trade_date = ?
       AND trade_currency = ?
       AND ABS(net_amount - ?) < 0.00000001
       AND id <> ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [
      userId,
      tradeRow.account_id,
      tradeRow.source_ref,
      cashTransactionType,
      toDateOnly(tradeRow.trade_date),
      tradeRow.trade_currency,
      Number(tradeRow.net_amount || 0),
      tradeRow.id,
    ]
  );

  if (!cashTx) return null;

  const cashHoldingRow = await getHoldingRow(env, userId, cashTx.holding_id);
  if (!cashHoldingRow) {
    await run(env, "DELETE FROM portfolio_transactions WHERE id = ? AND user_id = ?", [cashTx.id, userId]);
    return null;
  }

  const cashHolding = mapHoldingRow(cashHoldingRow);
  const nextQuantity = Number(cashHolding.quantity || 0) - Number(cashTx.net_amount || 0);
  const nextFxRate = Number(cashHolding.fxRate || 1) || 1;
  const nextBookCostTotal = nextQuantity * nextFxRate;
  const nextStatus = nextQuantity === 0 ? "CLOSED" : "OPEN";
  const nextClosedAt = nextStatus === "CLOSED" ? toDateOnly(cashTx.trade_date) || getCurrentDateString() : null;

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = 1,
         current_price = 1,
         status = ?,
         closed_at = ?,
         book_cost_total = ?,
         fx_rate = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [nextQuantity, nextStatus, nextClosedAt, nextBookCostTotal, nextFxRate, cashHolding.id, userId]
  );

  await run(env, "DELETE FROM portfolio_transactions WHERE id = ? AND user_id = ?", [cashTx.id, userId]);
  const row = await getHoldingRow(env, userId, cashHolding.id);
  return row ? mapHoldingRow(row) : null;
}

async function consumeHoldingLotsWithoutRealization(env, userId, holding, quantityToConsume, tradeDate) {
  const multiplier = Number(holding.contractMultiplier || 1) || 1;
  const lotRows = await all(
    env,
    `SELECT *
     FROM position_lots
     WHERE holding_id = ?
       AND user_id = ?
       AND status = 'OPEN'
       AND remaining_quantity > 0
     ORDER BY open_date ASC, created_at ASC, id ASC`,
    [holding.id, userId]
  );

  let remainingToConsume = Number(quantityToConsume || 0);
  let basisUsd = 0;
  let basisTradeAmount = 0;

  for (const lot of lotRows) {
    if (remainingToConsume <= 0) break;
    const lotRemaining = Number(lot.remaining_quantity || 0);
    if (lotRemaining <= 0) continue;

    const consumedQty = Math.min(remainingToConsume, lotRemaining);
    const lotOpenUnitPrice = Number(lot.open_unit_price || 0);
    const lotFx = Number(lot.open_fx_rate_to_usd || 1) || 1;
    basisTradeAmount += consumedQty * lotOpenUnitPrice * multiplier;
    basisUsd += consumedQty * lotOpenUnitPrice * multiplier * lotFx;

    const newRemaining = lotRemaining - consumedQty;
    await run(
      env,
      `UPDATE position_lots
       SET remaining_quantity = ?,
           status = ?,
           closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [newRemaining, newRemaining === 0 ? "CLOSED" : "OPEN", newRemaining, tradeDate, lot.id, userId]
    );

    remainingToConsume -= consumedQty;
  }

  if (remainingToConsume > 0) {
    throw new Error("Not enough open lots to settle this option holding");
  }

  const oldQuantity = Number(holding.quantity || 0);
  const newQuantity = oldQuantity - Number(quantityToConsume || 0);
  const nextStatus = newQuantity === 0 ? "CLOSED" : "OPEN";
  const newBookCostTotal = Math.max(0, Number(holding.bookCostTotal || 0) - basisUsd);
  const newCostPrice =
    newQuantity > 0
      ? newBookCostTotal / (newQuantity * multiplier * (Number(holding.fxRate || 1) || 1))
      : 0;

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = ?,
         status = ?,
         closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
         book_cost_total = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [newQuantity, newCostPrice, nextStatus, nextStatus, tradeDate, newBookCostTotal, holding.id, userId]
  );

  const row = await getHoldingRow(env, userId, holding.id);
  return {
    basisUsd,
    basisTradeAmount,
    holding: row ? mapHoldingRow(row) : null,
  };
}

async function findUnderlyingStockHolding(env, userId, optionHoldingRow) {
  const symbol = String(optionHoldingRow.underlying || "").trim().toUpperCase();
  if (!symbol) {
    throw new Error("Option underlying symbol is missing");
  }

  return first(
    env,
    `SELECT *
     FROM holdings
     WHERE user_id = ?
       AND account_id = ?
       AND asset_type = 'stock'
       AND symbol = ?
       AND currency = ?
     ORDER BY CASE WHEN status = 'OPEN' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [userId, optionHoldingRow.account_id, symbol, optionHoldingRow.currency]
  );
}

async function findOrCreateUnderlyingStockHolding(env, userId, optionHoldingRow) {
  const existing = await findUnderlyingStockHolding(env, userId, optionHoldingRow);
  if (existing) return existing;

  const stockHolding = {
    id: createId(),
    userId,
    portfolioId: optionHoldingRow.portfolio_id,
    accountId: optionHoldingRow.account_id,
    instrumentId: null,
    assetType: "stock",
    positionSide: "long",
    platform: optionHoldingRow.platform,
    market: optionHoldingRow.market,
    symbol: String(optionHoldingRow.underlying || "").trim().toUpperCase(),
    name: String(optionHoldingRow.underlying || "").trim().toUpperCase(),
    currency: optionHoldingRow.currency,
    quantity: 0,
    costPrice: 0,
    currentPrice: Number(optionHoldingRow.strike_price || 0),
    fxRate: Number(optionHoldingRow.fx_rate || 1) || 1,
    targetAllocation: 0,
    notes: "期权交割自动创建的标的持仓",
    underlying: "",
    optionType: "",
    strikePrice: null,
    expiryDate: null,
    contractMultiplier: 1,
    status: "OPEN",
    openedAt: toSqlDateTime(new Date()),
    closedAt: null,
    bookCostTotal: 0,
    realizedPnlTotal: 0,
  };

  const instrument = await findOrCreateInstrument(env, stockHolding);
  stockHolding.instrumentId = instrument.id;

  await run(
    env,
    `INSERT INTO holdings (
      id, user_id, portfolio_id, account_id, instrument_id,
      asset_type, position_side, platform, market, symbol, name, currency,
      quantity, cost_price, current_price, fx_rate, target_allocation, notes,
      underlying, option_type, strike_price, expiry_date, contract_multiplier,
      status, opened_at, closed_at, book_cost_total, realized_pnl_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stockHolding.id,
      stockHolding.userId,
      stockHolding.portfolioId,
      stockHolding.accountId,
      stockHolding.instrumentId,
      stockHolding.assetType,
      stockHolding.positionSide,
      stockHolding.platform,
      stockHolding.market,
      stockHolding.symbol,
      stockHolding.name,
      stockHolding.currency,
      stockHolding.quantity,
      stockHolding.costPrice,
      stockHolding.currentPrice,
      stockHolding.fxRate,
      stockHolding.targetAllocation,
      stockHolding.notes,
      stockHolding.underlying,
      stockHolding.optionType,
      stockHolding.strikePrice,
      stockHolding.expiryDate,
      stockHolding.contractMultiplier,
      stockHolding.status,
      stockHolding.openedAt,
      stockHolding.closedAt,
      stockHolding.bookCostTotal,
      stockHolding.realizedPnlTotal,
    ]
  );

  return getHoldingRow(env, userId, stockHolding.id);
}

async function addUnderlyingStockFromOptionSettlement(env, userId, optionHoldingRow, payload = {}) {
  const stockHoldingRow = await findOrCreateUnderlyingStockHolding(env, userId, optionHoldingRow);
  if (!stockHoldingRow) {
    throw new Error("Underlying stock holding could not be created");
  }

  const stockHolding = mapHoldingRow(stockHoldingRow);
  const shareQuantity = Number(payload.shareQuantity || 0);
  const totalCostTradeAmount = Number(payload.totalCostTradeAmount || 0);
  const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
  const fxRate = Number(stockHolding.fxRate || optionHoldingRow.fx_rate || 1) || 1;
  const totalCostUsd = toUsdAmount(totalCostTradeAmount, fxRate);
  const newQuantity = Number(stockHolding.quantity || 0) + shareQuantity;
  const newBookCostTotal = Number(stockHolding.bookCostTotal || 0) + totalCostUsd;
  const newCostPrice = newQuantity > 0 ? newBookCostTotal / (newQuantity * fxRate) : 0;
  const unitPrice = shareQuantity > 0 ? totalCostTradeAmount / shareQuantity : 0;
  const sourceRef = payload.sourceRef || `holding:${optionHoldingRow.id}`;
  const notes = payload.notes || null;

  const transactionId = await insertPortfolioTransaction(env, {
    userId,
    portfolioId: stockHoldingRow.portfolio_id,
    accountId: stockHoldingRow.account_id,
    instrumentId: stockHoldingRow.instrument_id,
    holdingId: stockHoldingRow.id,
    transactionType: "OPTION_STOCK_IN",
    side: "LONG",
    tradeDate,
    quantity: shareQuantity,
    unitPrice,
    grossAmount: totalCostTradeAmount,
    feeAmount: 0,
    taxAmount: 0,
    netAmount: totalCostTradeAmount,
    tradeCurrency: stockHolding.currency,
    fxRateToUsd: fxRate,
    sourceRef,
    notes,
    metadataJson: JSON.stringify({
      linkedOptionHoldingId: optionHoldingRow.id,
      linkedOptionSymbol: optionHoldingRow.symbol,
    }),
  });

  await createPositionLot(env, {
    userId,
    portfolioId: stockHoldingRow.portfolio_id,
    accountId: stockHoldingRow.account_id,
    instrumentId: stockHoldingRow.instrument_id,
    holdingId: stockHoldingRow.id,
    openTransactionId: transactionId,
    openDate: tradeDate,
    lotSide: "LONG",
    originalQuantity: shareQuantity,
    remainingQuantity: shareQuantity,
    openUnitPrice: unitPrice,
    openFxRateToUsd: fxRate,
    tradeCurrency: stockHolding.currency,
    status: "OPEN",
  });

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = ?,
         current_price = ?,
         status = 'OPEN',
         closed_at = NULL,
         book_cost_total = ?,
         notes = COALESCE(notes, ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [
      newQuantity,
      newCostPrice,
      Number(payload.referencePrice || unitPrice || stockHolding.currentPrice || 0),
      newBookCostTotal,
      notes,
      stockHolding.id,
      userId,
    ]
  );

  const row = await getHoldingRow(env, userId, stockHolding.id);
  return row ? mapHoldingRow(row) : null;
}

async function deliverUnderlyingStockForOptionSettlement(env, userId, optionHoldingRow, payload = {}) {
  const stockHoldingRow = await findUnderlyingStockHolding(env, userId, optionHoldingRow);
  if (!stockHoldingRow) {
    throw new Error("未找到可交割的标的股票持仓");
  }

  const stockHolding = mapHoldingRow(stockHoldingRow);
  const shareQuantity = Number(payload.shareQuantity || 0);
  if (Number(stockHolding.quantity || 0) < shareQuantity) {
    throw new Error("标的股票数量不足，当前版本暂不支持自动创建空头股票仓位");
  }

  const strikePrice = Number(payload.strikePrice || 0);
  const premiumAdjustmentTradeAmount = Number(payload.premiumAdjustmentTradeAmount || 0);
  const feeAmount = Number(payload.feeAmount || 0) || 0;
  const taxAmount = Number(payload.taxAmount || 0) || 0;
  const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
  const fxRate = Number(stockHolding.fxRate || optionHoldingRow.fx_rate || 1) || 1;
  const sourceRef = payload.sourceRef || `holding:${optionHoldingRow.id}`;
  const notes = payload.notes || null;

  const lotRows = await all(
    env,
    `SELECT *
     FROM position_lots
     WHERE holding_id = ?
       AND user_id = ?
       AND status = 'OPEN'
       AND remaining_quantity > 0
     ORDER BY open_date ASC, created_at ASC, id ASC`,
    [stockHolding.id, userId]
  );

  let remainingToClose = shareQuantity;
  let basisClosedUsd = 0;
  let realizedPnlUsdTotal = 0;
  const grossAmount = shareQuantity * strikePrice;

  const closeTransactionId = await insertPortfolioTransaction(env, {
    userId,
    portfolioId: stockHoldingRow.portfolio_id,
    accountId: stockHoldingRow.account_id,
    instrumentId: stockHoldingRow.instrument_id,
    holdingId: stockHoldingRow.id,
    transactionType: "OPTION_STOCK_OUT",
    side: "LONG",
    tradeDate,
    quantity: shareQuantity,
    unitPrice: strikePrice,
    grossAmount,
    feeAmount,
    taxAmount,
    netAmount: grossAmount - feeAmount - taxAmount,
    tradeCurrency: stockHolding.currency,
    fxRateToUsd: fxRate,
    sourceRef,
    notes,
    metadataJson: JSON.stringify({
      linkedOptionHoldingId: optionHoldingRow.id,
      linkedOptionSymbol: optionHoldingRow.symbol,
      premiumAdjustmentTradeAmount,
    }),
  });

  for (const lot of lotRows) {
    if (remainingToClose <= 0) break;

    const lotRemaining = Number(lot.remaining_quantity || 0);
    if (lotRemaining <= 0) continue;

    const consumedQty = Math.min(remainingToClose, lotRemaining);
    const lotOpenUnitPrice = Number(lot.open_unit_price || 0);
    const lotFx = Number(lot.open_fx_rate_to_usd || 1) || 1;
    const basisTrade = consumedQty * lotOpenUnitPrice;
    const basisUsd = basisTrade * lotFx;
    const proceedsTrade = consumedQty * strikePrice;
    const premiumTradeShare = premiumAdjustmentTradeAmount * (consumedQty / shareQuantity);
    const feeTradeShare = feeAmount * (consumedQty / shareQuantity);
    const taxTradeShare = taxAmount * (consumedQty / shareQuantity);
    const realizedTrade = proceedsTrade + premiumTradeShare - basisTrade - feeTradeShare - taxTradeShare;
    const realizedUsd = realizedTrade * fxRate;

    basisClosedUsd += basisUsd;
    realizedPnlUsdTotal += realizedUsd;

    const newRemaining = lotRemaining - consumedQty;
    await run(
      env,
      `UPDATE position_lots
       SET remaining_quantity = ?,
           status = ?,
           closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [newRemaining, newRemaining === 0 ? "CLOSED" : "OPEN", newRemaining, tradeDate, lot.id, userId]
    );

    await run(
      env,
      `INSERT INTO realized_pnl_ledger (
        id, user_id, portfolio_id, account_id, instrument_id, holding_id,
        open_transaction_id, close_transaction_id, lot_id,
        recognized_date, quantity_closed, proceeds_amount, cost_amount,
        fee_amount, tax_amount, realized_pnl_amount, realized_pnl_usd,
        trade_currency, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId(),
        userId,
        stockHoldingRow.portfolio_id,
        stockHoldingRow.account_id,
        stockHoldingRow.instrument_id,
        stockHolding.id,
        lot.open_transaction_id,
        closeTransactionId,
        lot.id,
        tradeDate,
        consumedQty,
        proceedsTrade + premiumTradeShare,
        basisTrade,
        feeTradeShare,
        taxTradeShare,
        realizedTrade,
        realizedUsd,
        stockHolding.currency,
        notes,
      ]
    );

    remainingToClose -= consumedQty;
  }

  if (remainingToClose > 0) {
    throw new Error("Not enough stock lots to complete option settlement");
  }

  const newQuantity = Number(stockHolding.quantity || 0) - shareQuantity;
  const newBookCostTotal = Math.max(0, Number(stockHolding.bookCostTotal || 0) - basisClosedUsd);
  const newRealizedPnlTotal = Number(stockHolding.realizedPnlTotal || 0) + realizedPnlUsdTotal;
  const newCostPrice = newQuantity > 0 ? newBookCostTotal / (newQuantity * fxRate) : 0;
  const nextStatus = newQuantity === 0 ? "CLOSED" : "OPEN";

  await run(
    env,
    `UPDATE holdings
     SET quantity = ?,
         cost_price = ?,
         current_price = ?,
         status = ?,
         closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
         book_cost_total = ?,
         realized_pnl_total = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [
      newQuantity,
      newCostPrice,
      strikePrice,
      nextStatus,
      nextStatus,
      tradeDate,
      newBookCostTotal,
      newRealizedPnlTotal,
      stockHolding.id,
      userId,
    ]
  );

  await run(
    env,
    `UPDATE portfolio_transactions
     SET realized_pnl_amount = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [realizedPnlUsdTotal, closeTransactionId]
  );

  const row = await getHoldingRow(env, userId, stockHolding.id);
  return {
    holding: row ? mapHoldingRow(row) : null,
    realizedPnlUsd: realizedPnlUsdTotal,
  };
}

export async function createHolding(env, userId, rawPayload) {
  const holding = normalizeHolding(rawPayload);

  return withTransaction(env, async () => {
    const refs = await ensureLedgerRefsForHolding(env, userId, holding);
    const openedAt = new Date();
    const enrichedHolding = {
      ...holding,
      userId,
      ...refs,
      status: inferHoldingStatus(holding),
      openedAt: toSqlDateTime(openedAt),
      closedAt: Number(holding.quantity || 0) === 0 ? toSqlDateTime(openedAt) : null,
      bookCostTotal: computeHoldingBookCost(holding),
      realizedPnlTotal: 0,
    };

    await run(
      env,
      `INSERT INTO holdings (
        id, user_id, portfolio_id, account_id, instrument_id,
        asset_type, position_side, platform, market, symbol, name, currency,
        quantity, cost_price, current_price, fx_rate, target_allocation, notes,
        underlying, option_type, strike_price, expiry_date, contract_multiplier,
        status, opened_at, closed_at, book_cost_total, realized_pnl_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enrichedHolding.id,
        userId,
        refs.portfolioId,
        refs.accountId,
        refs.instrumentId,
        enrichedHolding.assetType,
        enrichedHolding.positionSide,
        enrichedHolding.platform,
        enrichedHolding.market,
        enrichedHolding.symbol,
        enrichedHolding.name,
        enrichedHolding.currency,
        enrichedHolding.quantity,
        enrichedHolding.costPrice,
        enrichedHolding.currentPrice,
        enrichedHolding.fxRate,
        enrichedHolding.targetAllocation,
        enrichedHolding.notes,
        enrichedHolding.underlying,
        enrichedHolding.optionType,
        enrichedHolding.strikePrice,
        enrichedHolding.expiryDate,
        enrichedHolding.contractMultiplier,
        enrichedHolding.status,
        enrichedHolding.openedAt,
        enrichedHolding.closedAt,
        enrichedHolding.bookCostTotal,
        enrichedHolding.realizedPnlTotal,
      ]
    );

    const openingTransactionId = await writeHoldingLedgerTransaction(env, userId, enrichedHolding, refs, "OPENING_BALANCE");
    const relatedHoldings = [];

    if (Number(enrichedHolding.quantity || 0) > 0) {
      await createPositionLot(env, {
        userId,
        portfolioId: refs.portfolioId,
        accountId: refs.accountId,
        instrumentId: refs.instrumentId,
        holdingId: enrichedHolding.id,
        openTransactionId: openingTransactionId,
        openDate: toDateOnly(enrichedHolding.openedAt) || getCurrentDateString(),
        lotSide: enrichedHolding.positionSide === "short" ? "SHORT" : "LONG",
        originalQuantity: Number(enrichedHolding.quantity || 0),
        remainingQuantity: Number(enrichedHolding.quantity || 0),
        openUnitPrice: enrichedHolding.assetType === "cash" ? 1 : Number(enrichedHolding.costPrice || 0),
        openFxRateToUsd: Number(enrichedHolding.fxRate || 1) || 1,
        tradeCurrency: enrichedHolding.currency,
        status: "OPEN",
      });
    }

    const quantity = Number(enrichedHolding.quantity || 0);
    const contractMultiplier = Number(enrichedHolding.contractMultiplier || 1) || 1;
    const openingTradeAmount = quantity * Number(enrichedHolding.costPrice || 0) * contractMultiplier;
    const cashDeltaAmount =
      enrichedHolding.assetType === "cash" || !(openingTradeAmount > 0)
        ? 0
        : enrichedHolding.positionSide === "short"
          ? openingTradeAmount
          : -openingTradeAmount;

    if (cashDeltaAmount !== 0) {
      const cashContext = await resolveCashContext(env, userId, {
        platform: enrichedHolding.platform,
        currency: enrichedHolding.currency,
        market: enrichedHolding.market,
        fxRate: enrichedHolding.fxRate,
      });
      const cashHoldingRow = await findOrCreateCashHoldingForContext(env, cashContext);
      const updatedCashHolding = await appendCashLedgerEntry(env, userId, cashHoldingRow, cashDeltaAmount, {
        tradeDate: toDateOnly(enrichedHolding.openedAt) || getCurrentDateString(),
        notes: `新增持仓自动${cashDeltaAmount > 0 ? "增加" : "扣减"}现金：${enrichedHolding.symbol}`,
        sourceRef: openingTransactionId,
        transactionType: cashDeltaAmount > 0 ? "CASH_INFLOW" : "CASH_OUTFLOW",
        unitPrice: Number(enrichedHolding.costPrice || 1) || 1,
        metadataJson: JSON.stringify({
          linkedHoldingId: enrichedHolding.id,
          linkedAction: "OPENING_BALANCE",
          symbol: enrichedHolding.symbol,
          currency: enrichedHolding.currency,
          cashDeltaAmount,
        }),
      });
      if (updatedCashHolding) {
        relatedHoldings.push(updatedCashHolding);
      }
    }

    const row = await getHoldingRow(env, userId, enrichedHolding.id);
    return {
      holding: row ? mapHoldingRow(row) : enrichedHolding,
      relatedHoldings,
    };
  });
}

export async function processCashTransfer(env, userId, payload = {}) {
  return withTransaction(env, async () => {
    const sourcePlatform = String(payload.sourcePlatform || "").trim();
    const targetPlatform = String(payload.targetPlatform || "").trim();
    const currency = String(payload.currency || "").trim().toUpperCase();
    const amount = Number(payload.amount || 0);
    const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
    const notes = normalizeNullableText(payload.notes);

    if (!sourcePlatform || !targetPlatform || !currency) {
      throw new Error("sourcePlatform、targetPlatform 和 currency 必填");
    }
    if (sourcePlatform === targetPlatform) {
      throw new Error("转出平台和转入平台不能相同");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("转账金额必须大于 0");
    }

    const sourceContext = await resolveCashContext(env, userId, {
      platform: sourcePlatform,
      currency,
      market: payload.sourceMarket,
      fxRate: payload.fxRate,
    });
    const targetContext = await resolveCashContext(env, userId, {
      platform: targetPlatform,
      currency,
      market: payload.targetMarket || payload.sourceMarket,
      fxRate: payload.fxRate || sourceContext.fxRate,
    });

    const sourceCashRow = await findOrCreateCashHoldingForContext(env, sourceContext);
    const targetCashRow = await findOrCreateCashHoldingForContext(env, targetContext);
    const transferRef = `transfer:${createId()}`;
    const metadataJson = JSON.stringify({
      transferRef,
      sourcePlatform,
      targetPlatform,
      currency,
      amount,
    });

    const updatedSource = await appendCashLedgerEntry(env, userId, sourceCashRow, -amount, {
      tradeDate,
      notes,
      sourceRef: transferRef,
      transactionType: "TRANSFER_OUT",
      metadataJson,
    });
    const updatedTarget = await appendCashLedgerEntry(env, userId, targetCashRow, amount, {
      tradeDate,
      notes,
      sourceRef: transferRef,
      transactionType: "TRANSFER_IN",
      metadataJson,
    });

    return {
      transferRef,
      amount,
      currency,
      sourcePlatform,
      targetPlatform,
      relatedHoldings: [updatedSource, updatedTarget].filter(Boolean),
    };
  });
}

export async function processFxExchange(env, userId, payload = {}) {
  return withTransaction(env, async () => {
    const platform = String(payload.platform || "").trim();
    const fromCurrency = String(payload.fromCurrency || "").trim().toUpperCase();
    const toCurrency = String(payload.toCurrency || "").trim().toUpperCase();
    const fromAmount = Number(payload.fromAmount || 0);
    const toAmount = Number(payload.toAmount || 0);
    const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
    const notes = normalizeNullableText(payload.notes);

    if (!platform || !fromCurrency || !toCurrency) {
      throw new Error("platform、fromCurrency 和 toCurrency 必填");
    }
    if (fromCurrency === toCurrency) {
      throw new Error("换出币种和换入币种不能相同");
    }
    if (!Number.isFinite(fromAmount) || fromAmount <= 0 || !Number.isFinite(toAmount) || toAmount <= 0) {
      throw new Error("换汇金额必须大于 0");
    }

    const fromContext = await resolveCashContext(env, userId, {
      platform,
      currency: fromCurrency,
      market: payload.fromMarket,
      fxRate: payload.fromFxRate,
    });
    const toContext = await resolveCashContext(env, userId, {
      platform,
      currency: toCurrency,
      market: payload.toMarket || payload.fromMarket,
      fxRate: payload.toFxRate,
    });

    const fromCashRow = await findOrCreateCashHoldingForContext(env, fromContext);
    const toCashRow = await findOrCreateCashHoldingForContext(env, toContext);
    const exchangeRef = `fx:${createId()}`;
    const impliedRate = toAmount / fromAmount;
    const metadataJson = JSON.stringify({
      exchangeRef,
      platform,
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      impliedRate,
    });

    const updatedSource = await appendCashLedgerEntry(env, userId, fromCashRow, -fromAmount, {
      tradeDate,
      notes,
      sourceRef: exchangeRef,
      transactionType: "FX_EXCHANGE_OUT",
      unitPrice: impliedRate,
      metadataJson,
    });
    const updatedTarget = await appendCashLedgerEntry(env, userId, toCashRow, toAmount, {
      tradeDate,
      notes,
      sourceRef: exchangeRef,
      transactionType: "FX_EXCHANGE_IN",
      unitPrice: impliedRate,
      metadataJson,
    });

    return {
      exchangeRef,
      platform,
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      impliedRate,
      relatedHoldings: [updatedSource, updatedTarget].filter(Boolean),
    };
  });
}

export async function updateHolding(env, userId, holdingId, rawPayload) {
  const holding = normalizeHolding({ ...rawPayload, id: holdingId });

  return withTransaction(env, async () => {
    const existingRow = await getHoldingRow(env, userId, holding.id);
    if (!existingRow) {
      const error = new Error("Holding not found");
      error.status = 404;
      throw error;
    }

    const previousHolding = mapHoldingRow(existingRow);
    const refs = await ensureLedgerRefsForHolding(env, userId, holding);
    const status = inferHoldingStatus(holding);
    const closedAt = status === "CLOSED" ? (previousHolding.closedAt || toSqlDateTime(new Date())) : null;
    const enrichedHolding = {
      ...holding,
      userId,
      ...refs,
      status,
      openedAt: toSqlDateTime(previousHolding.openedAt || existingRow.created_at || new Date()),
      closedAt: toSqlDateTime(closedAt),
      bookCostTotal: computeHoldingBookCost(holding),
      realizedPnlTotal: previousHolding.realizedPnlTotal || 0,
    };

    await run(
      env,
      `UPDATE holdings SET
        portfolio_id = ?,
        account_id = ?,
        instrument_id = ?,
        asset_type = ?,
        position_side = ?,
        platform = ?,
        market = ?,
        symbol = ?,
        name = ?,
        currency = ?,
        quantity = ?,
        cost_price = ?,
        current_price = ?,
        fx_rate = ?,
        target_allocation = ?,
        notes = ?,
        underlying = ?,
        option_type = ?,
        strike_price = ?,
        expiry_date = ?,
        contract_multiplier = ?,
        status = ?,
        opened_at = ?,
        closed_at = ?,
        book_cost_total = ?,
        realized_pnl_total = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`,
      [
        enrichedHolding.portfolioId,
        enrichedHolding.accountId,
        enrichedHolding.instrumentId,
        enrichedHolding.assetType,
        enrichedHolding.positionSide,
        enrichedHolding.platform,
        enrichedHolding.market,
        enrichedHolding.symbol,
        enrichedHolding.name,
        enrichedHolding.currency,
        enrichedHolding.quantity,
        enrichedHolding.costPrice,
        enrichedHolding.currentPrice,
        enrichedHolding.fxRate,
        enrichedHolding.targetAllocation,
        enrichedHolding.notes,
        enrichedHolding.underlying,
        enrichedHolding.optionType,
        enrichedHolding.strikePrice,
        enrichedHolding.expiryDate,
        enrichedHolding.contractMultiplier,
        enrichedHolding.status,
        enrichedHolding.openedAt,
        enrichedHolding.closedAt,
        enrichedHolding.bookCostTotal,
        enrichedHolding.realizedPnlTotal,
        enrichedHolding.id,
        userId,
      ]
    );

    await writeHoldingLedgerTransaction(env, userId, enrichedHolding, refs, "SNAPSHOT_ADJUSTMENT", previousHolding);
    const row = await getHoldingRow(env, userId, enrichedHolding.id);
    return row ? mapHoldingRow(row) : enrichedHolding;
  });
}

export async function deleteHolding(env, userId, holdingId) {
  return withTransaction(env, async () => {
    const existingRow = await getHoldingRow(env, userId, holdingId);
    if (!existingRow) {
      const error = new Error("Holding not found");
      error.status = 404;
      throw error;
    }

    await run(env, "DELETE FROM holdings WHERE id = ? AND user_id = ?", [holdingId, userId]);
    return { ok: true };
  });
}

export async function processHoldingTrade(env, userId, holdingId, payload = {}) {
  return withTransaction(env, async () => {
    const holdingRow = await getHoldingRow(env, userId, holdingId);
    if (!holdingRow) {
      const error = new Error("Holding not found");
      error.status = 404;
      throw error;
    }

    const action = String(payload.action || "").trim().toLowerCase();
    if (!["add", "reduce", "close"].includes(action)) {
      throw new Error("action must be add, reduce, or close");
    }

    const holding = mapHoldingRow(holdingRow);
    const refs = {
      portfolioId: holdingRow.portfolio_id,
      accountId: holdingRow.account_id,
      instrumentId: holdingRow.instrument_id,
    };

    const multiplier = Number(holding.contractMultiplier || 1) || 1;
    const fxRate = Number(holding.fxRate || 1) || 1;
    const feeAmount = Number(payload.feeAmount || 0) || 0;
    const taxAmount = Number(payload.taxAmount || 0) || 0;
    const feeUsd = toUsdAmount(feeAmount, fxRate);
    const taxUsd = toUsdAmount(taxAmount, fxRate);
    const notes = String(payload.notes || "").trim() || null;
    const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
    const unitPrice = payload.unitPrice == null ? Number(holding.currentPrice || 0) : Number(payload.unitPrice);
    const relatedHoldings = [];

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("unitPrice must be a valid non-negative number");
    }
    if (!refs.portfolioId || !refs.accountId || !refs.instrumentId) {
      throw new Error("Holding ledger references are missing");
    }

    if (action === "add") {
      const quantity = Number(payload.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("quantity must be greater than 0");
      }

      const grossAmount = quantity * unitPrice * multiplier;
      const grossUsd = toUsdAmount(grossAmount, fxRate);
      const newQuantity = Number(holding.quantity || 0) + quantity;
      const newBookCostTotal = Number(holding.bookCostTotal || 0) + grossUsd + feeUsd + taxUsd;
      const newCostPrice = newQuantity > 0 ? newBookCostTotal / (newQuantity * multiplier * fxRate) : 0;

      const transactionId = await insertPortfolioTransaction(env, {
        userId,
        portfolioId: refs.portfolioId,
        accountId: refs.accountId,
        instrumentId: refs.instrumentId,
        holdingId: holding.id,
        transactionType: "ADD_POSITION",
        side: holding.positionSide === "short" ? "SHORT" : "LONG",
        tradeDate,
        quantity,
        unitPrice,
        grossAmount,
        feeAmount,
        taxAmount,
        netAmount: grossAmount + feeAmount + taxAmount,
        tradeCurrency: holding.currency,
        fxRateToUsd: fxRate,
        sourceRef: `holding:${holding.id}`,
        notes,
        metadataJson: JSON.stringify({
          action,
          previousQuantity: holding.quantity,
          previousBookCostTotal: holding.bookCostTotal,
        }),
      });

      await createPositionLot(env, {
        userId,
        portfolioId: refs.portfolioId,
        accountId: refs.accountId,
        instrumentId: refs.instrumentId,
        holdingId: holding.id,
        openTransactionId: transactionId,
        openDate: tradeDate,
        lotSide: holding.positionSide === "short" ? "SHORT" : "LONG",
        originalQuantity: quantity,
        remainingQuantity: quantity,
        openUnitPrice: unitPrice,
        openFxRateToUsd: fxRate,
        tradeCurrency: holding.currency,
        status: "OPEN",
      });

      await run(
        env,
        `UPDATE holdings
         SET quantity = ?,
             cost_price = ?,
             current_price = ?,
             status = 'OPEN',
             closed_at = NULL,
             book_cost_total = ?,
             notes = COALESCE(?, notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [newQuantity, newCostPrice, unitPrice, newBookCostTotal, notes, holding.id, userId]
      );

      const cashHolding = await applyCashBalanceImpact(env, userId, holdingRow, -(grossAmount + feeAmount + taxAmount), {
        action,
        tradeDate,
        notes,
      });
      if (cashHolding) relatedHoldings.push(cashHolding);

      const updated = await getHoldingRow(env, userId, holding.id);
      return {
        action,
        transactionType: "ADD_POSITION",
        quantity,
        unitPrice,
        holding: updated ? mapHoldingRow(updated) : null,
        relatedHoldings,
      };
    }

    const requestedQuantity =
      action === "close" ? Number(holding.quantity || 0) : Number(payload.quantity || 0);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      throw new Error("quantity must be greater than 0");
    }
    if (requestedQuantity > Number(holding.quantity || 0)) {
      throw new Error("quantity exceeds current holding quantity");
    }

    const lotRows = await all(
      env,
      `SELECT *
       FROM position_lots
       WHERE holding_id = ?
         AND user_id = ?
         AND status = 'OPEN'
         AND remaining_quantity > 0
       ORDER BY open_date ASC, created_at ASC, id ASC`,
      [holding.id, userId]
    );

    let remainingToClose = requestedQuantity;
    let basisClosedUsd = 0;
    let realizedPnlUsdTotal = 0;
    const grossAmount = requestedQuantity * unitPrice * multiplier;
    const closeTransactionType = action === "close" ? "CLOSE_POSITION" : "REDUCE_POSITION";
    const closeTransactionId = await insertPortfolioTransaction(env, {
      userId,
      portfolioId: refs.portfolioId,
      accountId: refs.accountId,
      instrumentId: refs.instrumentId,
      holdingId: holding.id,
      transactionType: closeTransactionType,
      side: holding.positionSide === "short" ? "SHORT" : "LONG",
      tradeDate,
      quantity: requestedQuantity,
      unitPrice,
      grossAmount,
      feeAmount,
      taxAmount,
      netAmount: grossAmount - feeAmount - taxAmount,
      tradeCurrency: holding.currency,
      fxRateToUsd: fxRate,
      sourceRef: `holding:${holding.id}`,
      notes,
      metadataJson: JSON.stringify({
        action,
        previousQuantity: holding.quantity,
        previousBookCostTotal: holding.bookCostTotal,
      }),
    });

    for (const lot of lotRows) {
      if (remainingToClose <= 0) break;
      const lotRemaining = Number(lot.remaining_quantity || 0);
      if (lotRemaining <= 0) continue;

      const consumedQty = Math.min(remainingToClose, lotRemaining);
      const basisUsd = consumedQty * Number(lot.open_unit_price || 0) * multiplier * (Number(lot.open_fx_rate_to_usd || 1) || 1);
      const proceedsUsd = consumedQty * unitPrice * multiplier * fxRate;
      const feeUsdShare = feeUsd * (consumedQty / requestedQuantity);
      const taxUsdShare = taxUsd * (consumedQty / requestedQuantity);
      const realizedUsd =
        holding.positionSide === "short"
          ? basisUsd - proceedsUsd - feeUsdShare - taxUsdShare
          : proceedsUsd - basisUsd - feeUsdShare - taxUsdShare;

      basisClosedUsd += basisUsd;
      realizedPnlUsdTotal += realizedUsd;

      const newRemaining = lotRemaining - consumedQty;
      await run(
        env,
        `UPDATE position_lots
         SET remaining_quantity = ?,
             status = ?,
             closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newRemaining, newRemaining === 0 ? "CLOSED" : "OPEN", newRemaining, tradeDate, lot.id]
      );

      await run(
        env,
        `INSERT INTO realized_pnl_ledger (
          id, user_id, portfolio_id, account_id, instrument_id, holding_id,
          open_transaction_id, close_transaction_id, lot_id,
          recognized_date, quantity_closed, proceeds_amount, cost_amount,
          fee_amount, tax_amount, realized_pnl_amount, realized_pnl_usd,
          trade_currency, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createId(),
          userId,
          refs.portfolioId,
          refs.accountId,
          refs.instrumentId,
          holding.id,
          lot.open_transaction_id,
          closeTransactionId,
          lot.id,
          tradeDate,
          consumedQty,
          consumedQty * unitPrice * multiplier,
          consumedQty * Number(lot.open_unit_price || 0) * multiplier,
          feeAmount * (consumedQty / requestedQuantity),
          taxAmount * (consumedQty / requestedQuantity),
          realizedUsd,
          realizedUsd,
          holding.currency,
          notes,
        ]
      );

      remainingToClose -= consumedQty;
    }

    if (remainingToClose > 0) {
      throw new Error("Not enough open lots to reduce or close this holding");
    }

    const oldQuantity = Number(holding.quantity || 0);
    const newQuantity = oldQuantity - requestedQuantity;
    const newBookCostTotal = Math.max(0, Number(holding.bookCostTotal || 0) - basisClosedUsd);
    const newRealizedPnlTotal = Number(holding.realizedPnlTotal || 0) + realizedPnlUsdTotal;
    const newCostPrice = newQuantity > 0 ? newBookCostTotal / (newQuantity * multiplier * fxRate) : 0;
    const nextStatus = newQuantity === 0 ? "CLOSED" : "OPEN";

    await run(
      env,
      `UPDATE holdings
       SET quantity = ?,
           cost_price = ?,
           current_price = ?,
           status = ?,
           closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
           book_cost_total = ?,
           realized_pnl_total = ?,
           notes = COALESCE(?, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        newQuantity,
        newCostPrice,
        unitPrice,
        nextStatus,
        nextStatus,
        tradeDate,
        newBookCostTotal,
        newRealizedPnlTotal,
        notes,
        holding.id,
        userId,
      ]
    );

    const cashHolding = await applyCashBalanceImpact(env, userId, holdingRow, grossAmount - feeAmount - taxAmount, {
      action,
      tradeDate,
      notes,
    });
    if (cashHolding) relatedHoldings.push(cashHolding);

    await run(
      env,
      `UPDATE portfolio_transactions
       SET realized_pnl_amount = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [realizedPnlUsdTotal, closeTransactionId]
    );

    const updated = await getHoldingRow(env, userId, holding.id);
    return {
      action,
      transactionType: closeTransactionType,
      quantity: requestedQuantity,
      unitPrice,
      realizedPnlUsd: realizedPnlUsdTotal,
      holding: updated ? mapHoldingRow(updated) : null,
      relatedHoldings,
    };
  });
}

export async function processOptionSettlement(env, userId, holdingId, payload = {}) {
  return withTransaction(env, async () => {
    const holdingRow = await getHoldingRow(env, userId, holdingId);
    if (!holdingRow) {
      const error = new Error("Holding not found");
      error.status = 404;
      throw error;
    }

    const holding = mapHoldingRow(holdingRow);
    if (holding.assetType !== "option") throw new Error("Only option holdings support exercise or assignment");
    if (holding.status === "CLOSED" || Number(holding.quantity || 0) <= 0) {
      throw new Error("This option holding is already closed");
    }

    const action = String(payload.action || "").trim().toLowerCase();
    if (!["exercise", "assignment"].includes(action)) {
      throw new Error("action must be exercise or assignment");
    }
    if (holding.positionSide === "long" && action !== "exercise") {
      throw new Error("Long options can only be exercised");
    }
    if (holding.positionSide === "short" && action !== "assignment") {
      throw new Error("Short options can only be assigned");
    }

    const refs = {
      portfolioId: holdingRow.portfolio_id,
      accountId: holdingRow.account_id,
      instrumentId: holdingRow.instrument_id,
    };
    if (!refs.portfolioId || !refs.accountId || !refs.instrumentId) {
      throw new Error("Holding ledger references are missing");
    }

    const contractCount = Number(payload.quantity || holding.quantity || 0);
    if (!Number.isFinite(contractCount) || contractCount <= 0) {
      throw new Error("quantity must be greater than 0");
    }
    if (contractCount > Number(holding.quantity || 0)) {
      throw new Error("quantity exceeds current option contracts");
    }

    const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
    const feeAmount = Number(payload.feeAmount || 0) || 0;
    const taxAmount = Number(payload.taxAmount || 0) || 0;
    const notes = String(payload.notes || "").trim() || null;
    const strikePrice = Number(holding.strikePrice || 0);
    const contractMultiplier = Number(holding.contractMultiplier || 1) || 1;
    const shareQuantity = contractCount * contractMultiplier;
    const settlementGrossAmount = shareQuantity * strikePrice;
    const sourceRef = `holding:${holding.id}:settlement:${createId()}`;
    const optionTransactionType = action === "exercise" ? "OPTION_EXERCISE" : "OPTION_ASSIGNMENT";

    await insertPortfolioTransaction(env, {
      userId,
      portfolioId: refs.portfolioId,
      accountId: refs.accountId,
      instrumentId: refs.instrumentId,
      holdingId: holding.id,
      transactionType: optionTransactionType,
      side: holding.positionSide === "short" ? "SHORT" : "LONG",
      tradeDate,
      quantity: contractCount,
      unitPrice: strikePrice,
      grossAmount: settlementGrossAmount,
      feeAmount,
      taxAmount,
      netAmount:
        (holding.positionSide === "long" && holding.optionType === "call") ||
        (holding.positionSide === "short" && holding.optionType === "put")
          ? -(settlementGrossAmount + feeAmount + taxAmount)
          : settlementGrossAmount - feeAmount - taxAmount,
      tradeCurrency: holding.currency,
      fxRateToUsd: Number(holding.fxRate || 1) || 1,
      sourceRef,
      notes,
      metadataJson: JSON.stringify({
        action,
        optionType: holding.optionType,
        positionSide: holding.positionSide,
        underlying: holding.underlying,
        shareQuantity,
        contractCount,
      }),
    });

    const optionSettlement = await consumeHoldingLotsWithoutRealization(env, userId, holding, contractCount, tradeDate);
    const relatedHoldings = [];
    let stockResult = null;

    if (holding.positionSide === "long" && holding.optionType === "call") {
      const stockTotalCostTrade = settlementGrossAmount + optionSettlement.basisTradeAmount + feeAmount + taxAmount;
      stockResult = await addUnderlyingStockFromOptionSettlement(env, userId, holdingRow, {
        shareQuantity,
        totalCostTradeAmount: stockTotalCostTrade,
        tradeDate,
        sourceRef,
        notes,
        referencePrice: strikePrice,
      });
      const cashHolding = await applyCashBalanceImpact(env, userId, holdingRow, -(settlementGrossAmount + feeAmount + taxAmount), {
        action,
        tradeDate,
        notes,
        sourceRef,
      });
      if (cashHolding) relatedHoldings.push(cashHolding);
    } else if (holding.positionSide === "short" && holding.optionType === "put") {
      const stockTotalCostTrade = settlementGrossAmount - optionSettlement.basisTradeAmount + feeAmount + taxAmount;
      stockResult = await addUnderlyingStockFromOptionSettlement(env, userId, holdingRow, {
        shareQuantity,
        totalCostTradeAmount: stockTotalCostTrade,
        tradeDate,
        sourceRef,
        notes,
        referencePrice: strikePrice,
      });
      const cashHolding = await applyCashBalanceImpact(env, userId, holdingRow, -(settlementGrossAmount + feeAmount + taxAmount), {
        action,
        tradeDate,
        notes,
        sourceRef,
      });
      if (cashHolding) relatedHoldings.push(cashHolding);
    } else if (holding.positionSide === "long" && holding.optionType === "put") {
      const delivery = await deliverUnderlyingStockForOptionSettlement(env, userId, holdingRow, {
        shareQuantity,
        strikePrice,
        premiumAdjustmentTradeAmount: -optionSettlement.basisTradeAmount,
        feeAmount,
        taxAmount,
        tradeDate,
        sourceRef,
        notes,
      });
      stockResult = delivery?.holding || null;
      const cashHolding = await applyCashBalanceImpact(env, userId, holdingRow, settlementGrossAmount - feeAmount - taxAmount, {
        action,
        tradeDate,
        notes,
        sourceRef,
      });
      if (cashHolding) relatedHoldings.push(cashHolding);
    } else if (holding.positionSide === "short" && holding.optionType === "call") {
      const delivery = await deliverUnderlyingStockForOptionSettlement(env, userId, holdingRow, {
        shareQuantity,
        strikePrice,
        premiumAdjustmentTradeAmount: optionSettlement.basisTradeAmount,
        feeAmount,
        taxAmount,
        tradeDate,
        sourceRef,
        notes,
      });
      stockResult = delivery?.holding || null;
      const cashHolding = await applyCashBalanceImpact(env, userId, holdingRow, settlementGrossAmount - feeAmount - taxAmount, {
        action,
        tradeDate,
        notes,
        sourceRef,
      });
      if (cashHolding) relatedHoldings.push(cashHolding);
    }

    if (stockResult) relatedHoldings.push(stockResult);

    return {
      action,
      transactionType: optionTransactionType,
      quantity: contractCount,
      shareQuantity,
      holding: optionSettlement.holding,
      relatedHoldings,
    };
  });
}

export async function processOptionExpiration(env, userId, holdingId, payload = {}) {
  return withTransaction(env, async () => {
    const holdingRow = await getHoldingRow(env, userId, holdingId);
    if (!holdingRow) {
      const error = new Error("Holding not found");
      error.status = 404;
      throw error;
    }

    const holding = mapHoldingRow(holdingRow);
    if (holding.assetType !== "option") throw new Error("Only option holdings support expiration");
    if (holding.status === "CLOSED" || Number(holding.quantity || 0) <= 0) {
      throw new Error("This option holding is already closed");
    }

    const quantity = Number(payload.quantity || holding.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be greater than 0");
    if (quantity > Number(holding.quantity || 0)) throw new Error("quantity exceeds current option contracts");

    const refs = {
      portfolioId: holdingRow.portfolio_id,
      accountId: holdingRow.account_id,
      instrumentId: holdingRow.instrument_id,
    };
    if (!refs.portfolioId || !refs.accountId || !refs.instrumentId) {
      throw new Error("Holding ledger references are missing");
    }

    const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();
    const notes = String(payload.notes || "").trim() || null;
    const contractMultiplier = Number(holding.contractMultiplier || 1) || 1;
    const lotRows = await all(
      env,
      `SELECT *
       FROM position_lots
       WHERE holding_id = ?
         AND user_id = ?
         AND status = 'OPEN'
         AND remaining_quantity > 0
       ORDER BY open_date ASC, created_at ASC, id ASC`,
      [holding.id, userId]
    );

    let remainingToClose = quantity;
    let basisClosedUsd = 0;
    let realizedPnlUsdTotal = 0;

    const expireTransactionId = await insertPortfolioTransaction(env, {
      userId,
      portfolioId: refs.portfolioId,
      accountId: refs.accountId,
      instrumentId: refs.instrumentId,
      holdingId: holding.id,
      transactionType: "OPTION_EXPIRE",
      side: holding.positionSide === "short" ? "SHORT" : "LONG",
      tradeDate,
      quantity,
      unitPrice: 0,
      grossAmount: 0,
      feeAmount: 0,
      taxAmount: 0,
      netAmount: 0,
      tradeCurrency: holding.currency,
      fxRateToUsd: Number(holding.fxRate || 1) || 1,
      sourceRef: `holding:${holding.id}:expire`,
      notes,
      metadataJson: JSON.stringify({
        action: "expire",
        optionType: holding.optionType,
        positionSide: holding.positionSide,
        quantity,
      }),
    });

    for (const lot of lotRows) {
      if (remainingToClose <= 0) break;
      const lotRemaining = Number(lot.remaining_quantity || 0);
      if (lotRemaining <= 0) continue;

      const consumedQty = Math.min(remainingToClose, lotRemaining);
      const lotOpenUnitPrice = Number(lot.open_unit_price || 0);
      const lotFx = Number(lot.open_fx_rate_to_usd || 1) || 1;
      const basisTrade = consumedQty * lotOpenUnitPrice * contractMultiplier;
      const basisUsd = basisTrade * lotFx;
      const realizedTrade = holding.positionSide === "short" ? basisTrade : -basisTrade;
      const realizedUsd = holding.positionSide === "short" ? basisUsd : -basisUsd;

      basisClosedUsd += basisUsd;
      realizedPnlUsdTotal += realizedUsd;

      const newRemaining = lotRemaining - consumedQty;
      await run(
        env,
        `UPDATE position_lots
         SET remaining_quantity = ?,
             status = ?,
             closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [newRemaining, newRemaining === 0 ? "CLOSED" : "OPEN", newRemaining, tradeDate, lot.id, userId]
      );

      await run(
        env,
        `INSERT INTO realized_pnl_ledger (
          id, user_id, portfolio_id, account_id, instrument_id, holding_id,
          open_transaction_id, close_transaction_id, lot_id,
          recognized_date, quantity_closed, proceeds_amount, cost_amount,
          fee_amount, tax_amount, realized_pnl_amount, realized_pnl_usd,
          trade_currency, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createId(),
          userId,
          refs.portfolioId,
          refs.accountId,
          refs.instrumentId,
          holding.id,
          lot.open_transaction_id,
          expireTransactionId,
          lot.id,
          tradeDate,
          consumedQty,
          0,
          basisTrade,
          0,
          0,
          realizedTrade,
          realizedUsd,
          holding.currency,
          notes,
        ]
      );

      remainingToClose -= consumedQty;
    }

    if (remainingToClose > 0) {
      throw new Error("Not enough open lots to expire this option holding");
    }

    const newQuantity = Number(holding.quantity || 0) - quantity;
    const newBookCostTotal = Math.max(0, Number(holding.bookCostTotal || 0) - basisClosedUsd);
    const newRealizedPnlTotal = Number(holding.realizedPnlTotal || 0) + realizedPnlUsdTotal;
    const newCostPrice = newQuantity > 0 ? newBookCostTotal / (newQuantity * contractMultiplier * (Number(holding.fxRate || 1) || 1)) : 0;
    const nextStatus = newQuantity === 0 ? "CLOSED" : "OPEN";

    await run(
      env,
      `UPDATE holdings
       SET quantity = ?,
           cost_price = ?,
           current_price = 0,
           status = ?,
           closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
           book_cost_total = ?,
           realized_pnl_total = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [newQuantity, newCostPrice, nextStatus, nextStatus, tradeDate, newBookCostTotal, newRealizedPnlTotal, holding.id, userId]
    );

    await run(
      env,
      `UPDATE portfolio_transactions
       SET realized_pnl_amount = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [realizedPnlUsdTotal, expireTransactionId]
    );

    const updated = await getHoldingRow(env, userId, holding.id);
    return {
      action: "expire",
      transactionType: "OPTION_EXPIRE",
      quantity,
      realizedPnlUsd: realizedPnlUsdTotal,
      holding: updated ? mapHoldingRow(updated) : null,
      relatedHoldings: [],
    };
  });
}

export async function revertHoldingTrade(env, userId, transactionId) {
  return withTransaction(env, async () => {
    const tradeRow = await first(
      env,
      `SELECT *
       FROM portfolio_transactions
       WHERE id = ?
         AND user_id = ?
       LIMIT 1`,
      [transactionId, userId]
    );
    if (!tradeRow) throw new Error("交易流水不存在");

    if (!["OPENING_BALANCE", "ADD_POSITION", "REDUCE_POSITION", "CLOSE_POSITION", "SNAPSHOT_ADJUSTMENT"].includes(tradeRow.transaction_type)) {
      throw new Error("这条流水当前不支持撤销");
    }

    const latest = await first(
      env,
      `SELECT id
       FROM portfolio_transactions
       WHERE user_id = ?
         AND holding_id = ?
         AND transaction_type IN ('OPENING_BALANCE', 'ADD_POSITION', 'REDUCE_POSITION', 'CLOSE_POSITION', 'SNAPSHOT_ADJUSTMENT')
       ORDER BY trade_date DESC, created_at DESC, id DESC
       LIMIT 1`,
      [userId, tradeRow.holding_id]
    );

    if (!latest || latest.id !== transactionId) {
      throw new Error("为避免账本错乱，目前只支持撤销该持仓的最新一笔交易");
    }

    const relatedHoldings = [];

    if (tradeRow.transaction_type === "SNAPSHOT_ADJUSTMENT") {
      const metadata = parseMetadataJson(tradeRow.metadata_json) || {};
      const previousSnapshot = metadata?.previousSnapshot;
      if (!previousSnapshot) {
        throw new Error("这条快照调整缺少回滚所需的历史快照");
      }

      const holdingRow = await getHoldingRow(env, userId, tradeRow.holding_id);
      if (!holdingRow) throw new Error("Holding not found");
      const currentHolding = mapHoldingRow(holdingRow);
      const revertedHolding = normalizeHolding({ ...previousSnapshot, id: currentHolding.id });
      const refs = await ensureLedgerRefsForHolding(env, userId, revertedHolding);
      const status = inferHoldingStatus(revertedHolding);
      const closedAt = status === "CLOSED" ? (previousSnapshot.closedAt || currentHolding.closedAt || new Date()) : null;
      const enrichedHolding = {
        ...revertedHolding,
        userId,
        ...refs,
        status,
        openedAt: toSqlDateTime(previousSnapshot.openedAt || currentHolding.openedAt || holdingRow.created_at || new Date()),
        closedAt: toSqlDateTime(closedAt),
        bookCostTotal: computeHoldingBookCost(revertedHolding),
        realizedPnlTotal: currentHolding.realizedPnlTotal || 0,
      };

      await run(
        env,
        `UPDATE holdings SET
          portfolio_id = ?, account_id = ?, instrument_id = ?,
          asset_type = ?, position_side = ?, platform = ?, market = ?, symbol = ?, name = ?, currency = ?,
          quantity = ?, cost_price = ?, current_price = ?, fx_rate = ?, target_allocation = ?, notes = ?,
          underlying = ?, option_type = ?, strike_price = ?, expiry_date = ?, contract_multiplier = ?,
          status = ?, opened_at = ?, closed_at = ?, book_cost_total = ?, realized_pnl_total = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`,
        [
          enrichedHolding.portfolioId, enrichedHolding.accountId, enrichedHolding.instrumentId,
          enrichedHolding.assetType, enrichedHolding.positionSide, enrichedHolding.platform, enrichedHolding.market, enrichedHolding.symbol, enrichedHolding.name, enrichedHolding.currency,
          enrichedHolding.quantity, enrichedHolding.costPrice, enrichedHolding.currentPrice, enrichedHolding.fxRate, enrichedHolding.targetAllocation, enrichedHolding.notes,
          enrichedHolding.underlying, enrichedHolding.optionType, enrichedHolding.strikePrice, enrichedHolding.expiryDate, enrichedHolding.contractMultiplier,
          enrichedHolding.status, enrichedHolding.openedAt, enrichedHolding.closedAt, enrichedHolding.bookCostTotal, enrichedHolding.realizedPnlTotal,
          enrichedHolding.id, userId,
        ]
      );

      await run(env, "DELETE FROM portfolio_transactions WHERE id = ? AND user_id = ?", [transactionId, userId]);
      const updated = await getHoldingRow(env, userId, tradeRow.holding_id);
      return {
        revertedTransactionId: transactionId,
        transactionType: tradeRow.transaction_type,
        holding: updated ? mapHoldingRow(updated) : null,
        relatedHoldings,
      };
    }

    if (tradeRow.transaction_type === "OPENING_BALANCE") {
      await run(env, "DELETE FROM position_lots WHERE open_transaction_id = ? AND user_id = ?", [transactionId, userId]);
      await run(env, "DELETE FROM realized_pnl_ledger WHERE holding_id = ? AND user_id = ?", [tradeRow.holding_id, userId]);
      await run(env, "DELETE FROM portfolio_transactions WHERE id = ? AND user_id = ?", [transactionId, userId]);
      await run(env, "DELETE FROM holdings WHERE id = ? AND user_id = ?", [tradeRow.holding_id, userId]);
      return {
        revertedTransactionId: transactionId,
        transactionType: tradeRow.transaction_type,
        holding: null,
        deletedHoldingId: tradeRow.holding_id,
        relatedHoldings,
      };
    }

    if (tradeRow.transaction_type === "ADD_POSITION") {
      await run(env, "DELETE FROM position_lots WHERE open_transaction_id = ? AND user_id = ?", [transactionId, userId]);
    } else {
      const ledgerRows = await all(
        env,
        `SELECT lot_id, quantity_closed
         FROM realized_pnl_ledger
         WHERE close_transaction_id = ?
           AND user_id = ?`,
        [transactionId, userId]
      );

      for (const ledgerRow of ledgerRows) {
        await run(
          env,
          `UPDATE position_lots
           SET remaining_quantity = remaining_quantity + ?,
               status = 'OPEN',
               closed_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND user_id = ?`,
          [Number(ledgerRow.quantity_closed || 0), ledgerRow.lot_id, userId]
        );
      }

      await run(env, "DELETE FROM realized_pnl_ledger WHERE close_transaction_id = ? AND user_id = ?", [transactionId, userId]);
    }

    const cashHolding = await reverseCashSettlementForTrade(env, userId, tradeRow);
    if (cashHolding) relatedHoldings.push(cashHolding);

    await run(env, "DELETE FROM portfolio_transactions WHERE id = ? AND user_id = ?", [transactionId, userId]);
    const updatedHolding = await recomputeHoldingFromLedger(env, userId, tradeRow.holding_id);

    return {
      revertedTransactionId: transactionId,
      transactionType: tradeRow.transaction_type,
      holding: updatedHolding,
      relatedHoldings,
    };
  });
}
