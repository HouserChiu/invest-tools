import { all, first, run } from "./d1-client.mjs";
import { mapHoldingRow } from "../lib/mappers.mjs";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatShanghaiDate(value) {
  return SHANGHAI_DATE_FORMATTER.format(value);
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatShanghaiDate(value);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }
  return formatShanghaiDate(parsed);
}

function getCurrentDateString() {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getYesterdayDateString() {
  const value = new Date();
  value.setDate(value.getDate() - 1);
  return formatShanghaiDate(value);
}

function parseNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCacheToken(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function normalizeStockSymbol(symbol, market) {
  const normalized = normalizeCacheToken(symbol);
  const normalizedMarket = normalizeCacheToken(market || "US");
  if (!normalized) {
    throw new Error("symbol is required for stock");
  }
  if (normalizedMarket === "HK" && !normalized.endsWith(".HK")) return `${normalized}.HK`;
  if (["KR", "KOSPI"].includes(normalizedMarket) && !(normalized.endsWith(".KS") || normalized.endsWith(".KQ"))) {
    return `${normalized}.KS`;
  }
  if (["KQ", "KOSDAQ"].includes(normalizedMarket) && !normalized.endsWith(".KQ")) return `${normalized}.KQ`;
  if (normalizedMarket === "JP" && !normalized.endsWith(".T")) return `${normalized}.T`;
  if (["UK", "LON", "LSE"].includes(normalizedMarket) && !normalized.endsWith(".L")) return `${normalized}.L`;
  return normalized;
}

function normalizeCryptoSymbol(symbol, currency) {
  const base = normalizeCacheToken(symbol);
  const quote = normalizeCacheToken(currency || "USD");
  if (!base) throw new Error("symbol is required for crypto");
  if (base.includes("-")) return base;
  return `${base}-${quote}`;
}

function normalizeMacroSymbol(symbol, currency) {
  const normalized = normalizeCacheToken(symbol);
  if (!normalized) throw new Error("symbol is required for macro");
  if (["GC=F", "SI=F"].includes(normalized)) return normalized;
  if (["XAUUSD=X", "XAUUSD"].includes(normalized)) return "GC=F";
  if (["XAGUSD=X", "XAGUSD"].includes(normalized)) return "SI=F";
  const compact = normalized.replace("/", "").replace("-", "");
  if (compact.length === 6 && /^[A-Z]+$/.test(compact)) return `${compact}=X`;
  throw new Error(`Unsupported macro symbol: ${symbol}`);
}

function buildUsdFxSymbol(currency) {
  const quote = normalizeCacheToken(currency);
  if (!quote || quote === "USD") return "";
  return `USD${quote}=X`;
}

function getFallbackFxRateToUsd(currency) {
  const normalized = normalizeCacheToken(currency);
  if (["USD", "USDT", "USDC"].includes(normalized)) return 1;
  if (normalized === "HKD") return 0.128;
  if (normalized === "KRW") return 0.0007;
  return 1;
}

function addDaysToDateOnly(value, dayOffset) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + Number(dayOffset || 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function buildYahooOptionSymbol(underlying, expiryDate, optionType, strikePrice) {
  const root = normalizeCacheToken(underlying);
  if (!root) throw new Error("underlying is required for option");
  const normalizedExpiry = toDateOnly(expiryDate);
  if (!normalizedExpiry) throw new Error("expiryDate must be YYYY-MM-DD");
  const [year, month, day] = normalizedExpiry.split("-").map(Number);
  const expiry = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(expiry.getTime())) throw new Error("expiryDate must be YYYY-MM-DD");
  const optionKind = String(optionType || "").trim().toLowerCase();
  if (!["call", "put"].includes(optionKind)) throw new Error("optionType must be call or put");
  const strike = Number(strikePrice || 0);
  if (!(strike > 0)) throw new Error("strikePrice must be > 0");
  const cpFlag = optionKind === "call" ? "C" : "P";
  const yy = String(expiry.getUTCFullYear()).slice(-2);
  const mm = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${root}${yy}${mm}${dd}${cpFlag}${strikeCode}`;
}

function buildYahooOptionSymbolCandidates(underlying, expiryDate, optionType, strikePrice) {
  const exactDate = toDateOnly(expiryDate);
  const nextDate = addDaysToDateOnly(exactDate, 1);
  const seen = new Set();

  return [exactDate, nextDate]
    .filter(Boolean)
    .map((candidateDate) => ({
      optionSymbol: buildYahooOptionSymbol(underlying, candidateDate, optionType, strikePrice),
      normalizedExpiryDate: candidateDate,
    }))
    .filter((candidate) => {
      if (seen.has(candidate.optionSymbol)) return false;
      seen.add(candidate.optionSymbol);
      return true;
    });
}

function buildQuoteCacheKey(holding, requestDate) {
  const isOption = holding.assetType === "option";
  const symbol = isOption
    ? normalizeCacheToken(holding.underlying || holding.symbol)
    : normalizeCacheToken(holding.symbol);
  const strikeToken = isOption ? String(Number(holding.strikePrice || 0).toFixed(3)) : "";

  return [
    normalizeCacheToken(holding.assetType),
    normalizeCacheToken(holding.market),
    symbol,
    normalizeCacheToken(holding.currency),
    normalizeCacheToken(holding.optionType),
    strikeToken,
    toDateOnly(holding.expiryDate) || "",
    toDateOnly(requestDate) || "",
  ].join("|");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
  }

  return response.json();
}

function isYahooNoDataError(error) {
  return /No data found|Not Found|No chart result/i.test(String(error?.message || ""));
}

async function parseChartClose(symbol, requestDate = getYesterdayDateString()) {
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=15d&includePrePost=false&events=div,splits`);
  const chart = payload?.chart || {};
  if (chart.error) throw new Error(String(chart.error?.description || chart.error));
  const results = chart.result || [];
  if (!results.length) throw new Error(`No chart result for ${symbol}`);

  const item = results[0];
  const timestamps = item.timestamp || [];
  const quote = (item.indicators?.quote || [{}])[0];
  const closes = quote.close || [];
  let latest = null;
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = closes[index];
    if (close == null) continue;
    const priceDate = new Date(Number(timestamps[index]) * 1000).toISOString().slice(0, 10);
    if (requestDate && priceDate > requestDate) continue;
    latest = {
      priceDate,
      currentPrice: Number(close),
    };
  }
  if (!latest) throw new Error(`No valid close price found for ${symbol}`);
  return {
    found: true,
    symbol,
    currentPrice: latest.currentPrice,
    priceDate: latest.priceDate,
    quoteCurrency: item.meta?.currency || "USD",
    source: "Yahoo Finance chart",
  };
}

async function lookupStock(holding, requestDate) {
  return parseChartClose(normalizeStockSymbol(holding.symbol, holding.market || "US"), requestDate);
}

async function lookupCrypto(holding, requestDate) {
  const base = normalizeCacheToken(holding.symbol);
  const quote = normalizeCacheToken(holding.currency || "USD");
  const directSymbol = normalizeCryptoSymbol(base, quote);
  try {
    return await parseChartClose(directSymbol, requestDate);
  } catch (directError) {
    const usdSnapshot = await parseChartClose(`${base}-USD`, requestDate);
    if (["USD", "USDT", "USDC"].includes(quote)) {
      return {
        ...usdSnapshot,
        symbol: directSymbol,
        quoteCurrency: quote,
        source: "Yahoo Finance chart (USD proxy)",
      };
    }
    const fxSymbol = buildUsdFxSymbol(quote);
    if (!fxSymbol) throw directError;
    const fxSnapshot = await parseChartClose(fxSymbol, requestDate);
    return {
      found: true,
      symbol: directSymbol,
      currentPrice: Number(usdSnapshot.currentPrice) * Number(fxSnapshot.currentPrice),
      priceDate: usdSnapshot.priceDate,
      quoteCurrency: quote,
      source: `Yahoo Finance chart (USD converted to ${quote})`,
    };
  }
}

async function lookupOption(holding, requestDate) {
  const candidates = buildYahooOptionSymbolCandidates(
    holding.underlying || holding.symbol,
    holding.expiryDate,
    holding.optionType,
    holding.strikePrice
  );

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const result = await parseChartClose(candidate.optionSymbol, requestDate);
      return {
        ...result,
        underlying: normalizeCacheToken(holding.underlying || holding.symbol),
        optionSymbol: candidate.optionSymbol,
        normalizedExpiryDate: candidate.normalizedExpiryDate,
      };
    } catch (error) {
      lastError = error;
      if (!isYahooNoDataError(error)) throw error;
    }
  }

  throw lastError || new Error(`No quote returned for ${holding.symbol}`);
}

async function lookupMacro(holding, requestDate) {
  return parseChartClose(normalizeMacroSymbol(holding.symbol, holding.currency || "USD"), requestDate);
}

export async function lookupFxRateToUsd(currency, requestDate = getYesterdayDateString()) {
  const normalized = normalizeCacheToken(currency);
  if (!normalized) return 1;
  if (["USD", "USDT", "USDC"].includes(normalized)) return 1;

  const fxSymbol = buildUsdFxSymbol(normalized);
  if (!fxSymbol) return getFallbackFxRateToUsd(normalized);

  try {
    const snapshot = await parseChartClose(fxSymbol, requestDate);
    const usdToQuote = Number(snapshot?.currentPrice || 0);
    if (!(usdToQuote > 0)) return getFallbackFxRateToUsd(normalized);
    return 1 / usdToQuote;
  } catch {
    return getFallbackFxRateToUsd(normalized);
  }
}

async function getCachedQuote(env, holding, requestDate) {
  const cacheKey = buildQuoteCacheKey(holding, requestDate);
  const row = await first(env, "SELECT * FROM market_quotes WHERE cache_key = ? LIMIT 1", [cacheKey]);
  if (!row) return null;
  return {
    found: row.current_price != null,
    currentPrice: row.current_price == null ? null : Number(row.current_price),
    quoteCurrency: row.quote_currency || holding.currency,
    priceDate: toDateOnly(row.price_date) || requestDate,
    source: row.source || "D1 market cache",
    notes: "cache_hit",
    cacheHit: true,
  };
}

async function storeQuoteInCache(env, holding, requestDate, snapshot) {
  const cacheKey = buildQuoteCacheKey(holding, requestDate);
  await run(
    env,
    `INSERT INTO market_quotes (
      cache_key, request_date, asset_type, market, symbol, currency,
      underlying, option_type, strike_price, expiry_date,
      current_price, quote_currency, price_date, source, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      current_price = excluded.current_price,
      quote_currency = excluded.quote_currency,
      price_date = excluded.price_date,
      source = excluded.source,
      fetched_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP`,
    [
      cacheKey,
      requestDate,
      holding.assetType,
      holding.market,
      holding.symbol,
      holding.currency,
      holding.underlying || "",
      holding.optionType || "",
      Number(holding.strikePrice || 0),
      toDateOnly(holding.expiryDate),
      snapshot.currentPrice,
      snapshot.quoteCurrency || holding.currency,
      toDateOnly(snapshot.priceDate) || requestDate,
      snapshot.source || "Yahoo Finance worker",
    ]
  );
}

async function fetchQuoteDirect(holding, requestDate) {
  if (holding.assetType === "cash") {
    return {
      found: true,
      currentPrice: 1,
      quoteCurrency: holding.currency,
      priceDate: getYesterdayDateString(),
      source: "local_cash",
      notes: "",
    };
  }
  if (holding.assetType === "stock") return lookupStock(holding, requestDate);
  if (holding.assetType === "crypto") return lookupCrypto(holding, requestDate);
  if (holding.assetType === "option") return lookupOption(holding, requestDate);
  if (holding.assetType === "macro") return lookupMacro(holding, requestDate);
  throw new Error(`Unsupported asset type ${holding.assetType}`);
}

export async function resolveQuoteWithCache(env, holding, requestDate = getYesterdayDateString()) {
  const cached = holding.assetType === "option" ? null : await getCachedQuote(env, holding, requestDate);
  if (cached) return cached;
  const result = await fetchQuoteDirect(holding, requestDate);
  if (!result?.found || parseNumber(result.currentPrice) == null) {
    throw new Error(result?.notes || `No quote returned for ${holding.symbol}`);
  }
  await storeQuoteInCache(env, holding, requestDate, result);
  return { ...result, cacheHit: false };
}

export async function lookupQuote(env, rawHolding) {
  const holding = {
    ...rawHolding,
    symbol: String(rawHolding?.symbol || "").trim().toUpperCase(),
    currency: String(rawHolding?.currency || "").trim().toUpperCase(),
    market: String(rawHolding?.market || "").trim(),
    underlying: String(rawHolding?.underlying || "").trim().toUpperCase(),
    optionType: String(rawHolding?.optionType || "").trim().toLowerCase(),
    strikePrice: rawHolding?.strikePrice == null || rawHolding?.strikePrice === "" ? null : Number(rawHolding.strikePrice),
    expiryDate: toDateOnly(rawHolding?.expiryDate),
  };
  const result = await resolveQuoteWithCache(env, holding);
  return {
    ...result,
    fxRateToUsd: await lookupFxRateToUsd(holding.currency, result?.priceDate || getYesterdayDateString()),
  };
}

export async function refreshMarketPrices(env, userId, options = {}) {
  const holdingId = options.holdingId ? String(options.holdingId) : "";
  const force = Boolean(options.force);
  const rows = holdingId
    ? await all(
        env,
        "SELECT * FROM holdings WHERE user_id = ? AND id = ? ORDER BY updated_at DESC, created_at DESC",
        [userId, holdingId]
      )
    : await all(
        env,
        "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
        [userId]
      );

  const holdings = rows.map(mapHoldingRow);
  const warningSet = new Set();
  let updatedCount = 0;
  const todayDate = getCurrentDateString();
  const requestDate = getYesterdayDateString();

  for (const holding of holdings) {
    if (!force && holding.lastPriceSyncDate === todayDate) continue;
    const resolvedFxRate = await lookupFxRateToUsd(holding.currency, requestDate);

    if (holding.assetType === "cash") {
      await run(
        env,
        `UPDATE holdings
         SET current_price = 1,
             fx_rate = ?,
             last_price_sync_date = ?,
             last_price_sync_status = ?,
             last_price_sync_error = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [resolvedFxRate, todayDate, "synced", holding.id, userId]
      );
      continue;
    }

    try {
      const quote = await resolveQuoteWithCache(env, holding, requestDate);
      await run(
        env,
        `UPDATE holdings
         SET current_price = ?,
             fx_rate = ?,
             expiry_date = COALESCE(?, expiry_date),
             last_price_sync_date = ?,
             last_price_sync_status = ?,
             last_price_sync_error = NULL,
             updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`,
        [
          quote.currentPrice,
          resolvedFxRate,
          quote.normalizedExpiryDate && quote.normalizedExpiryDate !== holding.expiryDate ? quote.normalizedExpiryDate : null,
          todayDate,
          "synced",
          holding.id,
          userId,
        ]
      );
      updatedCount += 1;
    } catch (error) {
      await run(
        env,
        `UPDATE holdings
         SET last_price_sync_status = ?,
             last_price_sync_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        ["failed", String(error.message || "Unknown sync error").slice(0, 500), holding.id, userId]
      );
      warningSet.add(`${holding.symbol} 未更新：${error.message}`);
    }
  }

  const refreshedRows = holdingId
    ? await all(
        env,
        "SELECT * FROM holdings WHERE user_id = ? AND id = ? ORDER BY updated_at DESC, created_at DESC",
        [userId, holdingId]
      )
    : await all(
        env,
        "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
        [userId]
      );

  return {
    holdings: refreshedRows.map(mapHoldingRow),
    updatedCount,
    warnings: [...warningSet],
    refreshedAt: new Date().toISOString(),
  };
}
