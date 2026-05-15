const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }
  return SHANGHAI_DATE_FORMATTER.format(parsed);
}

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    inviteCode: row.invite_code || "",
    invitedBy: row.invited_by || null,
    createdAt: row.created_at,
  };
}

export function mapHoldingRow(row) {
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
    quantity: Number(row.quantity || 0),
    costPrice: Number(row.cost_price || 0),
    currentPrice: Number(row.current_price || 0),
    fxRate: Number(row.fx_rate || 1),
    targetAllocation: Number(row.target_allocation || 0),
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

export function mapTransactionRow(row) {
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

export function mapRealizedPnlRow(row) {
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
