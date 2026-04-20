# Investment Ledger Schema

This project now has two layers of storage:

- `holdings`: current-position snapshot layer for the existing portfolio UI
- ledger tables: source-of-truth accounting layer for future add/reduce/close/review workflows

## Core Principles

- positions are snapshots
- transactions are the source of truth
- lots preserve cost basis history
- realized pnl is recognized by close events, not by overwriting holdings
- price and fx data are snapshotted by date for reproducible review

## Tables

### `portfolios`

Logical strategy buckets under one user, for example:

- main account
- options account
- long-term portfolio
- experimental strategy

### `accounts`

Real broker/exchange accounts inside a portfolio, for example:

- IBKR
- Futu
- Tiger
- Phillip
- OKX
- Zhuorui

### `instruments`

Canonical instrument master data across:

- stocks
- options
- crypto
- cash
- fx
- precious metals

### `portfolio_transactions`

Immutable event ledger. Every business action should become a transaction row, such as:

- BUY
- SELL
- OPEN_LONG
- CLOSE_LONG
- OPEN_SHORT
- CLOSE_SHORT
- DEPOSIT
- WITHDRAW
- DIVIDEND
- INTEREST
- FEE
- TAX
- TRANSFER_IN
- TRANSFER_OUT
- ASSIGNMENT
- EXERCISE
- EXPIRE

### `position_lots`

Lot-level inventory for:

- add position
- reduce position
- full close
- fifo / lifo / specific-lot basis

### `realized_pnl_ledger`

Recognized pnl records produced when lots are closed.

### `price_snapshots`

Daily market close snapshots by symbol/date/source.

### `fx_snapshots`

Daily fx snapshots used to normalize pnl and nav into USD.

### `nav_snapshots`

Portfolio-level daily nav history for:

- performance curve
- drawdown
- time series review

### `corporate_actions`

Future support for:

- splits
- reverse splits
- dividends
- stock distributions

### `sync_logs`

Operational history for:

- price sync
- import jobs
- failures
- retry analysis

## Transitional Columns Added To `holdings`

The existing `holdings` table now also carries forward-compatible columns:

- `portfolio_id`
- `account_id`
- `instrument_id`
- `status`
- `opened_at`
- `closed_at`
- `book_cost_total`
- `realized_pnl_total`

These let us migrate the UI gradually without breaking the current portfolio page.

## Implementation Order

1. create default portfolio/account/instrument records for existing holdings
2. backfill holdings to those ids
3. introduce transaction write path for new operations
4. compute holdings from transactions + lots
5. add close / add / reduce workflows
6. add realized pnl and review pages
