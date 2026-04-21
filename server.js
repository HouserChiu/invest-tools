const express = require("express");
const mysql = require("mysql2/promise");
const { marked } = require("marked");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile(".env");
loadEnvFile(".env.example");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "zhao6776423";
const DB_NAME = process.env.DB_NAME || "investment_dashboard";
const QUOTE_PROXY_URL = process.env.QUOTE_PROXY_URL || "http://127.0.0.1:8000";
const SESSION_COOKIE_NAME = "investment_session";
const SESSION_TTL_DAYS = 30;
const CONTENT_FILES = [
  path.join(__dirname, "data", "site.json"),
  path.join(__dirname, "data", "home.json"),
  path.join(__dirname, "data", "stocks.json"),
  path.join(__dirname, "data", "crypto.json"),
  path.join(__dirname, "data", "sim.json"),
  path.join(__dirname, "data", "portfolio.json"),
];

const app = express();
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
    userId: row.user_id || null,
    portfolioId: row.portfolio_id || null,
    accountId: row.account_id || null,
    instrumentId: row.instrument_id || null,
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
    status: row.status || "OPEN",
    openedAt: row.opened_at || null,
    closedAt: row.closed_at || null,
    bookCostTotal: Number(row.book_cost_total || 0),
    realizedPnlTotal: Number(row.realized_pnl_total || 0),
    lastPriceSyncDate: toDateOnly(row.last_price_sync_date),
    lastPriceSyncStatus: row.last_price_sync_status || "",
    lastPriceSyncError: row.last_price_sync_error || "",
  };
}

function mapTransactionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    portfolioId: row.portfolio_id,
    accountId: row.account_id,
    accountName: row.account_name || "",
    instrumentId: row.instrument_id || null,
    holdingId: row.holding_id || null,
    transactionType: row.transaction_type,
    side: row.side || "",
    tradeDate: toDateOnly(row.trade_date),
    settleDate: toDateOnly(row.settle_date),
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    grossAmount: Number(row.gross_amount || 0),
    feeAmount: Number(row.fee_amount || 0),
    taxAmount: Number(row.tax_amount || 0),
    netAmount: Number(row.net_amount || 0),
    tradeCurrency: row.trade_currency || "",
    fxRateToUsd: Number(row.fx_rate_to_usd || 1),
    realizedPnlAmount: Number(row.realized_pnl_amount || 0),
    notes: row.notes || "",
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
    metadataJson: row.metadata_json || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assetType: row.asset_type || "",
    platform: row.platform || "",
    market: row.market || "",
    symbol: row.symbol || "",
    name: row.name || "",
  };
}

function mapRealizedPnlRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    portfolioId: row.portfolio_id,
    accountId: row.account_id,
    accountName: row.account_name || "",
    instrumentId: row.instrument_id || null,
    holdingId: row.holding_id || null,
    openTransactionId: row.open_transaction_id || null,
    closeTransactionId: row.close_transaction_id || null,
    lotId: row.lot_id || null,
    recognizedDate: toDateOnly(row.recognized_date),
    quantityClosed: Number(row.quantity_closed || 0),
    proceedsAmount: Number(row.proceeds_amount || 0),
    costAmount: Number(row.cost_amount || 0),
    feeAmount: Number(row.fee_amount || 0),
    taxAmount: Number(row.tax_amount || 0),
    realizedPnlAmount: Number(row.realized_pnl_amount || 0),
    realizedPnlUsd: Number(row.realized_pnl_usd || 0),
    tradeCurrency: row.trade_currency || "",
    notes: row.notes || "",
    assetType: row.asset_type || "",
    platform: row.platform || "",
    market: row.market || "",
    symbol: row.symbol || "",
    name: row.name || "",
  };
}

function computeHoldingMetricsBase(holding) {
  const quantity = Number(holding.quantity || 0);
  const costPrice = Number(holding.costPrice || 0);
  const currentPrice = Number(holding.currentPrice || 0);
  const fxRate = Number(holding.fxRate || 1) || 1;
  const contractMultiplier = Number(holding.contractMultiplier || 1) || 1;

  if (holding.assetType === "cash") {
    const marketValueUsd = quantity * fxRate;
    return {
      costValueUsd: marketValueUsd,
      marketValueUsd,
      pnlUsd: 0,
    };
  }

  if (holding.assetType === "option") {
    const grossCost = quantity * costPrice * contractMultiplier * fxRate;
    const grossMark = quantity * currentPrice * contractMultiplier * fxRate;
    const isShort = holding.positionSide === "short";
    return {
      costValueUsd: grossCost,
      marketValueUsd: isShort ? -grossMark : grossMark,
      pnlUsd: isShort ? grossCost - grossMark : grossMark - grossCost,
    };
  }

  const costValueUsd = quantity * costPrice * fxRate;
  const marketValueUsd = quantity * currentPrice * fxRate;
  return {
    costValueUsd,
    marketValueUsd,
    pnlUsd: marketValueUsd - costValueUsd,
  };
}

async function ensureNavSnapshotsForToday(userId) {
  const today = getCurrentDateString();
  const [holdingRows] = await pool.query(
    "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
    [userId]
  );
  const holdings = holdingRows.map(mapRow);
  const [realizedRows] = await pool.query(
    `SELECT portfolio_id, COALESCE(SUM(realized_pnl_usd), 0) AS realized_total
     FROM realized_pnl_ledger
     WHERE user_id = ?
     GROUP BY portfolio_id`,
    [userId]
  );
  const realizedByPortfolio = new Map(realizedRows.map((row) => [row.portfolio_id, Number(row.realized_total || 0)]));

  const byPortfolio = new Map();
  holdings.forEach((holding) => {
    const key = holding.portfolioId || "default";
    const metrics = computeHoldingMetricsBase(holding);
    const entry = byPortfolio.get(key) || {
      userId,
      portfolioId: holding.portfolioId,
      snapshotDate: today,
      navUsd: 0,
      cashUsd: 0,
      marketValueUsd: 0,
      unrealizedPnlUsd: 0,
      realizedPnlUsd: realizedByPortfolio.get(holding.portfolioId) || 0,
      totalPnlUsd: 0,
    };
    entry.navUsd += metrics.marketValueUsd;
    entry.marketValueUsd += metrics.marketValueUsd;
    entry.unrealizedPnlUsd += metrics.pnlUsd;
    if (holding.assetType === "cash") {
      entry.cashUsd += metrics.marketValueUsd;
    }
    byPortfolio.set(key, entry);
  });

  for (const entry of byPortfolio.values()) {
    entry.totalPnlUsd = entry.realizedPnlUsd + entry.unrealizedPnlUsd;
    await pool.query(
      `INSERT INTO nav_snapshots (
        id, user_id, portfolio_id, snapshot_date,
        nav_usd, cash_usd, market_value_usd, unrealized_pnl_usd, realized_pnl_usd, total_pnl_usd,
        deposit_flow_usd, withdrawal_flow_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      ON DUPLICATE KEY UPDATE
        nav_usd = VALUES(nav_usd),
        cash_usd = VALUES(cash_usd),
        market_value_usd = VALUES(market_value_usd),
        unrealized_pnl_usd = VALUES(unrealized_pnl_usd),
        realized_pnl_usd = VALUES(realized_pnl_usd),
        total_pnl_usd = VALUES(total_pnl_usd)`,
      [
        createId(),
        entry.userId,
        entry.portfolioId,
        entry.snapshotDate,
        entry.navUsd,
        entry.cashUsd,
        entry.marketValueUsd,
        entry.unrealizedPnlUsd,
        entry.realizedPnlUsd,
        entry.totalPnlUsd,
      ]
    );
  }
}

async function buildReviewMetrics(userId) {
  const [holdingRows] = await pool.query(
    "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
    [userId]
  );
  const holdings = holdingRows.map(mapRow);
  const [realizedRows] = await pool.query(
    `SELECT close_transaction_id, COALESCE(SUM(realized_pnl_usd), 0) AS realized_total
     FROM realized_pnl_ledger
     WHERE user_id = ?
     GROUP BY close_transaction_id`,
    [userId]
  );
  const [bestWorstRows] = await pool.query(
    `SELECT
       r.close_transaction_id,
       COALESCE(h.symbol, i.symbol) AS symbol,
       COALESCE(h.platform, a.platform) AS platform,
       MAX(r.recognized_date) AS recognized_date,
       COALESCE(SUM(r.realized_pnl_usd), 0) AS realized_total
     FROM realized_pnl_ledger r
     LEFT JOIN holdings h ON h.id = r.holding_id
     LEFT JOIN instruments i ON i.id = r.instrument_id
     LEFT JOIN accounts a ON a.id = r.account_id
     WHERE r.user_id = ?
     GROUP BY r.close_transaction_id, COALESCE(h.symbol, i.symbol), COALESCE(h.platform, a.platform)`,
    [userId]
  );

  let totalNavUsd = 0;
  let totalCostUsd = 0;
  let unrealizedPnlUsd = 0;
  let currentCashUsd = 0;
  const platformCount = new Set();

  holdings.forEach((holding) => {
    const metrics = computeHoldingMetricsBase(holding);
    totalNavUsd += metrics.marketValueUsd;
    totalCostUsd += metrics.costValueUsd;
    unrealizedPnlUsd += metrics.pnlUsd;
    platformCount.add(holding.platform);
    if (holding.assetType === "cash") {
      currentCashUsd += metrics.marketValueUsd;
    }
  });

  const tradePnls = realizedRows.map((row) => Number(row.realized_total || 0));
  const realizedPnlUsd = tradePnls.reduce((sum, value) => sum + value, 0);
  const winningTrades = tradePnls.filter((value) => value > 0);
  const losingTrades = tradePnls.filter((value) => value < 0);
  const flatTrades = tradePnls.filter((value) => value === 0);
  const closedTrades = tradePnls.length;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;

  const sortedBestWorst = [...bestWorstRows].sort((a, b) => Number(b.realized_total || 0) - Number(a.realized_total || 0));
  const bestTrade = sortedBestWorst[0]
    ? {
        symbol: sortedBestWorst[0].symbol || "",
        platform: sortedBestWorst[0].platform || "",
        recognizedDate: toDateOnly(sortedBestWorst[0].recognized_date),
        realizedPnlUsd: Number(sortedBestWorst[0].realized_total || 0),
      }
    : null;
  const worstTrade = sortedBestWorst.at(-1)
    ? {
        symbol: sortedBestWorst.at(-1).symbol || "",
        platform: sortedBestWorst.at(-1).platform || "",
        recognizedDate: toDateOnly(sortedBestWorst.at(-1).recognized_date),
        realizedPnlUsd: Number(sortedBestWorst.at(-1).realized_total || 0),
      }
    : null;

  return {
    totalNavUsd,
    totalCostUsd,
    currentCashUsd,
    unrealizedPnlUsd,
    realizedPnlUsd,
    totalPnlUsd,
    closedTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    flatTrades: flatTrades.length,
    winRate: closedTrades > 0 ? (winningTrades.length / closedTrades) * 100 : 0,
    avgWinUsd: winningTrades.length ? winningTrades.reduce((sum, value) => sum + value, 0) / winningTrades.length : 0,
    avgLossUsd: losingTrades.length ? losingTrades.reduce((sum, value) => sum + value, 0) / losingTrades.length : 0,
    platformCount: platformCount.size,
    bestTrade,
    worstTrade,
  };
}

function normalizeNullableText(value) {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || null;
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

async function findOrCreateDefaultPortfolio(userId, db = pool) {
  const [existingRows] = await db.query(
    "SELECT * FROM portfolios WHERE user_id = ? AND is_default = 1 LIMIT 1",
    [userId]
  );

  if (existingRows[0]) {
    return existingRows[0];
  }

  const portfolio = {
    id: createId(),
    userId,
    name: "默认组合",
    baseCurrency: "USD",
    description: "系统为历史持仓自动创建的默认组合",
  };

  await db.query(
    `INSERT INTO portfolios (id, user_id, name, base_currency, description, is_default, status)
     VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE')`,
    [portfolio.id, portfolio.userId, portfolio.name, portfolio.baseCurrency, portfolio.description]
  );

  const [rows] = await db.query("SELECT * FROM portfolios WHERE id = ? LIMIT 1", [portfolio.id]);
  return rows[0];
}

async function findOrCreateLedgerAccount(userId, portfolioId, holding, db = pool) {
  const accountName = `${holding.platform} 账户`;
  const [existingRows] = await db.query(
    `SELECT * FROM accounts
     WHERE user_id = ? AND portfolio_id = ? AND platform = ? AND name = ?
     LIMIT 1`,
    [userId, portfolioId, holding.platform, accountName]
  );

  if (existingRows[0]) {
    return existingRows[0];
  }

  const account = {
    id: createId(),
    userId,
    portfolioId,
    name: accountName,
    platform: holding.platform,
    marketScope: holding.market || null,
    baseCurrency: holding.currency || "USD",
  };

  await db.query(
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

  const [rows] = await db.query("SELECT * FROM accounts WHERE id = ? LIMIT 1", [account.id]);
  return rows[0];
}

async function findOrCreateInstrument(holding, db = pool) {
  const params = [
    holding.assetType,
    holding.market,
    holding.symbol,
    holding.currency,
    normalizeNullableText(holding.underlying),
    normalizeNullableText(holding.optionType),
    holding.strikePrice == null ? null : Number(holding.strikePrice),
    toDateOnly(holding.expiryDate),
  ];

  const [existingRows] = await db.query(
    `SELECT * FROM instruments
     WHERE asset_type = ?
       AND market = ?
       AND symbol = ?
       AND quote_currency = ?
       AND (
         (underlying_symbol IS NULL AND ? IS NULL) OR underlying_symbol = ?
       )
       AND (
         (option_type IS NULL AND ? IS NULL) OR option_type = ?
       )
       AND (
         (strike_price IS NULL AND ? IS NULL) OR strike_price = ?
       )
       AND (
         (expiry_date IS NULL AND ? IS NULL) OR expiry_date = ?
       )
     LIMIT 1`,
    [
      ...params.slice(0, 4),
      params[4], params[4],
      params[5], params[5],
      params[6], params[6],
      params[7], params[7],
    ]
  );

  if (existingRows[0]) {
    return existingRows[0];
  }

  const instrument = {
    id: createId(),
    assetType: holding.assetType,
    market: holding.market,
    symbol: holding.symbol,
    displaySymbol: holding.symbol,
    name: holding.name,
    quoteCurrency: holding.currency,
    underlyingSymbol: normalizeNullableText(holding.underlying),
    optionType: normalizeNullableText(holding.optionType),
    strikePrice: holding.strikePrice == null ? null : Number(holding.strikePrice),
    expiryDate: toDateOnly(holding.expiryDate),
    contractMultiplier: Number(holding.contractMultiplier || 1),
  };

  await db.query(
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

  const [rows] = await db.query("SELECT * FROM instruments WHERE id = ? LIMIT 1", [instrument.id]);
  return rows[0];
}

async function ensureLedgerRefsForHolding(userId, holding, db = pool) {
  const portfolio = await findOrCreateDefaultPortfolio(userId, db);
  const account = await findOrCreateLedgerAccount(userId, portfolio.id, holding, db);
  const instrument = await findOrCreateInstrument(holding, db);

  return {
    portfolioId: portfolio.id,
    accountId: account.id,
    instrumentId: instrument.id,
  };
}

async function findCashHoldingByAccountCurrency(db, userId, accountId, currency) {
  const [rows] = await db.query(
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

  return rows[0] || null;
}

async function findOrCreateCashHoldingForTrade(db, userId, holdingRow) {
  const cashCurrency = String(holdingRow.currency || holdingRow.trade_currency || "").trim().toUpperCase();
  if (!cashCurrency) {
    throw new Error("Cash settlement currency is missing");
  }

  const existing = await findCashHoldingByAccountCurrency(db, userId, holdingRow.account_id, cashCurrency);
  if (existing) {
    return existing;
  }

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
    openedAt,
    closedAt: null,
    bookCostTotal: 0,
    realizedPnlTotal: 0,
  };

  const instrument = await findOrCreateInstrument(cashHolding, db);
  cashHolding.instrumentId = instrument.id;

  await db.query(
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

  const [rows] = await db.query("SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1", [cashHolding.id, userId]);
  return rows[0] || null;
}

async function applyCashBalanceImpact(db, userId, holdingRow, cashDeltaAmount, payload = {}) {
  if (!Number.isFinite(cashDeltaAmount) || cashDeltaAmount === 0) {
    return null;
  }

  const cashHoldingRow = await findOrCreateCashHoldingForTrade(db, userId, holdingRow);
  if (!cashHoldingRow) {
    throw new Error("Cash holding could not be created for this account");
  }

  const cashHolding = mapRow(cashHoldingRow);
  const nextQuantity = Number(cashHolding.quantity || 0) + cashDeltaAmount;
  const nextBookCostTotal = nextQuantity * (Number(cashHolding.fxRate || 1) || 1);
  const nextStatus = nextQuantity === 0 ? "CLOSED" : "OPEN";
  const tradeDate = toDateOnly(payload.tradeDate) || getCurrentDateString();

  const sourceRef =
    String(payload.sourceRef || holdingRow.source_ref || `holding:${holdingRow.id || ""}`).trim() ||
    `holding:${holdingRow.id || ""}`;

  await insertPortfolioTransaction(db, {
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

  await db.query(
    `UPDATE holdings
     SET quantity = ?,
         cost_price = 1,
         current_price = 1,
         status = ?,
         closed_at = CASE WHEN ? = 'CLOSED' THEN NOW() ELSE NULL END,
         book_cost_total = ?,
         fx_rate = ?
     WHERE id = ? AND user_id = ?`,
    [
      nextQuantity,
      nextStatus,
      nextStatus,
      nextBookCostTotal,
      Number(cashHolding.fxRate || 1) || 1,
      cashHolding.id,
      userId,
    ]
  );

  const [rows] = await db.query("SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1", [cashHolding.id, userId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

async function hasMatchingCashSettlement(db, tradeRow) {
  const cashTransactionType = Number(tradeRow.net_amount || 0) >= 0 ? "CASH_INFLOW" : "CASH_OUTFLOW";
  const [rows] = await db.query(
    `SELECT id
     FROM portfolio_transactions
     WHERE user_id = ?
       AND account_id = ?
       AND source_ref = ?
       AND transaction_type = ?
       AND trade_date = ?
       AND trade_currency = ?
       AND ABS(net_amount - ?) < 0.00000001
     LIMIT 1`,
    [
      tradeRow.user_id,
      tradeRow.account_id,
      tradeRow.source_ref,
      cashTransactionType,
      toDateOnly(tradeRow.trade_date),
      tradeRow.trade_currency,
      Number(tradeRow.net_amount || 0),
    ]
  );

  return Boolean(rows[0]);
}

async function backfillHistoricalCashSettlements() {
  const [rows] = await pool.query(
    `SELECT pt.*, h.platform, h.market
     FROM portfolio_transactions pt
     JOIN holdings h ON h.id = pt.holding_id
     WHERE pt.source_type = 'HOLDING_UI'
       AND pt.transaction_type IN ('ADD_POSITION', 'REDUCE_POSITION', 'CLOSE_POSITION')
     ORDER BY pt.trade_date ASC, pt.created_at ASC, pt.id ASC`
  );

  for (const row of rows) {
    const alreadySettled = await hasMatchingCashSettlement(pool, row);
    if (alreadySettled) {
      continue;
    }

    await applyCashBalanceImpact(pool, row.user_id, row, Number(row.net_amount || 0), {
      action:
        row.transaction_type === "ADD_POSITION"
          ? "add"
          : row.transaction_type === "REDUCE_POSITION"
            ? "reduce"
            : "close",
      tradeDate: toDateOnly(row.trade_date),
      sourceRef: row.source_ref,
      notes: "Historical cash settlement backfill",
    });
  }
}

async function backfillTransactionRealizedPnl() {
  const [rows] = await pool.query(
    `SELECT
       pt.id,
       COALESCE(SUM(r.realized_pnl_amount), 0) AS realized_pnl_amount
     FROM portfolio_transactions pt
     JOIN realized_pnl_ledger r ON r.close_transaction_id = pt.id
     WHERE pt.transaction_type IN ('REDUCE_POSITION', 'CLOSE_POSITION')
     GROUP BY pt.id`
  );

  for (const row of rows) {
    await pool.query(
      `UPDATE portfolio_transactions
       SET realized_pnl_amount = ?
       WHERE id = ?`,
      [Number(row.realized_pnl_amount || 0), row.id]
    );
  }
}

async function backfillHoldingClosedAtFromTransactions() {
  const [rows] = await pool.query(
    `SELECT
       h.id AS holding_id,
       MAX(pt.trade_date) AS close_trade_date
     FROM holdings h
     JOIN portfolio_transactions pt
       ON pt.holding_id = h.id
      AND pt.transaction_type = 'CLOSE_POSITION'
     WHERE h.status = 'CLOSED'
     GROUP BY h.id`
  );

  for (const row of rows) {
    const closeTradeDate = toDateOnly(row.close_trade_date);
    if (!closeTradeDate) continue;

    await pool.query(
      `UPDATE holdings
       SET closed_at = ?
       WHERE id = ?`,
      [closeTradeDate, row.holding_id]
    );
  }
}

async function insertPortfolioTransaction(db, payload) {
  const transactionId = payload.id || createId();

  await db.query(
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

async function writeHoldingLedgerTransaction(db, userId, holding, refs, transactionType, previousHolding = null) {
  const quantity = Number(holding.quantity || 0);
  const costPrice = Number(holding.costPrice || 0);
  const grossAmount = computeHoldingBookCost(holding);
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

  return insertPortfolioTransaction(db, {
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
    grossAmount,
    netAmount: grossAmount,
    tradeCurrency: holding.currency,
    fxRateToUsd: Number(holding.fxRate || 1) || 1,
    sourceRef: `holding:${holding.id}`,
    notes: holding.notes || null,
    metadataJson: JSON.stringify(metadata),
  });
}

async function createPositionLot(db, payload) {
  await db.query(
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

async function normalizeOptionUnderlyingAndMergeInstruments() {
  await pool.query(
    `UPDATE holdings
     SET underlying = symbol
     WHERE asset_type = 'option' AND (underlying IS NULL OR TRIM(underlying) = '')`
  );

  const [rows] = await pool.query(
    `SELECT h.id AS holding_id, h.symbol, h.market, h.currency, h.underlying, h.option_type, h.strike_price, h.expiry_date,
            h.instrument_id, i.id AS current_instrument_id, i.underlying_symbol
     FROM holdings h
     LEFT JOIN instruments i ON i.id = h.instrument_id
     WHERE h.asset_type = 'option'`
  );

  for (const row of rows) {
    const canonicalUnderlying = normalizeNullableText(row.underlying) || row.symbol;
    const [canonicalRows] = await pool.query(
      `SELECT id
       FROM instruments
       WHERE asset_type = 'option'
         AND market = ?
         AND symbol = ?
         AND quote_currency = ?
         AND underlying_symbol = ?
         AND option_type = ?
         AND strike_price = ?
         AND expiry_date = ?
       LIMIT 1`,
      [
        row.market || "US",
        row.symbol,
        row.currency || "USD",
        canonicalUnderlying,
        row.option_type,
        Number(row.strike_price || 0),
        toDateOnly(row.expiry_date),
      ]
    );

    let canonicalInstrumentId = canonicalRows[0]?.id || null;

    if (!canonicalInstrumentId && row.current_instrument_id) {
      await pool.query(
        "UPDATE instruments SET underlying_symbol = ? WHERE id = ?",
        [canonicalUnderlying, row.current_instrument_id]
      );
      canonicalInstrumentId = row.current_instrument_id;
    }

    if (canonicalInstrumentId) {
      await pool.query(
        "UPDATE holdings SET underlying = ?, instrument_id = ? WHERE id = ?",
        [canonicalUnderlying, canonicalInstrumentId, row.holding_id]
      );
    }
  }

  await pool.query(
    `DELETE i
     FROM instruments i
     LEFT JOIN holdings h ON h.instrument_id = i.id
     LEFT JOIN portfolio_transactions t ON t.instrument_id = i.id
     LEFT JOIN position_lots l ON l.instrument_id = i.id
     LEFT JOIN realized_pnl_ledger r ON r.instrument_id = i.id
     WHERE i.asset_type = 'option'
       AND i.underlying_symbol IS NULL
       AND h.id IS NULL
       AND t.id IS NULL
       AND l.id IS NULL
       AND r.id IS NULL`
  );
}

async function backfillLedgerReferences() {
  const [users] = await pool.query("SELECT id FROM users");

  for (const user of users) {
    await findOrCreateDefaultPortfolio(user.id);
  }

  const [rows] = await pool.query(
    `SELECT *
     FROM holdings
     WHERE user_id IS NOT NULL
       AND (
         portfolio_id IS NULL OR account_id IS NULL OR instrument_id IS NULL OR
         opened_at IS NULL OR book_cost_total = 0
       )
     ORDER BY created_at ASC`
  );

  for (const row of rows) {
    const holding = mapRow(row);
    const portfolio = await findOrCreateDefaultPortfolio(holding.userId);
    const account = await findOrCreateLedgerAccount(holding.userId, portfolio.id, holding);
    const instrument = await findOrCreateInstrument(holding);
    const quantity = Number(holding.quantity || 0);
    const costPrice = Number(holding.costPrice || 0);
    const fxRate = Number(holding.fxRate || 1) || 1;
    const multiplier = Number(holding.contractMultiplier || 1) || 1;
    const computedBookCost =
      holding.assetType === "cash"
        ? quantity * fxRate
        : quantity * costPrice * multiplier * fxRate;
    const openedAt = holding.openedAt || row.created_at || row.updated_at || new Date();
    const status = quantity === 0 ? "CLOSED" : "OPEN";

    await pool.query(
      `UPDATE holdings
       SET portfolio_id = ?,
           account_id = ?,
           instrument_id = ?,
           status = ?,
           opened_at = COALESCE(opened_at, ?),
           book_cost_total = CASE
             WHEN book_cost_total IS NULL OR book_cost_total = 0 THEN ?
             ELSE book_cost_total
           END
       WHERE id = ?`,
      [
        portfolio.id,
        account.id,
        instrument.id,
        status,
        openedAt,
        computedBookCost,
        holding.id,
      ]
    );
  }
}

async function backfillHoldingOpeningTransactions() {
  const [rows] = await pool.query(
    `SELECT h.*
     FROM holdings h
     LEFT JOIN portfolio_transactions t
       ON t.holding_id = h.id
      AND t.source_type = 'HOLDING_UI'
      AND t.transaction_type = 'OPENING_BALANCE'
     WHERE h.user_id IS NOT NULL
       AND t.id IS NULL
     ORDER BY h.created_at ASC, h.id ASC`
  );

  for (const row of rows) {
    const holding = mapRow(row);
    const refs = {
      portfolioId: row.portfolio_id,
      accountId: row.account_id,
      instrumentId: row.instrument_id,
    };

    if (!refs.portfolioId || !refs.accountId || !refs.instrumentId) {
      continue;
    }

    const openingHolding = {
      ...holding,
      openedAt: holding.openedAt || row.created_at || row.updated_at || new Date(),
      notes: holding.notes || "Historical opening balance backfill",
    };

    await writeHoldingLedgerTransaction(pool, row.user_id, openingHolding, refs, "OPENING_BALANCE");
  }
}

async function backfillOpeningLots() {
  const [rows] = await pool.query(
    `SELECT h.*, t.id AS open_transaction_id
     FROM holdings h
     JOIN portfolio_transactions t
       ON t.holding_id = h.id
      AND t.source_type = 'HOLDING_UI'
      AND t.transaction_type = 'OPENING_BALANCE'
     LEFT JOIN position_lots l
       ON l.holding_id = h.id
      AND l.open_transaction_id = t.id
     WHERE h.user_id IS NOT NULL
       AND h.quantity > 0
       AND l.id IS NULL
     ORDER BY h.created_at ASC, h.id ASC`
  );

  for (const row of rows) {
    const holding = mapRow(row);
    await createPositionLot(pool, {
      userId: row.user_id,
      portfolioId: row.portfolio_id,
      accountId: row.account_id,
      instrumentId: row.instrument_id,
      holdingId: row.id,
      openTransactionId: row.open_transaction_id,
      openDate: toDateOnly(row.opened_at || row.created_at) || getCurrentDateString(),
      lotSide: holding.positionSide === "short" ? "SHORT" : "LONG",
      originalQuantity: Number(row.quantity || 0),
      remainingQuantity: Number(row.quantity || 0),
      openUnitPrice: holding.assetType === "cash" ? 1 : Number(row.cost_price || 0),
      openFxRateToUsd: Number(row.fx_rate || 1) || 1,
      tradeCurrency: row.currency,
      status: "OPEN",
    });
  }
}

function toUsdAmount(amount, fxRate) {
  return Number(amount || 0) * (Number(fxRate || 1) || 1);
}

async function processHoldingTrade(db, userId, holdingRow, payload = {}) {
  const action = String(payload.action || "").trim().toLowerCase();
  if (!["add", "reduce", "close"].includes(action)) {
    throw new Error("action must be add, reduce, or close");
  }

  const holding = mapRow(holdingRow);
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

    const transactionId = await insertPortfolioTransaction(db, {
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

    await createPositionLot(db, {
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

    await db.query(
      `UPDATE holdings
       SET quantity = ?,
           cost_price = ?,
           current_price = ?,
           status = 'OPEN',
           closed_at = NULL,
           book_cost_total = ?,
           notes = COALESCE(?, notes)
       WHERE id = ? AND user_id = ?`,
      [newQuantity, newCostPrice, unitPrice, newBookCostTotal, notes, holding.id, userId]
    );

    const cashHolding = await applyCashBalanceImpact(db, userId, holdingRow, -(grossAmount + feeAmount + taxAmount), {
      action,
      tradeDate,
      notes,
    });
    if (cashHolding) {
      relatedHoldings.push(cashHolding);
    }

    return { action, transactionType: "ADD_POSITION", quantity, unitPrice, relatedHoldings };
  }

  const requestedQuantity =
    action === "close"
      ? Number(holding.quantity || 0)
      : Number(payload.quantity || 0);

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error("quantity must be greater than 0");
  }

  if (requestedQuantity > Number(holding.quantity || 0)) {
    throw new Error("quantity exceeds current holding quantity");
  }

  const [lotRows] = await db.query(
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
  let grossAmount = requestedQuantity * unitPrice * multiplier;
  const closeTransactionType = action === "close" ? "CLOSE_POSITION" : "REDUCE_POSITION";
  const closeTransactionId = await insertPortfolioTransaction(db, {
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
    await db.query(
      `UPDATE position_lots
       SET remaining_quantity = ?,
           status = ?,
           closed_at = CASE WHEN ? = 0 THEN ? ELSE closed_at END
       WHERE id = ?`,
      [newRemaining, newRemaining === 0 ? "CLOSED" : "OPEN", newRemaining, tradeDate, lot.id]
    );

    await db.query(
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

  await db.query(
    `UPDATE holdings
     SET quantity = ?,
         cost_price = ?,
         current_price = ?,
         status = ?,
         closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END,
         book_cost_total = ?,
         realized_pnl_total = ?,
         notes = COALESCE(?, notes)
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

  const cashHolding = await applyCashBalanceImpact(db, userId, holdingRow, grossAmount - feeAmount - taxAmount, {
    action,
    tradeDate,
    notes,
  });
  if (cashHolding) {
    relatedHoldings.push(cashHolding);
  }

  await db.query(
    `UPDATE portfolio_transactions
     SET realized_pnl_amount = ?
     WHERE id = ?`,
    [realizedPnlUsdTotal, closeTransactionId]
  );

  return {
    action,
    transactionType: closeTransactionType,
    quantity: requestedQuantity,
    unitPrice,
    realizedPnlUsd: realizedPnlUsdTotal,
    relatedHoldings,
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.error?.message || payload?.error || payload?.message || "";
    } catch {
      detail = await response.text();
    }
    throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
  }

  return response.json();
}

function normalizeCacheToken(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function buildQuoteCacheKey(holding, requestDate) {
  const isOption = holding.assetType === "option";
  const symbol = isOption ? normalizeCacheToken(holding.underlying || holding.symbol) : normalizeCacheToken(holding.symbol);
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

function normalizeProxyQuoteResult(payload, holding, requestDate) {
  const currentPrice = parseNumber(payload?.currentPrice);
  const quoteCurrency = normalizeCacheToken(payload?.quoteCurrency || holding.currency) || holding.currency;
  const priceDate = toDateOnly(payload?.priceDate) || toDateOnly(requestDate);

  return {
    found: Boolean(payload?.found && currentPrice != null),
    currentPrice,
    quoteCurrency,
    priceDate,
    source: String(payload?.source || "Yahoo Finance proxy").trim(),
    notes: String(payload?.detail || payload?.notes || "").trim(),
  };
}

async function getCachedQuote(holding, requestDate) {
  const cacheKey = buildQuoteCacheKey(holding, requestDate);
  const [rows] = await pool.query(
    "SELECT * FROM market_quotes WHERE cache_key = ? LIMIT 1",
    [cacheKey]
  );
  const row = rows[0];
  if (!row) return null;

  return {
    found: row.current_price != null,
    currentPrice: row.current_price == null ? null : Number(row.current_price),
    quoteCurrency: row.quote_currency || holding.currency,
    priceDate: toDateOnly(row.price_date) || requestDate,
    source: row.source || "MySQL market cache",
    notes: "cache_hit",
    cacheHit: true,
  };
}

async function storeQuoteInCache(holding, requestDate, snapshot) {
  const cacheKey = buildQuoteCacheKey(holding, requestDate);
  await pool.query(
    `INSERT INTO market_quotes (
      cache_key, request_date, asset_type, market, symbol, currency,
      underlying, option_type, strike_price, expiry_date,
      current_price, quote_currency, price_date, source, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      current_price = VALUES(current_price),
      quote_currency = VALUES(quote_currency),
      price_date = VALUES(price_date),
      source = VALUES(source),
      fetched_at = NOW()`,
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
      snapshot.source || "Yahoo Finance proxy",
    ]
  );
}

async function fetchQuoteFromProxy(holding, requestDate) {
  if (holding.assetType === "cash") {
    return {
      found: true,
      currentPrice: 1,
      quoteCurrency: holding.currency,
      priceDate: requestDate,
      source: "local_cash",
      notes: "",
      cacheHit: true,
    };
  }

  if (!["stock", "crypto", "option", "macro"].includes(holding.assetType)) {
    throw new Error(`Proxy quote does not support asset type ${holding.assetType}`);
  }

  const payload = {
    assetType: holding.assetType,
    symbol: holding.symbol,
    market: holding.market,
    currency: holding.currency,
  };

  if (holding.assetType === "option") {
    payload.underlying = holding.underlying || null;
    payload.optionType = holding.optionType || null;
    payload.strikePrice = holding.strikePrice == null ? null : Number(holding.strikePrice);
    payload.expiryDate = holding.expiryDate || null;
  }

  const result = await fetchJson(`${QUOTE_PROXY_URL.replace(/\/$/, "")}/quote/t1`, {
    method: "POST",
    timeoutMs: 30000,
    body: payload,
  });

  const normalized = normalizeProxyQuoteResult(result, holding, requestDate);
  if (!normalized.found) {
    throw new Error(normalized.notes || `No quote returned for ${holding.symbol}`);
  }

  await storeQuoteInCache(holding, requestDate, normalized);
  return {
    ...normalized,
    cacheHit: false,
  };
}

async function resolveQuoteWithCache(holding, requestDate = getYesterdayDateString()) {
  const cached = await getCachedQuote(holding, requestDate);
  if (cached) {
    return cached;
  }

  return fetchQuoteFromProxy(holding, requestDate);
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

async function refreshMarketPrices(userId, options = {}) {
  const holdingId = options.holdingId ? String(options.holdingId) : "";
  const force = Boolean(options.force);
  const [rows] = holdingId
    ? await pool.query(
        "SELECT * FROM holdings WHERE user_id = ? AND id = ? ORDER BY updated_at DESC, created_at DESC",
        [userId, holdingId]
      )
    : await pool.query(
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

  for (const holding of holdings) {
    if (!force && holding.lastPriceSyncDate === todayDate) {
      continue;
    }

    if (holding.assetType === "cash") {
      await pool.query(
        "UPDATE holdings SET last_price_sync_date = ?, last_price_sync_status = ?, last_price_sync_error = NULL WHERE id = ? AND user_id = ?",
        [todayDate, "synced", holding.id, userId]
      );
      continue;
    }

    try {
      const quote = await resolveQuoteWithCache(holding);
      const latestPrice = quote.currentPrice;

      await pool.query(
        "UPDATE holdings SET current_price = ?, fx_rate = ?, last_price_sync_date = ?, last_price_sync_status = ?, last_price_sync_error = NULL WHERE id = ? AND user_id = ?",
        [latestPrice, holding.fxRate, todayDate, "synced", holding.id, userId]
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_quotes (
      cache_key VARCHAR(255) PRIMARY KEY,
      request_date DATE NOT NULL,
      asset_type VARCHAR(20) NOT NULL,
      market VARCHAR(20) NOT NULL,
      symbol VARCHAR(64) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      underlying VARCHAR(64) NOT NULL DEFAULT '',
      option_type VARCHAR(20) NOT NULL DEFAULT '',
      strike_price DECIMAL(20,8) NOT NULL DEFAULT 0,
      expiry_date DATE NULL,
      current_price DECIMAL(20,8) NULL,
      quote_currency VARCHAR(10) NULL,
      price_date DATE NULL,
      source VARCHAR(255) NULL,
      fetched_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_market_quotes_request_date (request_date),
      INDEX idx_market_quotes_asset_type (asset_type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      base_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      description TEXT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_portfolios_user_id (user_id),
      INDEX idx_portfolios_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      portfolio_id VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      platform VARCHAR(50) NOT NULL,
      market_scope VARCHAR(50) NULL,
      base_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      external_account_ref VARCHAR(128) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      opened_at DATETIME NULL,
      closed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_accounts_user_id (user_id),
      INDEX idx_accounts_portfolio_id (portfolio_id),
      INDEX idx_accounts_platform (platform)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS instruments (
      id VARCHAR(64) PRIMARY KEY,
      asset_type VARCHAR(20) NOT NULL,
      market VARCHAR(20) NOT NULL,
      symbol VARCHAR(64) NOT NULL,
      display_symbol VARCHAR(128) NULL,
      name VARCHAR(255) NOT NULL,
      quote_currency VARCHAR(10) NOT NULL,
      underlying_symbol VARCHAR(64) NULL,
      option_type VARCHAR(20) NULL,
      strike_price DECIMAL(20,8) NULL,
      expiry_date DATE NULL,
      contract_multiplier INT NOT NULL DEFAULT 1,
      exchange_code VARCHAR(32) NULL,
      yahoo_symbol VARCHAR(128) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_instruments_identity (
        asset_type, market, symbol, quote_currency,
        underlying_symbol, option_type, strike_price, expiry_date
      ),
      INDEX idx_instruments_symbol (symbol),
      INDEX idx_instruments_market (market)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_transactions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      portfolio_id VARCHAR(64) NOT NULL,
      account_id VARCHAR(64) NOT NULL,
      instrument_id VARCHAR(64) NULL,
      holding_id VARCHAR(64) NULL,
      transaction_type VARCHAR(40) NOT NULL,
      side VARCHAR(20) NULL,
      trade_date DATE NOT NULL,
      settle_date DATE NULL,
      quantity DECIMAL(20,8) NOT NULL DEFAULT 0,
      unit_price DECIMAL(20,8) NOT NULL DEFAULT 0,
      gross_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      fee_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      net_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      trade_currency VARCHAR(10) NOT NULL,
      fx_rate_to_usd DECIMAL(20,8) NOT NULL DEFAULT 1,
      realized_pnl_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      cost_basis_method VARCHAR(20) NOT NULL DEFAULT 'FIFO',
      external_trade_id VARCHAR(128) NULL,
      source_type VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
      source_ref VARCHAR(255) NULL,
      notes TEXT NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_transactions_user_id (user_id),
      INDEX idx_transactions_portfolio_id (portfolio_id),
      INDEX idx_transactions_account_id (account_id),
      INDEX idx_transactions_instrument_id (instrument_id),
      INDEX idx_transactions_trade_date (trade_date),
      INDEX idx_transactions_type (transaction_type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS position_lots (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      portfolio_id VARCHAR(64) NOT NULL,
      account_id VARCHAR(64) NOT NULL,
      instrument_id VARCHAR(64) NULL,
      holding_id VARCHAR(64) NULL,
      open_transaction_id VARCHAR(64) NOT NULL,
      open_date DATE NOT NULL,
      lot_side VARCHAR(20) NOT NULL DEFAULT 'LONG',
      original_quantity DECIMAL(20,8) NOT NULL,
      remaining_quantity DECIMAL(20,8) NOT NULL,
      open_unit_price DECIMAL(20,8) NOT NULL,
      open_fx_rate_to_usd DECIMAL(20,8) NOT NULL DEFAULT 1,
      trade_currency VARCHAR(10) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      closed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_lots_user_id (user_id),
      INDEX idx_lots_portfolio_id (portfolio_id),
      INDEX idx_lots_account_id (account_id),
      INDEX idx_lots_instrument_id (instrument_id),
      INDEX idx_lots_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS realized_pnl_ledger (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      portfolio_id VARCHAR(64) NOT NULL,
      account_id VARCHAR(64) NOT NULL,
      instrument_id VARCHAR(64) NULL,
      holding_id VARCHAR(64) NULL,
      open_transaction_id VARCHAR(64) NULL,
      close_transaction_id VARCHAR(64) NOT NULL,
      lot_id VARCHAR(64) NULL,
      recognized_date DATE NOT NULL,
      quantity_closed DECIMAL(20,8) NOT NULL DEFAULT 0,
      proceeds_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      cost_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      fee_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      realized_pnl_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
      realized_pnl_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      trade_currency VARCHAR(10) NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_realized_user_id (user_id),
      INDEX idx_realized_portfolio_id (portfolio_id),
      INDEX idx_realized_account_id (account_id),
      INDEX idx_realized_instrument_id (instrument_id),
      INDEX idx_realized_date (recognized_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id VARCHAR(64) PRIMARY KEY,
      instrument_id VARCHAR(64) NULL,
      asset_type VARCHAR(20) NOT NULL,
      market VARCHAR(20) NOT NULL,
      symbol VARCHAR(64) NOT NULL,
      quote_currency VARCHAR(10) NOT NULL,
      snapshot_date DATE NOT NULL,
      close_price DECIMAL(20,8) NOT NULL,
      adjusted_close_price DECIMAL(20,8) NULL,
      source VARCHAR(255) NOT NULL,
      source_ref VARCHAR(255) NULL,
      fetched_at DATETIME NOT NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_price_snapshots (symbol, market, quote_currency, snapshot_date, source),
      INDEX idx_price_snapshots_instrument_id (instrument_id),
      INDEX idx_price_snapshots_date (snapshot_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fx_snapshots (
      id VARCHAR(64) PRIMARY KEY,
      base_currency VARCHAR(10) NOT NULL,
      quote_currency VARCHAR(10) NOT NULL,
      snapshot_date DATE NOT NULL,
      close_rate DECIMAL(20,8) NOT NULL,
      source VARCHAR(255) NOT NULL,
      fetched_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_fx_snapshots (base_currency, quote_currency, snapshot_date, source),
      INDEX idx_fx_snapshots_date (snapshot_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nav_snapshots (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      portfolio_id VARCHAR(64) NOT NULL,
      snapshot_date DATE NOT NULL,
      nav_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      cash_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      market_value_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      unrealized_pnl_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      realized_pnl_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      total_pnl_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      deposit_flow_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      withdrawal_flow_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_nav_snapshots (portfolio_id, snapshot_date),
      INDEX idx_nav_user_id (user_id),
      INDEX idx_nav_date (snapshot_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS corporate_actions (
      id VARCHAR(64) PRIMARY KEY,
      instrument_id VARCHAR(64) NULL,
      market VARCHAR(20) NOT NULL,
      symbol VARCHAR(64) NOT NULL,
      action_type VARCHAR(40) NOT NULL,
      ex_date DATE NOT NULL,
      payable_date DATE NULL,
      record_date DATE NULL,
      ratio_from DECIMAL(20,8) NULL,
      ratio_to DECIMAL(20,8) NULL,
      cash_amount DECIMAL(20,8) NULL,
      currency VARCHAR(10) NULL,
      source VARCHAR(255) NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_corporate_actions_symbol (symbol, market),
      INDEX idx_corporate_actions_ex_date (ex_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NULL,
      portfolio_id VARCHAR(64) NULL,
      account_id VARCHAR(64) NULL,
      instrument_id VARCHAR(64) NULL,
      holding_id VARCHAR(64) NULL,
      sync_type VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL,
      target_ref VARCHAR(255) NULL,
      source VARCHAR(255) NULL,
      message TEXT NULL,
      metadata_json JSON NULL,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sync_logs_user_id (user_id),
      INDEX idx_sync_logs_status (status),
      INDEX idx_sync_logs_type (sync_type),
      INDEX idx_sync_logs_started_at (started_at)
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

  const [portfolioIdColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'portfolio_id'`,
    [DB_NAME]
  );

  if (Number(portfolioIdColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN portfolio_id VARCHAR(64) NULL AFTER user_id");
  }

  const [accountIdColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'account_id'`,
    [DB_NAME]
  );

  if (Number(accountIdColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN account_id VARCHAR(64) NULL AFTER portfolio_id");
  }

  const [instrumentIdColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'instrument_id'`,
    [DB_NAME]
  );

  if (Number(instrumentIdColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN instrument_id VARCHAR(64) NULL AFTER account_id");
  }

  const [statusColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'status'`,
    [DB_NAME]
  );

  if (Number(statusColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'OPEN' AFTER contract_multiplier");
  }

  const [openedAtColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'opened_at'`,
    [DB_NAME]
  );

  if (Number(openedAtColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN opened_at DATETIME NULL AFTER status");
  }

  const [closedAtColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'closed_at'`,
    [DB_NAME]
  );

  if (Number(closedAtColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN closed_at DATETIME NULL AFTER opened_at");
  }

  const [bookCostTotalColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'book_cost_total'`,
    [DB_NAME]
  );

  if (Number(bookCostTotalColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN book_cost_total DECIMAL(20,8) NOT NULL DEFAULT 0 AFTER closed_at");
  }

  const [realizedPnlTotalColumns] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND COLUMN_NAME = 'realized_pnl_total'`,
    [DB_NAME]
  );

  if (Number(realizedPnlTotalColumns[0]?.count || 0) === 0) {
    await pool.query("ALTER TABLE holdings ADD COLUMN realized_pnl_total DECIMAL(20,8) NOT NULL DEFAULT 0 AFTER book_cost_total");
  }

  const [holdingPortfolioIndexes] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND INDEX_NAME = 'idx_holdings_portfolio_id'`,
    [DB_NAME]
  );

  if (Number(holdingPortfolioIndexes[0]?.count || 0) === 0) {
    await pool.query("CREATE INDEX idx_holdings_portfolio_id ON holdings (portfolio_id)");
  }

  const [holdingAccountIndexes] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND INDEX_NAME = 'idx_holdings_account_id'`,
    [DB_NAME]
  );

  if (Number(holdingAccountIndexes[0]?.count || 0) === 0) {
    await pool.query("CREATE INDEX idx_holdings_account_id ON holdings (account_id)");
  }

  const [holdingInstrumentIndexes] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'holdings' AND INDEX_NAME = 'idx_holdings_instrument_id'`,
    [DB_NAME]
  );

  if (Number(holdingInstrumentIndexes[0]?.count || 0) === 0) {
    await pool.query("CREATE INDEX idx_holdings_instrument_id ON holdings (instrument_id)");
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

  await backfillLedgerReferences();
  await normalizeOptionUnderlyingAndMergeInstruments();
  await backfillHoldingOpeningTransactions();
  await backfillOpeningLots();
  await backfillHistoricalCashSettlements();
  await backfillTransactionRealizedPnl();
  await backfillHoldingClosedAtFromTransactions();
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

app.get("/portfolio/transactions", (_req, res) => {
  renderPage(res, "portfolio-transactions", "/portfolio/transactions");
});

app.get("/portfolio/history", (_req, res) => {
  renderPage(res, "portfolio-history", "/portfolio/history");
});

app.get("/portfolio/realized-pnl", (_req, res) => {
  renderPage(res, "portfolio-realized-pnl", "/portfolio/realized-pnl");
});

app.get("/portfolio/review", (_req, res) => {
  renderPage(res, "portfolio-review", "/portfolio/review");
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
  const inviteRequired = false;
  res.json({
    inviteRequired,
    bootstrapInviteEnabled: false,
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

app.post("/api/prices/refresh/:id", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const result = await refreshMarketPrices(req.user.id, { holdingId: req.params.id, force: true });
    const [rows] = await pool.query(
      "SELECT * FROM holdings WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC",
      [req.user.id]
    );
    res.json({
      ...result,
      holdings: rows.map(mapRow),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Single holding price refresh failed" });
  }
});

app.post("/api/prices/lookup", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const holding = normalizeHolding({
      ...req.body,
      name: String(req.body?.name || req.body?.symbol || "").trim(),
    });
    const result = await resolveQuoteWithCache(holding);
    res.json({
      found: result.found,
      currentPrice: result.currentPrice,
      quoteCurrency: result.quoteCurrency,
      priceDate: result.priceDate,
      source: result.source,
      cacheHit: Boolean(result.cacheHit),
      notes: result.notes || "",
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Price lookup failed" });
  }
});

app.post("/api/holdings", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const holding = normalizeHolding(req.body);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const refs = await ensureLedgerRefsForHolding(req.user.id, holding, connection);
      const openedAt = new Date();
      const enrichedHolding = {
        ...holding,
        userId: req.user.id,
        ...refs,
        status: inferHoldingStatus(holding),
        openedAt,
        closedAt: Number(holding.quantity || 0) === 0 ? openedAt : null,
        bookCostTotal: computeHoldingBookCost(holding),
        realizedPnlTotal: 0,
      };

      await connection.query(
        `INSERT INTO holdings (
          id, user_id, portfolio_id, account_id, instrument_id,
          asset_type, position_side, platform, market, symbol, name, currency,
          quantity, cost_price, current_price, fx_rate, target_allocation, notes,
          underlying, option_type, strike_price, expiry_date, contract_multiplier,
          status, opened_at, closed_at, book_cost_total, realized_pnl_total
        ) VALUES (
          :id, :userId, :portfolioId, :accountId, :instrumentId,
          :assetType, :positionSide, :platform, :market, :symbol, :name, :currency,
          :quantity, :costPrice, :currentPrice, :fxRate, :targetAllocation, :notes,
          :underlying, :optionType, :strikePrice, :expiryDate, :contractMultiplier,
          :status, :openedAt, :closedAt, :bookCostTotal, :realizedPnlTotal
        )`,
        enrichedHolding
      );

      const openingTransactionId = await writeHoldingLedgerTransaction(connection, req.user.id, enrichedHolding, refs, "OPENING_BALANCE");

      if (Number(enrichedHolding.quantity || 0) > 0) {
        await createPositionLot(connection, {
          userId: req.user.id,
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

      await connection.commit();

      const [rows] = await pool.query("SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1", [holding.id, req.user.id]);
      res.status(201).json(rows[0] ? mapRow(rows[0]) : enrichedHolding);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/holdings/:id", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const holding = normalizeHolding({ ...req.body, id: req.params.id });
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [existingRows] = await connection.query(
        "SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1",
        [holding.id, req.user.id]
      );

      if (!existingRows[0]) {
        await connection.rollback();
        return res.status(404).json({ error: "Holding not found" });
      }

      const previousHolding = mapRow(existingRows[0]);
      const refs = await ensureLedgerRefsForHolding(req.user.id, holding, connection);
      const status = inferHoldingStatus(holding);
      const closedAt = status === "CLOSED" ? (previousHolding.closedAt || new Date()) : null;
      const enrichedHolding = {
        ...holding,
        userId: req.user.id,
        ...refs,
        status,
        openedAt: previousHolding.openedAt || existingRows[0].created_at || new Date(),
        closedAt,
        bookCostTotal: computeHoldingBookCost(holding),
        realizedPnlTotal: previousHolding.realizedPnlTotal || 0,
      };

      await connection.query(
        `UPDATE holdings SET
          portfolio_id = :portfolioId,
          account_id = :accountId,
          instrument_id = :instrumentId,
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
          contract_multiplier = :contractMultiplier,
          status = :status,
          opened_at = :openedAt,
          closed_at = :closedAt,
          book_cost_total = :bookCostTotal,
          realized_pnl_total = :realizedPnlTotal
        WHERE id = :id AND user_id = :userId`,
        enrichedHolding
      );

      await writeHoldingLedgerTransaction(connection, req.user.id, enrichedHolding, refs, "SNAPSHOT_ADJUSTMENT", previousHolding);
      await connection.commit();

      const [rows] = await pool.query("SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1", [holding.id, req.user.id]);
      res.json(rows[0] ? mapRow(rows[0]) : enrichedHolding);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/holdings/:id/trades", requireDatabase, authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1",
      [req.params.id, req.user.id]
    );

    if (!rows[0]) {
      await connection.rollback();
      return res.status(404).json({ error: "Holding not found" });
    }

    const result = await processHoldingTrade(connection, req.user.id, rows[0], req.body || {});
    await connection.commit();

    const [updatedRows] = await pool.query(
      "SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1",
      [req.params.id, req.user.id]
    );

    const relatedHoldingIds = Array.isArray(result.relatedHoldings)
      ? [...new Set(result.relatedHoldings.map((item) => item?.id).filter(Boolean))]
      : [];
    const relatedHoldings = relatedHoldingIds.length
      ? await Promise.all(
          relatedHoldingIds.map(async (holdingId) => {
            const [relatedRows] = await pool.query(
              "SELECT * FROM holdings WHERE id = ? AND user_id = ? LIMIT 1",
              [holdingId, req.user.id]
            );
            return relatedRows[0] ? mapRow(relatedRows[0]) : null;
          })
        )
      : [];

    res.json({
      ...result,
      holding: updatedRows[0] ? mapRow(updatedRows[0]) : null,
      relatedHoldings: relatedHoldings.filter(Boolean),
    });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ error: error.message || "Holding trade failed" });
  } finally {
    connection.release();
  }
});

app.get("/api/transactions", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
    const filters = [];
    const params = [req.user.id];

    if (String(req.query.assetType || "").trim()) {
      filters.push("COALESCE(h.asset_type, i.asset_type, '') = ?");
      params.push(String(req.query.assetType).trim());
    }

    if (String(req.query.platform || "").trim()) {
      filters.push("COALESCE(h.platform, a.platform, '') = ?");
      params.push(String(req.query.platform).trim());
    }

    if (String(req.query.transactionType || "").trim()) {
      filters.push("pt.transaction_type = ?");
      params.push(String(req.query.transactionType).trim());
    }

    if (String(req.query.symbol || "").trim()) {
      filters.push("COALESCE(h.symbol, i.symbol, '') = ?");
      params.push(String(req.query.symbol).trim().toUpperCase());
    }

    if (String(req.query.query || "").trim()) {
      const term = `%${String(req.query.query).trim()}%`;
      filters.push("(COALESCE(h.symbol, i.symbol, '') LIKE ? OR COALESCE(h.name, i.name, '') LIKE ? OR COALESCE(pt.notes, '') LIKE ?)");
      params.push(term, term, term);
    }

    const whereClause = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    params.push(limit);

    const [rows] = await pool.query(
      `SELECT
        pt.*,
        a.name AS account_name,
        COALESCE(h.asset_type, i.asset_type) AS asset_type,
        COALESCE(h.platform, a.platform) AS platform,
        COALESCE(h.market, i.market) AS market,
        COALESCE(h.symbol, i.symbol) AS symbol,
        COALESCE(h.name, i.name) AS name
      FROM portfolio_transactions pt
      LEFT JOIN holdings h ON h.id = pt.holding_id
      LEFT JOIN accounts a ON a.id = pt.account_id
      LEFT JOIN instruments i ON i.id = pt.instrument_id
      WHERE pt.user_id = ?${whereClause}
      ORDER BY pt.trade_date DESC, pt.created_at DESC, pt.id DESC
      LIMIT ?`,
      params
    );

    res.json(rows.map(mapTransactionRow));
  } catch (error) {
    res.status(400).json({ error: error.message || "Transactions lookup failed" });
  }
});

app.get("/api/realized-pnl", requireDatabase, authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
    const filters = [];
    const params = [req.user.id];

    if (String(req.query.assetType || "").trim()) {
      filters.push("COALESCE(h.asset_type, i.asset_type, '') = ?");
      params.push(String(req.query.assetType).trim());
    }

    if (String(req.query.platform || "").trim()) {
      filters.push("COALESCE(h.platform, a.platform, '') = ?");
      params.push(String(req.query.platform).trim());
    }

    if (String(req.query.symbol || "").trim()) {
      filters.push("COALESCE(h.symbol, i.symbol, '') = ?");
      params.push(String(req.query.symbol).trim().toUpperCase());
    }

    if (String(req.query.query || "").trim()) {
      const term = `%${String(req.query.query).trim()}%`;
      filters.push("(COALESCE(h.symbol, i.symbol, '') LIKE ? OR COALESCE(h.name, i.name, '') LIKE ? OR COALESCE(r.notes, '') LIKE ?)");
      params.push(term, term, term);
    }

    const whereClause = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    params.push(limit);

    const [rows] = await pool.query(
      `SELECT
        r.*,
        a.name AS account_name,
        COALESCE(h.asset_type, i.asset_type) AS asset_type,
        COALESCE(h.platform, a.platform) AS platform,
        COALESCE(h.market, i.market) AS market,
        COALESCE(h.symbol, i.symbol) AS symbol,
        COALESCE(h.name, i.name) AS name
      FROM realized_pnl_ledger r
      LEFT JOIN holdings h ON h.id = r.holding_id
      LEFT JOIN accounts a ON a.id = r.account_id
      LEFT JOIN instruments i ON i.id = r.instrument_id
      WHERE r.user_id = ?${whereClause}
      ORDER BY r.recognized_date DESC, r.created_at DESC, r.id DESC
      LIMIT ?`,
      params
    );

    res.json(rows.map(mapRealizedPnlRow));
  } catch (error) {
    res.status(400).json({ error: error.message || "Realized pnl lookup failed" });
  }
});

app.get("/api/review-metrics", requireDatabase, authMiddleware, async (req, res) => {
  try {
    await ensureNavSnapshotsForToday(req.user.id);
    const metrics = await buildReviewMetrics(req.user.id);
    res.json(metrics);
  } catch (error) {
    res.status(400).json({ error: error.message || "Review metrics lookup failed" });
  }
});

app.get("/api/nav-series", requireDatabase, authMiddleware, async (req, res) => {
  try {
    await ensureNavSnapshotsForToday(req.user.id);
    const limit = Math.min(Math.max(Number(req.query.limit || 90), 1), 365);
    const [rows] = await pool.query(
      `SELECT snapshot_date, nav_usd, cash_usd, market_value_usd, unrealized_pnl_usd, realized_pnl_usd, total_pnl_usd
       FROM nav_snapshots
       WHERE user_id = ?
       ORDER BY snapshot_date DESC
       LIMIT ?`,
      [req.user.id, limit]
    );

    res.json(
      rows
        .map((row) => ({
          snapshotDate: toDateOnly(row.snapshot_date),
          navUsd: Number(row.nav_usd || 0),
          cashUsd: Number(row.cash_usd || 0),
          marketValueUsd: Number(row.market_value_usd || 0),
          unrealizedPnlUsd: Number(row.unrealized_pnl_usd || 0),
          realizedPnlUsd: Number(row.realized_pnl_usd || 0),
          totalPnlUsd: Number(row.total_pnl_usd || 0),
        }))
        .reverse()
    );
  } catch (error) {
    res.status(400).json({ error: error.message || "NAV series lookup failed" });
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

      const [existingHoldingRows] = await connection.query(
        "SELECT id FROM holdings WHERE user_id = ?",
        [req.user.id]
      );
      const existingHoldingIds = existingHoldingRows.map((row) => row.id);
      if (existingHoldingIds.length) {
        await connection.query(
          `DELETE FROM portfolio_transactions
           WHERE user_id = ?
             AND source_type = 'HOLDING_UI'
             AND holding_id IN (?)`,
          [req.user.id, existingHoldingIds]
        );
      }
      await connection.query("DELETE FROM holdings WHERE user_id = ?", [req.user.id]);

      for (const raw of incoming) {
        const holding = normalizeHolding(raw);
        const refs = await ensureLedgerRefsForHolding(req.user.id, holding, connection);
        const openedAt = new Date();
        const enrichedHolding = {
          ...holding,
          userId: req.user.id,
          ...refs,
          status: inferHoldingStatus(holding),
          openedAt,
          closedAt: Number(holding.quantity || 0) === 0 ? openedAt : null,
          bookCostTotal: computeHoldingBookCost(holding),
          realizedPnlTotal: 0,
        };

        await connection.query(
          `INSERT INTO holdings (
            id, user_id, portfolio_id, account_id, instrument_id,
            asset_type, position_side, platform, market, symbol, name, currency,
            quantity, cost_price, current_price, fx_rate, target_allocation, notes,
            underlying, option_type, strike_price, expiry_date, contract_multiplier,
            status, opened_at, closed_at, book_cost_total, realized_pnl_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            enrichedHolding.id,
            req.user.id,
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

        const openingTransactionId = await writeHoldingLedgerTransaction(connection, req.user.id, enrichedHolding, refs, "OPENING_BALANCE");

        if (Number(enrichedHolding.quantity || 0) > 0) {
          await createPositionLot(connection, {
            userId: req.user.id,
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
