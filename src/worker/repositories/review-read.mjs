import { all, first, run } from "./d1-client.mjs";
import { mapHoldingRow } from "../lib/mappers.mjs";

function getCurrentDateString() {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function toDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function buildSnapshotInsertParams(entry) {
  return [
    crypto.randomUUID(),
    entry.userId,
    entry.portfolioId || "default",
    entry.snapshotDate,
    entry.navUsd,
    entry.cashUsd,
    entry.marketValueUsd,
    entry.unrealizedPnlUsd,
    entry.realizedPnlUsd,
    entry.totalPnlUsd,
  ];
}

export async function ensureNavSnapshotsForTodayD1(env, userId) {
  const today = getCurrentDateString();
  const holdingRows = await all(
    env,
    `SELECT * FROM holdings
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [userId]
  );
  const holdings = holdingRows.map(mapHoldingRow);

  const realizedRows = await all(
    env,
    `SELECT portfolio_id, COALESCE(SUM(realized_pnl_usd), 0) AS realized_total
     FROM realized_pnl_ledger
     WHERE user_id = ?
     GROUP BY portfolio_id`,
    [userId]
  );
  const realizedByPortfolio = new Map(
    realizedRows.map((row) => [row.portfolio_id, Number(row.realized_total || 0)])
  );

  const byPortfolio = new Map();
  for (const holding of holdings) {
    const key = holding.portfolioId || "default";
    const metrics = computeHoldingMetricsBase(holding);
    const entry = byPortfolio.get(key) || {
      userId,
      portfolioId: holding.portfolioId || "default",
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
  }

  for (const entry of byPortfolio.values()) {
    entry.totalPnlUsd = entry.realizedPnlUsd + entry.unrealizedPnlUsd;
    await run(
      env,
      `INSERT INTO nav_snapshots (
        id, user_id, portfolio_id, snapshot_date,
        nav_usd, cash_usd, market_value_usd, unrealized_pnl_usd, realized_pnl_usd, total_pnl_usd,
        deposit_flow_usd, withdrawal_flow_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT(portfolio_id, snapshot_date) DO UPDATE SET
        nav_usd = excluded.nav_usd,
        cash_usd = excluded.cash_usd,
        market_value_usd = excluded.market_value_usd,
        unrealized_pnl_usd = excluded.unrealized_pnl_usd,
        realized_pnl_usd = excluded.realized_pnl_usd,
        total_pnl_usd = excluded.total_pnl_usd`,
      buildSnapshotInsertParams(entry)
    );
  }
}

export async function buildReviewMetricsD1(env, userId) {
  const holdingRows = await all(
    env,
    `SELECT * FROM holdings
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [userId]
  );
  const holdings = holdingRows.map(mapHoldingRow);

  const realizedRows = await all(
    env,
    `SELECT close_transaction_id, COALESCE(SUM(realized_pnl_usd), 0) AS realized_total
     FROM realized_pnl_ledger
     WHERE user_id = ?
     GROUP BY close_transaction_id`,
    [userId]
  );

  const bestWorstRows = await all(
    env,
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

  for (const holding of holdings) {
    const metrics = computeHoldingMetricsBase(holding);
    totalNavUsd += metrics.marketValueUsd;
    totalCostUsd += metrics.costValueUsd;
    unrealizedPnlUsd += metrics.pnlUsd;
    platformCount.add(holding.platform);
    if (holding.assetType === "cash") {
      currentCashUsd += metrics.marketValueUsd;
    }
  }

  const tradePnls = realizedRows.map((row) => Number(row.realized_total || 0));
  const realizedPnlUsd = tradePnls.reduce((sum, value) => sum + value, 0);
  const winningTrades = tradePnls.filter((value) => value > 0);
  const losingTrades = tradePnls.filter((value) => value < 0);
  const flatTrades = tradePnls.filter((value) => value === 0);
  const closedTrades = tradePnls.length;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;

  const sortedBestWorst = [...bestWorstRows].sort(
    (a, b) => Number(b.realized_total || 0) - Number(a.realized_total || 0)
  );

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
    avgWinUsd: winningTrades.length
      ? winningTrades.reduce((sum, value) => sum + value, 0) / winningTrades.length
      : 0,
    avgLossUsd: losingTrades.length
      ? losingTrades.reduce((sum, value) => sum + value, 0) / losingTrades.length
      : 0,
    platformCount: platformCount.size,
    bestTrade,
    worstTrade,
  };
}

export async function listNavSeriesD1(env, userId, limitValue) {
  const limit = Math.min(Math.max(Number(limitValue || 90), 1), 365);
  const rows = await all(
    env,
    `SELECT snapshot_date, nav_usd, cash_usd, market_value_usd, unrealized_pnl_usd, realized_pnl_usd, total_pnl_usd
     FROM nav_snapshots
     WHERE user_id = ?
     ORDER BY snapshot_date DESC
     LIMIT ?`,
    [userId, limit]
  );

  return rows
    .map((row) => ({
      snapshotDate: toDateOnly(row.snapshot_date),
      navUsd: Number(row.nav_usd || 0),
      cashUsd: Number(row.cash_usd || 0),
      marketValueUsd: Number(row.market_value_usd || 0),
      unrealizedPnlUsd: Number(row.unrealized_pnl_usd || 0),
      realizedPnlUsd: Number(row.realized_pnl_usd || 0),
      totalPnlUsd: Number(row.total_pnl_usd || 0),
    }))
    .reverse();
}

export async function getSeededSessionUser(env) {
  return first(env, `SELECT id, username FROM users ORDER BY created_at ASC LIMIT 1`);
}
