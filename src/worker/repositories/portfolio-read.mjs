import { all } from "./d1-client.mjs";
import { mapHoldingRow, mapRealizedPnlRow, mapTransactionRow } from "../lib/mappers.mjs";

function appendFilter(filters, params, condition, value) {
  if (value == null || value === "") return;
  filters.push(condition);
  params.push(value);
}

export async function listHoldings(env, userId) {
  const rows = await all(
    env,
    `SELECT * FROM holdings
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [userId]
  );

  return rows.map(mapHoldingRow);
}

export async function listTransactions(env, userId, query) {
  const limit = Math.min(Math.max(Number(query.get("limit") || 200), 1), 1000);
  const filters = ["pt.user_id = ?"];
  const params = [userId];

  appendFilter(filters, params, "COALESCE(h.asset_type, i.asset_type, '') = ?", String(query.get("assetType") || "").trim());
  appendFilter(filters, params, "COALESCE(h.platform, a.platform, '') = ?", String(query.get("platform") || "").trim());
  appendFilter(filters, params, "pt.transaction_type = ?", String(query.get("transactionType") || "").trim());
  appendFilter(filters, params, "COALESCE(h.symbol, i.symbol, '') = ?", String(query.get("symbol") || "").trim().toUpperCase());

  const keyword = String(query.get("query") || "").trim();
  if (keyword) {
    const term = `%${keyword}%`;
    filters.push("(COALESCE(h.symbol, i.symbol, '') LIKE ? OR COALESCE(h.name, i.name, '') LIKE ? OR COALESCE(pt.notes, '') LIKE ?)");
    params.push(term, term, term);
  }

  params.push(limit);

  const rows = await all(
    env,
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
    WHERE ${filters.join(" AND ")}
    ORDER BY pt.trade_date DESC, pt.created_at DESC, pt.id DESC
    LIMIT ?`,
    params
  );

  return rows.map(mapTransactionRow);
}

export async function listRealizedPnl(env, userId, query) {
  const limit = Math.min(Math.max(Number(query.get("limit") || 200), 1), 1000);
  const filters = ["r.user_id = ?"];
  const params = [userId];

  appendFilter(filters, params, "COALESCE(h.asset_type, i.asset_type, '') = ?", String(query.get("assetType") || "").trim());
  appendFilter(filters, params, "COALESCE(h.platform, a.platform, '') = ?", String(query.get("platform") || "").trim());
  appendFilter(filters, params, "COALESCE(h.symbol, i.symbol, '') = ?", String(query.get("symbol") || "").trim().toUpperCase());

  const keyword = String(query.get("query") || "").trim();
  if (keyword) {
    const term = `%${keyword}%`;
    filters.push("(COALESCE(h.symbol, i.symbol, '') LIKE ? OR COALESCE(h.name, i.name, '') LIKE ? OR COALESCE(r.notes, '') LIKE ?)");
    params.push(term, term, term);
  }

  params.push(limit);

  const rows = await all(
    env,
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
    WHERE ${filters.join(" AND ")}
    ORDER BY r.recognized_date DESC, r.created_at DESC, r.id DESC
    LIMIT ?`,
    params
  );

  return rows.map(mapRealizedPnlRow);
}
