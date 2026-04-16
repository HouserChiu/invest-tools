const express = require("express");
const mysql = require("mysql2/promise");
const { marked } = require("marked");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

loadEnvFile(".env");
loadEnvFile(".env.example");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "zhao6776423";
const DB_NAME = process.env.DB_NAME || "investment_dashboard";
const EODHD_API_KEY = process.env.EODHD_API_KEY || "";
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "";
const ALPHA_VANTAGE_MIN_INTERVAL_MS = Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 1200);
const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "";
const CRYPTO_PROXY_URL = process.env.CRYPTO_PROXY_URL || "";
const CRYPTO_CCXT_TIMEOUT_MS = Number(process.env.CRYPTO_CCXT_TIMEOUT_MS || 30000);
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const SESSION_COOKIE_NAME = "investment_session";
const SESSION_TTL_DAYS = 30;
const INVITE_CODE = String(process.env.INVITE_CODE || "").trim();
const MANUAL_FX_CURRENCIES = new Set(["USD", "USDT", "USDC"]);
const COINGECKO_SYMBOL_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  SUI: "sui",
  TON: "the-open-network",
};
const BINANCE_QUOTE_PRIORITY = ["USDT", "USDC", "BUSD", "FDUSD", "USD"];
const BINANCE_DIRECT_QUOTES = new Set(["USD", "USDT", "USDC", "BUSD", "FDUSD"]);
const CCXT_FALLBACK_QUOTES = ["USDT", "USD", "USDC"];
const CONTENT_FILES = [
  path.join(__dirname, "data", "site.json"),
  path.join(__dirname, "data", "home.json"),
  path.join(__dirname, "data", "stocks.json"),
  path.join(__dirname, "data", "crypto.json"),
  path.join(__dirname, "data", "sim.json"),
  path.join(__dirname, "data", "portfolio.json"),
];

const app = express();
let lastAlphaVantageRequestAt = 0;
const execFileAsync = promisify(execFile);
let databaseReady = false;

function getLanAddresses() {
  const interfaces = require("os").networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return [...new Set(addresses)];
}

function loadEnvFile(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.json());

marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderMarkdownFile(markdownPath) {
  if (!markdownPath) return null;

  const fullPath = path.join(__dirname, markdownPath);
  if (!fs.existsSync(fullPath)) return null;

  const raw = fs.readFileSync(fullPath, "utf8");
  return marked.parse(raw);
}

function enrichMarkdownContent(value) {
  if (Array.isArray(value)) {
    return value.map((item) => enrichMarkdownContent(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, enrichMarkdownContent(entry)])
  );

  if (next.markdownPath) {
    next.markdownHtml = renderMarkdownFile(next.markdownPath);
  }

  return next;
}

function loadSiteContent() {
  return CONTENT_FILES.reduce(
    (accumulator, filePath) => {
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));

      if (content.site) {
        accumulator.site = { ...accumulator.site, ...content.site };
      }

      if (content.sidebars) {
        accumulator.sidebars = { ...accumulator.sidebars, ...content.sidebars };
      }

      if (content.pages) {
        accumulator.pages = {
          ...accumulator.pages,
          ...Object.fromEntries(Object.entries(content.pages).map(([key, page]) => [key, enrichMarkdownContent(page)])),
        };
      }

      return accumulator;
    },
    { site: {}, sidebars: {}, pages: {} }
  );
}

function getPageContent(key) {
  const siteContent = loadSiteContent();
  const page = siteContent.pages[key];

  if (!page) {
    return null;
  }

  return {
    site: siteContent.site,
    sidebars: siteContent.sidebars,
    page,
  };
}

function renderPage(res, key, currentPath) {
  const content = getPageContent(key);

  if (!content) {
    res.status(404).send("Page not found");
    return;
  }

  res.render(content.page.template, {
    site: content.site,
    page: content.page,
    sidebar: content.page.sidebar ? content.sidebars[content.page.sidebar] : null,
    currentPath,
  });
}

function requireDatabase(_req, res, next) {
  if (!databaseReady) {
    return res.status(503).json({ error: "Database is not available yet" });
  }

  next();
}

function createId() {
  return crypto.randomUUID();
}

function createInviteCode() {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, expected] = String(passwordHash || "").split(":");
  if (!salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expected, "hex"));
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const index = part.indexOf("=");
      if (index === -1) return accumulator;
      const key = decodeURIComponent(part.slice(0, index));
      const value = decodeURIComponent(part.slice(index + 1));
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function setSessionCookie(res, token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
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

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    inviteCode: row.invite_code || "",
    invitedBy: row.invited_by || null,
    createdAt: row.created_at,
  };
}

function mapRow(row) {
  return {
    id: row.id,
    assetType: row.asset_type,
    positionSide: row.position_side,
    platform: row.platform,
    market: row.market,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    quantity: Number(row.quantity),
    costPrice: Number(row.cost_price),
    currentPrice: Number(row.current_price),
    fxRate: Number(row.fx_rate),
    targetAllocation: Number(row.target_allocation),
    notes: row.notes || "",
    underlying: row.underlying || "",
    optionType: row.option_type || "",
    strikePrice: row.strike_price == null ? 0 : Number(row.strike_price),
    expiryDate: toDateOnly(row.expiry_date),
    contractMultiplier: Number(row.contract_multiplier || 1),
    lastPriceSyncDate: toDateOnly(row.last_price_sync_date),
    lastPriceSyncStatus: row.last_price_sync_status || "",
    lastPriceSyncError: row.last_price_sync_error || "",
  };
}

function parseNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function getYesterdayDateString() {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function getCurrentDateString() {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateString(dateString, offsetDays) {
  const value = new Date(`${dateString}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function toCoinGeckoDate(dateString) {
  const [year, month, day] = String(dateString || "").split("-");
  return `${day}-${month}-${year}`;
}

function toCompactDate(dateString) {
  return String(dateString || "").replaceAll("-", "");
}

function normalizeMacroSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
}

function toOptionExpiryCode(dateString) {
  const normalized = toDateOnly(dateString);
  if (!normalized || normalized.length !== 10) return "";
  return normalized.slice(2, 4) + normalized.slice(5, 7) + normalized.slice(8, 10);
}

function toPolygonStrikeCode(value) {
  const strikeValue = Number(value);
  if (!Number.isFinite(strikeValue) || strikeValue <= 0) return "";
  return String(Math.round(strikeValue * 1000)).padStart(8, "0");
}

function extractKrStockCode(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  const digits = normalized.match(/\d{6}/);
  return digits ? digits[0] : normalized.replace(/[^0-9]/g, "").slice(0, 6);
}

function buildPolygonOptionTicker(holding) {
  const rawSymbol = String(holding.symbol || "").trim().toUpperCase();
  if (rawSymbol.startsWith("O:")) {
    return rawSymbol;
  }

  const root = String(holding.underlying || holding.symbol || "").trim().toUpperCase();
  const expiryCode = toOptionExpiryCode(holding.expiryDate);
  const strikeCode = toPolygonStrikeCode(holding.strikePrice);
  const optionSide = String(holding.optionType || "").trim().toLowerCase();
  const contractType = optionSide === "put" ? "P" : optionSide === "call" ? "C" : "";

  if (!root || !expiryCode || !strikeCode || !contractType) {
    return "";
  }

  return `O:${root}${expiryCode}${contractType}${strikeCode}`;
}

function getAlphaVantageUrl(params) {
  const url = new URL("https://www.alphavantage.co/query");
  Object.entries({ ...params, apikey: ALPHA_VANTAGE_API_KEY }).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

function getEodhdUrl(pathname, params = {}) {
  const url = new URL(`https://eodhd.com/api/${pathname}`);
  Object.entries({ ...params, api_token: EODHD_API_KEY, fmt: "json" }).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchAlphaVantage(params) {
  if (!ALPHA_VANTAGE_API_KEY) {
    throw new Error("Missing ALPHA_VANTAGE_API_KEY");
  }

  const waitMs = Math.max(0, lastAlphaVantageRequestAt + ALPHA_VANTAGE_MIN_INTERVAL_MS - Date.now());
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const payload = await fetchJson(getAlphaVantageUrl(params));
  lastAlphaVantageRequestAt = Date.now();

  if (payload.Note || payload.Information) {
    throw new Error(payload.Note || payload.Information);
  }

  if (payload["Error Message"]) {
    throw new Error(payload["Error Message"]);
  }

  return payload;
}

async function fetchEodhd(pathname, params = {}) {
  if (!EODHD_API_KEY) {
    throw new Error("Missing EODHD_API_KEY");
  }

  const payload = await fetchJson(getEodhdUrl(pathname, params));
  if (payload?.error) {
    throw new Error(payload.error);
  }
  return payload;
}

function toEodhdUsSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return "";
  return normalized.includes(".") ? normalized : `${normalized}.US`;
}

function toEodhdForexSymbol(baseCurrency, quoteCurrency = "USD") {
  const base = String(baseCurrency || "").trim().toUpperCase();
  const quote = String(quoteCurrency || "").trim().toUpperCase();
  if (!base || !quote) return "";
  return `${base}${quote}.FOREX`;
}

async function fetchEodhdLatestClose(symbolCode, cache, cacheKey) {
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const to = getCurrentDateString();
  const from = shiftDateString(to, -10);
  const payload = await fetchEodhd(`eod/${symbolCode}`, { from, to, order: "a" });
  const series = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const latest = [...series].reverse().find((item) => parseNumber(item?.close) != null);
  const price = latest ? parseNumber(latest.close) : null;

  if (price == null) {
    throw new Error(`No EODHD close returned for ${symbolCode}`);
  }

  cache.set(cacheKey, price);
  return price;
}

async function fetchUsdFxRate(currency, cache) {
  const normalized = String(currency || "").toUpperCase();
  if (!normalized || MANUAL_FX_CURRENCIES.has(normalized)) return 1;
  if (cache.has(normalized)) return cache.get(normalized);

  const symbolCode = toEodhdForexSymbol(normalized, "USD");
  const rate = await fetchEodhdLatestClose(symbolCode, cache, normalized);
  if (rate == null) {
    throw new Error(`No FX rate returned for ${normalized}/USD`);
  }

  cache.set(normalized, rate);
  return rate;
}

async function fetchStockPrice(holding, stockCache) {
  const key = `${holding.market}:${holding.symbol}`;
  if (stockCache.has(key)) return stockCache.get(key);

  if (holding.market === "KR") {
    const price = await fetchKrStockPrice(holding, stockCache);
    stockCache.set(key, price);
    return price;
  }

  if (holding.market !== "US") {
    throw new Error(`Stock auto-refresh currently supports US/KR quotes only (${holding.symbol})`);
  }

  const symbolCode = toEodhdUsSymbol(holding.symbol);
  const price = await fetchEodhdLatestClose(symbolCode, stockCache, key);
  if (price == null) {
    throw new Error(`No quote returned for ${holding.symbol}`);
  }

  stockCache.set(key, price);
  return price;
}

async function fetchKrStockPrice(holding, stockCache) {
  const shortCode = extractKrStockCode(holding.symbol);
  if (!shortCode) {
    throw new Error(`Invalid KR stock code: ${holding.symbol}`);
  }

  const cacheKey = `KR:${shortCode}:latest-close`;
  if (stockCache.has(cacheKey)) {
    return stockCache.get(cacheKey);
  }

  try {
    const price = await fetchKrStockPriceWithFdr(shortCode);
    stockCache.set(cacheKey, price);
    return price;
  } catch (error) {
    throw new Error(`FinanceDataReader lookup failed for ${holding.symbol}: ${error.message}`);
  }
}

async function fetchKrStockPriceWithFdr(shortCode) {
  const script = `
import json
import sys

try:
    import FinanceDataReader as fdr
except ModuleNotFoundError as exc:
    raise SystemExit(f"MODULE_NOT_FOUND:{exc.name}")

symbol = sys.argv[1]
df = fdr.DataReader(symbol)

if df is None or df.empty:
    raise SystemExit("EMPTY_DATA")

if "Close" not in df.columns:
    raise SystemExit("MISSING_CLOSE")

close_series = df["Close"].dropna()
if close_series.empty:
    raise SystemExit("EMPTY_CLOSE")

last_index = close_series.index[-1]
payload = {
    "date": str(last_index.date() if hasattr(last_index, "date") else last_index)[:10],
    "close": float(close_series.iloc[-1]),
}
print(json.dumps(payload, ensure_ascii=True))
  `.trim();

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      ["-c", script, shortCode],
      { timeout: 20000, maxBuffer: 1024 * 1024 }
    );

    const payload = JSON.parse(String(stdout || "").trim());
    const price = parseNumber(payload.close);
    if (price == null) {
      throw new Error("No close price returned");
    }
    return price;
  } catch (error) {
    const stderr = String(error.stderr || "").trim();
    const stdout = String(error.stdout || "").trim();
    const detail = stderr || stdout || error.message;

    if (detail.includes("MODULE_NOT_FOUND:FinanceDataReader")) {
      throw new Error(`FinanceDataReader is not installed for ${PYTHON_BIN}. Run: ${PYTHON_BIN} -m pip install finance-datareader`);
    }

    if (detail.includes("MODULE_NOT_FOUND:")) {
      throw new Error(`Python dependency missing in ${PYTHON_BIN}: ${detail}`);
    }

    if (detail.includes("EMPTY_DATA") || detail.includes("EMPTY_CLOSE") || detail.includes("MISSING_CLOSE")) {
      throw new Error(`No recent close returned for KR stock code ${shortCode}`);
    }

    throw new Error(detail);
  }
}

async function fetchOptionPrice(holding, optionCache) {
  if (!POLYGON_API_KEY) {
    throw new Error("Missing POLYGON_API_KEY");
  }

  const ticker = buildPolygonOptionTicker(holding);
  if (!ticker) {
    throw new Error(`Cannot build Polygon option ticker from ${holding.symbol}`);
  }

  if (optionCache.has(ticker)) {
    return optionCache.get(ticker);
  }

  const script = `
from polygon import RESTClient
from datetime import datetime, timedelta
import json
import sys

api_key = sys.argv[1]
ticker = sys.argv[2]
client = RESTClient(api_key)

end_date = datetime.utcnow().date()

for offset in range(1, 8):
    day = (end_date - timedelta(days=offset)).strftime("%Y-%m-%d")
    aggs = client.get_aggs(
        ticker=ticker,
        multiplier=1,
        timespan="day",
        from_=day,
        to=day,
    )
    if aggs:
        first = aggs[0]
        close = getattr(first, "close", None)
        if close is not None:
            print(json.dumps({"date": day, "close": float(close)}, ensure_ascii=True))
            break
else:
    raise SystemExit("NO_OPTION_AGG")
  `.trim();

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      ["-c", script, POLYGON_API_KEY, ticker],
      { timeout: 20000, maxBuffer: 1024 * 1024 }
    );

    const payload = JSON.parse(String(stdout || "").trim());
    const price = parseNumber(payload.close);
    if (price == null) {
      throw new Error("No option close price returned");
    }

    optionCache.set(ticker, price);
    return price;
  } catch (error) {
    const stderr = String(error.stderr || "").trim();
    const stdout = String(error.stdout || "").trim();
    const detail = stderr || stdout || error.message;

    if (detail.includes("No module named 'polygon'") || detail.includes('No module named "polygon"')) {
      throw new Error(`polygon-api-client is not installed for ${PYTHON_BIN}. Run: ${PYTHON_BIN} -m pip install polygon-api-client`);
    }

    if (detail.includes("NO_OPTION_AGG")) {
      throw new Error(`No recent Polygon daily close returned for ${ticker}`);
    }

    throw new Error(detail);
  }
}

async function fetchMacroPrice(holding, macroCache) {
  if (!POLYGON_API_KEY) {
    throw new Error("Missing POLYGON_API_KEY");
  }

  const normalized = normalizeMacroSymbol(holding.symbol);
  if (!normalized || normalized.length < 6) {
    throw new Error(`Invalid macro symbol: ${holding.symbol}`);
  }

  const ticker = normalized.startsWith("C:") ? normalized : `C:${normalized}`;
  if (macroCache.has(ticker)) {
    return macroCache.get(ticker);
  }

  const script = `
from polygon import RESTClient
from datetime import datetime, timedelta
import json
import sys

api_key = sys.argv[1]
ticker = sys.argv[2]
client = RESTClient(api_key)

end_date = datetime.utcnow().date()

for offset in range(1, 8):
    day = (end_date - timedelta(days=offset)).strftime("%Y-%m-%d")
    aggs = client.get_aggs(
        ticker=ticker,
        multiplier=1,
        timespan="day",
        from_=day,
        to=day,
    )
    if aggs:
        first = aggs[0]
        close = getattr(first, "close", None)
        if close is not None:
            print(json.dumps({"date": day, "close": float(close)}, ensure_ascii=True))
            break
else:
    raise SystemExit("NO_MACRO_AGG")
  `.trim();

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      ["-c", script, POLYGON_API_KEY, ticker],
      { timeout: 20000, maxBuffer: 1024 * 1024 }
    );

    const payload = JSON.parse(String(stdout || "").trim());
    const price = parseNumber(payload.close);
    if (price == null) {
      throw new Error("No macro close price returned");
    }

    macroCache.set(ticker, price);
    return price;
  } catch (error) {
    const stderr = String(error.stderr || "").trim();
    const stdout = String(error.stdout || "").trim();
    const detail = stderr || stdout || error.message;

    if (detail.includes("No module named 'polygon'") || detail.includes('No module named "polygon"')) {
      throw new Error(`polygon-api-client is not installed for ${PYTHON_BIN}. Run: ${PYTHON_BIN} -m pip install polygon-api-client`);
    }

    if (detail.includes("NO_MACRO_AGG")) {
      throw new Error(`No recent Polygon daily close returned for ${ticker}`);
    }

    throw new Error(detail);
  }
}

async function resolveCoinGeckoId(symbol, coinIdCache) {
  const normalized = String(symbol || "").toUpperCase();
  if (coinIdCache.has(normalized)) return coinIdCache.get(normalized);

  if (COINGECKO_SYMBOL_MAP[normalized]) {
    coinIdCache.set(normalized, COINGECKO_SYMBOL_MAP[normalized]);
    return COINGECKO_SYMBOL_MAP[normalized];
  }

  const payload = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(normalized)}`);
  const match = Array.isArray(payload.coins)
    ? payload.coins.find((coin) => String(coin.symbol || "").toUpperCase() === normalized)
    : null;

  if (!match?.id) {
    throw new Error(`CoinGecko could not resolve symbol ${normalized}`);
  }

  coinIdCache.set(normalized, match.id);
  return match.id;
}

async function fetchBinanceT1Close(symbol, currency, binanceCache) {
  const base = String(symbol || "").toUpperCase();
  const quote = String(currency || "").toUpperCase();

  if (!BINANCE_DIRECT_QUOTES.has(quote)) {
    return null;
  }

  const candidates = [quote, ...BINANCE_QUOTE_PRIORITY.filter((item) => item !== quote)];

  for (const candidateQuote of candidates) {
    const pair = `${base}${candidateQuote}`;
    if (binanceCache.has(pair)) {
      const cached = binanceCache.get(pair);
      if (cached != null) return { price: cached, quoteCurrency: candidateQuote };
      continue;
    }

    try {
      const payload = await fetchJson(
        `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&limit=2`
      );

      if (!Array.isArray(payload) || payload.length === 0) {
        binanceCache.set(pair, null);
        continue;
      }

      const lastClosedCandle = payload.length >= 2 ? payload[payload.length - 2] : payload[payload.length - 1];
      const close = Array.isArray(lastClosedCandle) ? parseNumber(lastClosedCandle[4]) : null;
      if (close == null) {
        binanceCache.set(pair, null);
        continue;
      }

      binanceCache.set(pair, close);
      return { price: close, quoteCurrency: candidateQuote };
    } catch {
      binanceCache.set(pair, null);
    }
  }

  return null;
}

async function fetchCcxtCryptoPrice(symbol, currency, cryptoExchangeCache) {
  const base = String(symbol || "").trim().toUpperCase();
  const quote = String(currency || "").trim().toUpperCase();
  if (!base || !quote) {
    throw new Error("Missing crypto symbol or currency");
  }

  const candidates = BINANCE_DIRECT_QUOTES.has(quote)
    ? [quote, ...CCXT_FALLBACK_QUOTES.filter((item) => item !== quote)]
    : [...CCXT_FALLBACK_QUOTES];

  const script = `
import json
import sys
import ccxt
from datetime import datetime, timedelta

symbol = sys.argv[1]
proxy = sys.argv[2] if len(sys.argv) > 2 else ""
timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 30000

config = {
    "enableRateLimit": True,
    "timeout": timeout,
}
if proxy:
    config["proxies"] = {
        "http": proxy,
        "https": proxy,
    }

exchange = ccxt.binance(config)
yesterday = datetime.now() - timedelta(days=1)
since = int(yesterday.timestamp() * 1000)
ohlcv = exchange.fetch_ohlcv(symbol, timeframe="1d", since=since, limit=1)

if not ohlcv:
    raise SystemExit("NO_CCXT_CANDLES")

timestamp, _open, _high, _low, close, _volume = ohlcv[0]
if close is None:
    raise SystemExit("NO_CCXT_CLOSE")

print(json.dumps({"timestamp": timestamp, "close": float(close)}, ensure_ascii=True))
  `.trim();

  for (const candidateQuote of candidates) {
    const pair = `${base}/${candidateQuote}`;
    if (cryptoExchangeCache.has(pair)) {
      const cached = cryptoExchangeCache.get(pair);
      if (cached != null) return cached;
      continue;
    }

    try {
      const { stdout } = await execFileAsync(
        PYTHON_BIN,
        ["-c", script, pair, CRYPTO_PROXY_URL, String(CRYPTO_CCXT_TIMEOUT_MS)],
        { timeout: CRYPTO_CCXT_TIMEOUT_MS + 10000, maxBuffer: 1024 * 1024 }
      );
      const payload = JSON.parse(String(stdout || "").trim());
      const price = parseNumber(payload.close);
      if (price == null) {
        throw new Error("No ccxt crypto close price returned");
      }
      const result = { price, quoteCurrency: candidateQuote };
      cryptoExchangeCache.set(pair, result);
      return result;
    } catch (error) {
      const stderr = String(error.stderr || "").trim();
      const stdout = String(error.stdout || "").trim();
      const detail = stderr || stdout || error.message;

      if (detail.includes("No module named 'ccxt'") || detail.includes('No module named "ccxt"')) {
        throw new Error(`ccxt is not installed for ${PYTHON_BIN}. Run: ${PYTHON_BIN} -m pip install ccxt`);
      }
      if (detail.includes("NO_CCXT_CANDLES") || detail.includes("NO_CCXT_CLOSE")) {
        cryptoExchangeCache.set(pair, null);
        continue;
      }
      if (CRYPTO_PROXY_URL && (detail.includes("RequestTimeout") || detail.includes("NetworkError") || detail.includes("Proxy"))) {
        cryptoExchangeCache.set(pair, null);
        continue;
      }

      cryptoExchangeCache.set(pair, null);
      continue;
    }
  }

  throw new Error(`No recent ccxt daily close returned for ${base} with supported Binance quotes`);
}

async function fetchCryptoPrice(holding, cryptoCache, coinIdCache) {
  const key = `${holding.symbol}:${holding.currency}`;
  if (cryptoCache.has(key)) return cryptoCache.get(key);

  const currency = String(holding.currency || "").toLowerCase();
  const supportedVs = ["usd", "hkd", "krw", "usdt", "usdc"];
  const vsCurrency = supportedVs.includes(currency) ? currency : "usd";
  const coinId = await resolveCoinGeckoId(holding.symbol, coinIdCache);
  const targetDate = getYesterdayDateString();
  const payload = await fetchJson(
    `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${toCoinGeckoDate(targetDate)}&localization=false`
  );

  const price = parseNumber(payload.market_data?.current_price?.[vsCurrency]);
  if (price == null) {
    throw new Error(`No T-1 crypto price returned for ${holding.symbol}/${holding.currency}`);
  }

  cryptoCache.set(key, price);
  return price;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    [createId(), userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

async function getAuthenticatedUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const tokenHash = sha256(token);
  const [rows] = await pool.query(
    `SELECT users.id, users.username, users.invite_code, users.invited_by, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return rows[0] ? mapUser(rows[0]) : null;
}

async function revokeSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
  }
  clearSessionCookie(res);
}

async function authMiddleware(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function refreshMarketPrices(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
    [userId]
  );
  const holdings = rows.map(mapRow);
  const warningSet = new Set();
  let updatedCount = 0;
  const todayDate = getCurrentDateString();

  if (!holdings.length) {
    return {
      updatedCount,
      warnings: [],
      refreshedAt: new Date().toISOString(),
    };
  }

  const stockCache = new Map();
  const cryptoCache = new Map();
  const coinIdCache = new Map();
  const binanceCache = new Map();
  const cryptoExchangeCache = new Map();
  const fxCache = new Map();
  const optionCache = new Map();
  const macroCache = new Map();

  if (!EODHD_API_KEY) {
    warningSet.add("未配置 EODHD_API_KEY，美股和部分汇率将继续使用数据库中的现有价格。");
  }

  for (const holding of holdings) {
    if (holding.lastPriceSyncDate === todayDate) {
      continue;
    }

    if (holding.assetType === "cash") {
      try {
        if (!MANUAL_FX_CURRENCIES.has(holding.currency) && EODHD_API_KEY) {
          const fxRate = await fetchUsdFxRate(holding.currency, fxCache);
          await pool.query(
            "UPDATE holdings SET fx_rate = ?, last_price_sync_date = ?, last_price_sync_status = ?, last_price_sync_error = NULL WHERE id = ? AND user_id = ?",
            [fxRate, todayDate, "synced", holding.id, userId]
          );
          updatedCount += 1;
        } else if (!MANUAL_FX_CURRENCIES.has(holding.currency) && !EODHD_API_KEY) {
          warningSet.add(`现金 ${holding.symbol} 汇率未更新：缺少 EODHD_API_KEY。`);
        }
      } catch (error) {
        warningSet.add(`现金 ${holding.symbol} 汇率未更新：${error.message}`);
      }
      continue;
    }

    try {
      let latestPrice = null;
      let latestPriceQuoteCurrency = holding.currency;

      if (holding.assetType === "stock") {
        if (holding.market === "US" && !EODHD_API_KEY) {
          warningSet.add(`${holding.symbol} 未更新：缺少 EODHD_API_KEY。`);
          continue;
        }
        latestPrice = await fetchStockPrice(holding, stockCache);
      } else if (holding.assetType === "crypto") {
        try {
          const ccxtQuote = await fetchCcxtCryptoPrice(holding.symbol, holding.currency, cryptoExchangeCache);
          latestPrice = ccxtQuote.price;
          latestPriceQuoteCurrency = ccxtQuote.quoteCurrency;
        } catch (error) {
          warningSet.add(`${holding.symbol} ccxt 未更新：${error.message}`);
          const binanceQuote = await fetchBinanceT1Close(holding.symbol, holding.currency, binanceCache);
          if (binanceQuote) {
            latestPrice = binanceQuote.price;
            latestPriceQuoteCurrency = binanceQuote.quoteCurrency;
          } else {
            latestPrice = await fetchCryptoPrice(holding, cryptoCache, coinIdCache);
            latestPriceQuoteCurrency = holding.currency;
          }
        }
      } else if (holding.assetType === "option") {
        latestPrice = await fetchOptionPrice(holding, optionCache);
      } else if (holding.assetType === "macro") {
        latestPrice = await fetchMacroPrice(holding, macroCache);
      }

      if (latestPrice == null) continue;

      let nextFxRate = holding.fxRate;

      if (MANUAL_FX_CURRENCIES.has(holding.currency)) {
        nextFxRate = 1;
      } else {
        try {
          nextFxRate = await fetchUsdFxRate(holding.currency, fxCache);
        } catch (error) {
          warningSet.add(`${holding.symbol} 汇率未更新：${error.message}，已保留原汇率 ${holding.fxRate}`);
        }
      }

      if (
        holding.assetType === "crypto" &&
        latestPrice != null &&
        latestPriceQuoteCurrency !== holding.currency &&
        MANUAL_FX_CURRENCIES.has(latestPriceQuoteCurrency) &&
        !MANUAL_FX_CURRENCIES.has(holding.currency) &&
        nextFxRate > 0
      ) {
        latestPrice = latestPrice / nextFxRate;
      }

      await pool.query(
        "UPDATE holdings SET current_price = ?, fx_rate = ?, last_price_sync_date = ?, last_price_sync_status = ?, last_price_sync_error = NULL WHERE id = ? AND user_id = ?",
        [latestPrice, nextFxRate, todayDate, "synced", holding.id, userId]
      );

      updatedCount += 1;
    } catch (error) {
      await pool.query(
        "UPDATE holdings SET last_price_sync_status = ?, last_price_sync_error = ? WHERE id = ? AND user_id = ?",
        ["failed", String(error.message || "Unknown sync error").slice(0, 500), holding.id, userId]
      );
      warningSet.add(`${holding.symbol} 未更新：${error.message}`);
    }
  }

  return {
    updatedCount,
    warnings: [...warningSet],
    refreshedAt: new Date().toISOString(),
  };
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      username VARCHAR(120) NOT NULL UNIQUE,
      invite_code VARCHAR(32) NULL UNIQUE,
      invited_by VARCHAR(64) NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_user_id (user_id),
      INDEX idx_sessions_expires_at (expires_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS holdings (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NULL,
      asset_type VARCHAR(20) NOT NULL,
      position_side VARCHAR(20) NOT NULL DEFAULT 'long',
      platform VARCHAR(50) NOT NULL,
      market VARCHAR(20) NOT NULL,
      symbol VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      quantity DECIMAL(20,8) NOT NULL DEFAULT 0,
      cost_price DECIMAL(20,8) NOT NULL DEFAULT 0,
      current_price DECIMAL(20,8) NOT NULL DEFAULT 0,
      fx_rate DECIMAL(20,8) NOT NULL DEFAULT 1,
      target_allocation DECIMAL(10,4) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      underlying VARCHAR(64) NULL,
      option_type VARCHAR(20) NULL,
      strike_price DECIMAL(20,8) NULL,
      expiry_date DATE NULL,
      contract_multiplier INT NOT NULL DEFAULT 1,
      last_price_sync_date DATE NULL,
      last_price_sync_status VARCHAR(20) NULL,
      last_price_sync_error VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [userIdColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'user_id'`,
    [DB_NAME]
  );

  if (Number(userIdColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN user_id VARCHAR(64) NULL");
  }

  const [lastPriceSyncDateColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'last_price_sync_date'`,
    [DB_NAME]
  );

  if (Number(lastPriceSyncDateColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN last_price_sync_date DATE NULL");
  }

  const [lastPriceSyncStatusColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'last_price_sync_status'`,
    [DB_NAME]
  );

  if (Number(lastPriceSyncStatusColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN last_price_sync_status VARCHAR(20) NULL");
  }

  const [lastPriceSyncErrorColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'last_price_sync_error'`,
    [DB_NAME]
  );

  if (Number(lastPriceSyncErrorColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN last_price_sync_error VARCHAR(500) NULL");
  }

  const [holdingIndexes] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND INDEX_NAME = 'idx_holdings_user_id'`,
    [DB_NAME]
  );

  if (Number(holdingIndexes[0]?.count || 0) === 0) {
    await pool.query("CREATE INDEX idx_holdings_user_id ON holdings (user_id)");
  }

  const [inviteCodeColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'invite_code'`,
    [DB_NAME]
  );

  if (Number(inviteCodeColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE users ADD COLUMN invite_code VARCHAR(32) NULL UNIQUE");
  }

  const [invitedByColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'invited_by'`,
    [DB_NAME]
  );

  if (Number(invitedByColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE users ADD COLUMN invited_by VARCHAR(64) NULL");
  }

  const [usersWithoutInvite] = await pool.query(
    "SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ''"
  );

  for (const user of usersWithoutInvite) {
    let assigned = false;
    while (!assigned) {
      try {
        await pool.query("UPDATE users SET invite_code = ? WHERE id = ?", [createInviteCode(), user.id]);
        assigned = true;
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") throw error;
      }
    }
  }

  await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
}

app.get("/", (_req, res) => {
  renderPage(res, "home", "/");
});

app.get("/stocks", (_req, res) => {
  renderPage(res, "stocks", "/stocks");
});

app.get("/stocks/bank-cards", (_req, res) => {
  renderPage(res, "stocks-bank-cards", "/stocks/bank-cards");
});

app.get("/stocks/brokers", (_req, res) => {
  renderPage(res, "stocks-brokers", "/stocks/brokers");
});

app.get("/stocks/bank-funding", (_req, res) => {
  renderPage(res, "stocks-bank-funding", "/stocks/bank-funding");
});

app.get("/stocks/broker-funding", (_req, res) => {
  renderPage(res, "stocks-broker-funding", "/stocks/broker-funding");
});

app.get("/stocks/withdrawal", (_req, res) => {
  renderPage(res, "stocks-withdrawal", "/stocks/withdrawal");
});

app.get("/stocks/spending", (_req, res) => {
  renderPage(res, "stocks-spending", "/stocks/spending");
});

app.get("/crypto", (_req, res) => {
  renderPage(res, "crypto", "/crypto");
});

app.get("/crypto/accounts", (_req, res) => {
  renderPage(res, "crypto-accounts", "/crypto/accounts");
});

app.get("/crypto/funding", (_req, res) => {
  renderPage(res, "crypto-funding", "/crypto/funding");
});

app.get("/crypto/withdrawal", (_req, res) => {
  renderPage(res, "crypto-withdrawal", "/crypto/withdrawal");
});

app.get("/crypto/spending", (_req, res) => {
  renderPage(res, "crypto-spending", "/crypto/spending");
});

app.get("/crypto/onchain", (_req, res) => {
  renderPage(res, "crypto-onchain", "/crypto/onchain");
});

app.get("/crypto/onchain-us-stocks", (_req, res) => {
  renderPage(res, "crypto-onchain-us-stocks", "/crypto/onchain-us-stocks");
});

app.get("/sim", (_req, res) => {
  renderPage(res, "sim", "/sim");
});

app.get("/sim/hk", (_req, res) => {
  renderPage(res, "sim-hk", "/sim/hk");
});

app.get("/sim/us", (_req, res) => {
  renderPage(res, "sim-us", "/sim/us");
});

app.get("/portfolio", (_req, res) => {
  renderPage(res, "portfolio", "/portfolio");
});

app.get("/index.html", (_req, res) => res.redirect(302, "/"));
app.get("/offshore", (_req, res) => res.redirect(302, "/"));
app.get("/offshore/stocks", (_req, res) => res.redirect(302, "/stocks"));
app.get("/offshore/stocks/bank-cards", (_req, res) => res.redirect(302, "/stocks/bank-cards"));
app.get("/offshore/stocks/brokers", (_req, res) => res.redirect(302, "/stocks/brokers"));
app.get("/offshore/stocks/bank-funding", (_req, res) => res.redirect(302, "/stocks/bank-funding"));
app.get("/offshore/stocks/broker-funding", (_req, res) => res.redirect(302, "/stocks/broker-funding"));
app.get("/offshore/stocks/withdrawal", (_req, res) => res.redirect(302, "/stocks/withdrawal"));
app.get("/offshore/stocks/spending", (_req, res) => res.redirect(302, "/stocks/spending"));
app.get("/offshore/crypto", (_req, res) => res.redirect(302, "/crypto"));
app.get("/offshore/crypto/accounts", (_req, res) => res.redirect(302, "/crypto/accounts"));
app.get("/offshore/crypto/funding", (_req, res) => res.redirect(302, "/crypto/funding"));
app.get("/offshore/crypto/withdrawal", (_req, res) => res.redirect(302, "/crypto/withdrawal"));
app.get("/offshore/crypto/spending", (_req, res) => res.redirect(302, "/crypto/spending"));
app.get("/offshore/crypto/onchain", (_req, res) => res.redirect(302, "/crypto/onchain"));
app.get("/offshore/crypto/onchain-us-stocks", (_req, res) => res.redirect(302, "/crypto/onchain-us-stocks"));
app.get("/stocks/accounts", (_req, res) => res.redirect(302, "/stocks/bank-cards"));
app.get("/stocks/allocation", (_req, res) => res.redirect(302, "/stocks/brokers"));
app.get("/stocks/monitoring", (_req, res) => res.redirect(302, "/stocks/broker-funding"));
app.get("/crypto/fiat", (_req, res) => res.redirect(302, "/crypto/funding"));
app.get("/crypto/wallets", (_req, res) => res.redirect(302, "/crypto/accounts"));
app.get("/stocks.html", (_req, res) => res.redirect(302, "/stocks"));
app.get("/stocks-accounts.html", (_req, res) => res.redirect(302, "/stocks/bank-cards"));
app.get("/stocks-allocation.html", (_req, res) => res.redirect(302, "/stocks/brokers"));
app.get("/stocks-monitoring.html", (_req, res) => res.redirect(302, "/stocks/broker-funding"));
app.get("/crypto.html", (_req, res) => res.redirect(302, "/crypto"));
app.get("/crypto-fiat.html", (_req, res) => res.redirect(302, "/crypto/funding"));
app.get("/crypto-wallets.html", (_req, res) => res.redirect(302, "/crypto/accounts"));
app.get("/crypto-onchain.html", (_req, res) => res.redirect(302, "/crypto/onchain"));
app.get("/portfolio.html", (_req, res) => res.redirect(302, "/portfolio"));

app.use(express.static(path.join(__dirname), { index: false, redirect: false }));

app.get("/api/health", async (_req, res) => {
  try {
    if (!databaseReady) {
      return res.json({ ok: true, databaseReady: false, host: HOST, port: PORT, lanAddresses: getLanAddresses() });
    }

    await pool.query("SELECT 1");
    res.json({ ok: true, databaseReady: true, host: HOST, port: PORT, lanAddresses: getLanAddresses() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/config/public", (_req, res) => {
  const inviteRequired = true;
  res.json({
    inviteRequired,
    bootstrapInviteEnabled: Boolean(INVITE_CODE),
    host: HOST,
    port: PORT,
    lanAddresses: getLanAddresses(),
  });
});

app.get("/api/auth/session", requireDatabase, async (req, res) => {
  const user = await getAuthenticatedUser(req);
  res.json({ user });
});

async function registerOrLogin(req, res, { allowAutoLogin = false } = {}) {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const inviteCode = String(req.body.inviteCode || "").trim();

  if (!username || password.length < 6) {
    return res.status(400).json({ error: "用户名不能为空，密码至少 6 位。" });
  }

  if (allowAutoLogin) {
    const [existingRows] = await pool.query("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
    const existingUser = existingRows[0];

    if (existingUser) {
      if (!verifyPassword(password, existingUser.password_hash)) {
        return res.status(401).json({ error: "用户名或密码不正确。" });
      }

      const { token, expiresAt } = await createSession(existingUser.id);
      setSessionCookie(res, token, expiresAt);
      return res.json({ mode: "login", user: mapUser(existingUser) });
    }
  }

  const [countRows] = await pool.query("SELECT COUNT(*) AS count FROM users");
  const isFirstUser = Number(countRows[0]?.count || 0) === 0;

  let inviterUserId = null;
  const usingBootstrapInvite = Boolean(INVITE_CODE) && inviteCode === INVITE_CODE;

  if (isFirstUser) {
    if (INVITE_CODE && !usingBootstrapInvite) {
      return res.status(403).json({ error: "首个账户注册需要填写配置中的邀请码。" });
    }
  } else {
    if (usingBootstrapInvite) {
      inviterUserId = null;
    } else {
      const [inviterRows] = await pool.query(
        "SELECT id FROM users WHERE invite_code = ? LIMIT 1",
        [inviteCode]
      );
      inviterUserId = inviterRows[0]?.id || null;
      if (!inviterUserId) {
        return res.status(403).json({ error: "邀请码不正确。" });
      }
    }
  }

  try {
    const userId = createId();
    let personalInviteCode = "";

    while (!personalInviteCode) {
      const candidate = createInviteCode();
      const [existingInviteRows] = await pool.query(
        "SELECT id FROM users WHERE invite_code = ? LIMIT 1",
        [candidate]
      );
      if (!existingInviteRows.length) {
        personalInviteCode = candidate;
      }
    }

    await pool.query(
      "INSERT INTO users (id, username, invite_code, invited_by, password_hash) VALUES (?, ?, ?, ?, ?)",
      [userId, username, personalInviteCode, inviterUserId, hashPassword(password)]
    );

    if (isFirstUser) {
      await pool.query("UPDATE holdings SET user_id = ? WHERE user_id IS NULL", [userId]);
    }

    const { token, expiresAt } = await createSession(userId);
    setSessionCookie(res, token, expiresAt);

    res.status(201).json({
      mode: "register",
      user: {
        id: userId,
        username,
        inviteCode: personalInviteCode,
        invitedBy: inviterUserId,
      },
      claimedLegacyData: isFirstUser,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "该用户名已存在。" });
    }
    res.status(400).json({ error: error.message });
  }
}

app.post("/api/auth/entry", requireDatabase, async (req, res) => {
  await registerOrLogin(req, res, { allowAutoLogin: true });
});

app.post("/api/auth/register", requireDatabase, async (req, res) => {
  await registerOrLogin(req, res, { allowAutoLogin: false });
});

app.post("/api/auth/login", requireDatabase, async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");

  const [rows] = await pool.query("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
  const userRow = rows[0];

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    return res.status(401).json({ error: "用户名或密码不正确。" });
  }

  const { token, expiresAt } = await createSession(userRow.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ user: mapUser(userRow) });
});

app.post("/api/auth/logout", requireDatabase, async (req, res) => {
  await revokeSession(req, res);
  res.status(204).end();
});

app.get("/api/holdings", requireDatabase, authMiddleware, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
    [req.user.id]
  );
  res.json(rows.map(mapRow));
});

app.post("/api/prices/refresh", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const result = await refreshMarketPrices(req.user.id);
    const [rows] = await pool.query(
      "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
      [req.user.id]
    );
    res.json({
      ...result,
      holdings: rows.map(mapRow),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Price refresh failed" });
  }
});

app.post("/api/holdings", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const holding = normalizeHolding(req.body);
    await pool.query(
      `INSERT INTO holdings (
        id, user_id, asset_type, position_side, platform, market, symbol, name, currency,
        quantity, cost_price, current_price, fx_rate, target_allocation, notes,
        underlying, option_type, strike_price, expiry_date, contract_multiplier
      ) VALUES (
        :id, :userId, :assetType, :positionSide, :platform, :market, :symbol, :name, :currency,
        :quantity, :costPrice, :currentPrice, :fxRate, :targetAllocation, :notes,
        :underlying, :optionType, :strikePrice, :expiryDate, :contractMultiplier
      )`,
      { ...holding, userId: req.user.id }
    );
    res.status(201).json(holding);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/holdings/:id", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const holding = normalizeHolding({ ...req.body, id: req.params.id });
    const [result] = await pool.query(
      `UPDATE holdings SET
        asset_type = :assetType,
        position_side = :positionSide,
        platform = :platform,
        market = :market,
        symbol = :symbol,
        name = :name,
        currency = :currency,
        quantity = :quantity,
        cost_price = :costPrice,
        current_price = :currentPrice,
        fx_rate = :fxRate,
        target_allocation = :targetAllocation,
        notes = :notes,
        underlying = :underlying,
        option_type = :optionType,
        strike_price = :strikePrice,
        expiry_date = :expiryDate,
        contract_multiplier = :contractMultiplier
      WHERE id = :id AND user_id = :userId`,
      { ...holding, userId: req.user.id }
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Holding not found" });
    }

    res.json(holding);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/holdings/:id", requireDatabase, authMiddleware, async (req, res) => {
  const [result] = await pool.query("DELETE FROM holdings WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "Holding not found" });
  }
  res.status(204).end();
});

app.post("/api/holdings/import", requireDatabase, authMiddleware, async (req, res) => {
  const incoming = Array.isArray(req.body) ? req.body : [];

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("DELETE FROM holdings WHERE user_id = ?", [req.user.id]);

      for (const raw of incoming) {
        const holding = normalizeHolding(raw);
        await connection.query(
          `INSERT INTO holdings (
            id, user_id, asset_type, position_side, platform, market, symbol, name, currency,
            quantity, cost_price, current_price, fx_rate, target_allocation, notes,
            underlying, option_type, strike_price, expiry_date, contract_multiplier
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            holding.id,
            req.user.id,
            holding.assetType,
            holding.positionSide,
            holding.platform,
            holding.market,
            holding.symbol,
            holding.name,
            holding.currency,
            holding.quantity,
            holding.costPrice,
            holding.currentPrice,
            holding.fxRate,
            holding.targetAllocation,
            holding.notes,
            holding.underlying,
            holding.optionType,
            holding.strikePrice,
            holding.expiryDate,
            holding.contractMultiplier,
          ]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [rows] = await pool.query(
      "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
      [req.user.id]
    );
    res.json(rows.map(mapRow));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message || "Internal server error" });
});

Promise.resolve()
  .then(async () => {
    try {
      await ensureSchema();
      databaseReady = true;
      console.log("Database schema ready.");
    } catch (error) {
      databaseReady = false;
      console.warn(`Database unavailable, starting content site only: ${error.message}`);
    }

    app.listen(PORT, HOST, () => {
      const lanAddresses = getLanAddresses();
      console.log(`Server running at http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
      if (HOST === "0.0.0.0" && lanAddresses.length) {
        console.log(`LAN access: ${lanAddresses.map((address) => `http://${address}:${PORT}`).join(", ")}`);
      }
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
