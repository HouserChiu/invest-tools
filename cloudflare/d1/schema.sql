PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  invite_code TEXT UNIQUE,
  invited_by TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  portfolio_id TEXT,
  account_id TEXT,
  instrument_id TEXT,
  asset_type TEXT NOT NULL,
  position_side TEXT NOT NULL DEFAULT 'long',
  platform TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  current_price NUMERIC NOT NULL DEFAULT 0,
  fx_rate NUMERIC NOT NULL DEFAULT 1,
  target_allocation NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  underlying TEXT,
  option_type TEXT,
  strike_price NUMERIC,
  expiry_date TEXT,
  contract_multiplier INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'OPEN',
  opened_at TEXT,
  closed_at TEXT,
  book_cost_total NUMERIC NOT NULL DEFAULT 0,
  realized_pnl_total NUMERIC NOT NULL DEFAULT 0,
  last_price_sync_date TEXT,
  last_price_sync_status TEXT,
  last_price_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_holdings_user_id ON holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_holdings_account_id ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_instrument_id ON holdings(instrument_id);

CREATE TABLE IF NOT EXISTS market_quotes (
  cache_key TEXT PRIMARY KEY,
  request_date TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  currency TEXT NOT NULL,
  underlying TEXT NOT NULL DEFAULT '',
  option_type TEXT NOT NULL DEFAULT '',
  strike_price NUMERIC NOT NULL DEFAULT 0,
  expiry_date TEXT,
  current_price NUMERIC,
  quote_currency TEXT,
  price_date TEXT,
  source TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_market_quotes_request_date ON market_quotes(request_date);
CREATE INDEX IF NOT EXISTS idx_market_quotes_asset_type ON market_quotes(asset_type);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_status ON portfolios(status);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  market_scope TEXT,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  external_account_ref TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_portfolio_id ON accounts(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);

CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  display_symbol TEXT,
  name TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  underlying_symbol TEXT,
  option_type TEXT,
  strike_price NUMERIC,
  expiry_date TEXT,
  contract_multiplier INTEGER NOT NULL DEFAULT 1,
  exchange_code TEXT,
  yahoo_symbol TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (
    asset_type,
    market,
    symbol,
    quote_currency,
    underlying_symbol,
    option_type,
    strike_price,
    expiry_date
  )
);
CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(symbol);
CREATE INDEX IF NOT EXISTS idx_instruments_market ON instruments(market);

CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  instrument_id TEXT,
  holding_id TEXT,
  transaction_type TEXT NOT NULL,
  side TEXT,
  trade_date TEXT NOT NULL,
  settle_date TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  fee_amount NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL DEFAULT 0,
  trade_currency TEXT NOT NULL,
  fx_rate_to_usd NUMERIC NOT NULL DEFAULT 1,
  realized_pnl_amount NUMERIC NOT NULL DEFAULT 0,
  cost_basis_method TEXT NOT NULL DEFAULT 'FIFO',
  external_trade_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'MANUAL',
  source_ref TEXT,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON portfolio_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_id ON portfolio_transactions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON portfolio_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_instrument_id ON portfolio_transactions(instrument_id);
CREATE INDEX IF NOT EXISTS idx_transactions_trade_date ON portfolio_transactions(trade_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON portfolio_transactions(transaction_type);

CREATE TABLE IF NOT EXISTS position_lots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  instrument_id TEXT,
  holding_id TEXT,
  open_transaction_id TEXT NOT NULL,
  open_date TEXT NOT NULL,
  lot_side TEXT NOT NULL DEFAULT 'LONG',
  original_quantity NUMERIC NOT NULL,
  remaining_quantity NUMERIC NOT NULL,
  open_unit_price NUMERIC NOT NULL,
  open_fx_rate_to_usd NUMERIC NOT NULL DEFAULT 1,
  trade_currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lots_user_id ON position_lots(user_id);
CREATE INDEX IF NOT EXISTS idx_lots_portfolio_id ON position_lots(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_lots_account_id ON position_lots(account_id);
CREATE INDEX IF NOT EXISTS idx_lots_instrument_id ON position_lots(instrument_id);
CREATE INDEX IF NOT EXISTS idx_lots_status ON position_lots(status);

CREATE TABLE IF NOT EXISTS realized_pnl_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  instrument_id TEXT,
  holding_id TEXT,
  open_transaction_id TEXT,
  close_transaction_id TEXT NOT NULL,
  lot_id TEXT,
  recognized_date TEXT NOT NULL,
  quantity_closed NUMERIC NOT NULL DEFAULT 0,
  proceeds_amount NUMERIC NOT NULL DEFAULT 0,
  cost_amount NUMERIC NOT NULL DEFAULT 0,
  fee_amount NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  realized_pnl_amount NUMERIC NOT NULL DEFAULT 0,
  realized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  trade_currency TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_realized_user_id ON realized_pnl_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_realized_portfolio_id ON realized_pnl_ledger(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_realized_account_id ON realized_pnl_ledger(account_id);
CREATE INDEX IF NOT EXISTS idx_realized_instrument_id ON realized_pnl_ledger(instrument_id);
CREATE INDEX IF NOT EXISTS idx_realized_date ON realized_pnl_ledger(recognized_date);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id TEXT PRIMARY KEY,
  instrument_id TEXT,
  asset_type TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  close_price NUMERIC NOT NULL,
  adjusted_close_price NUMERIC,
  source TEXT NOT NULL,
  source_ref TEXT,
  fetched_at TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (symbol, market, quote_currency, snapshot_date, source)
);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_instrument_id ON price_snapshots(instrument_id);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_date ON price_snapshots(snapshot_date);

CREATE TABLE IF NOT EXISTS fx_snapshots (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  close_rate NUMERIC NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (base_currency, quote_currency, snapshot_date, source)
);
CREATE INDEX IF NOT EXISTS idx_fx_snapshots_date ON fx_snapshots(snapshot_date);

CREATE TABLE IF NOT EXISTS nav_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  nav_usd NUMERIC NOT NULL DEFAULT 0,
  cash_usd NUMERIC NOT NULL DEFAULT 0,
  market_value_usd NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  realized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  total_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  deposit_flow_usd NUMERIC NOT NULL DEFAULT 0,
  withdrawal_flow_usd NUMERIC NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (portfolio_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_nav_user_id ON nav_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_nav_date ON nav_snapshots(snapshot_date);

CREATE TABLE IF NOT EXISTS corporate_actions (
  id TEXT PRIMARY KEY,
  instrument_id TEXT,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action_type TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  payable_date TEXT,
  record_date TEXT,
  ratio_from NUMERIC,
  ratio_to NUMERIC,
  cash_amount NUMERIC,
  currency TEXT,
  source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_symbol ON corporate_actions(symbol, market);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_ex_date ON corporate_actions(ex_date);

CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  portfolio_id TEXT,
  account_id TEXT,
  instrument_id TEXT,
  holding_id TEXT,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  target_ref TEXT,
  source TEXT,
  message TEXT,
  metadata_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_user_id ON sync_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_type ON sync_logs(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at ON sync_logs(started_at);
