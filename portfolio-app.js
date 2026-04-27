function generateUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const sampleHoldings = [
  {
    id: generateUuid(),
    assetType: "stock",
    platform: "IBKR",
    market: "US",
    symbol: "AAPL",
    name: "Apple",
    currency: "USD",
    quantity: 120,
    costPrice: 176.4,
    currentPrice: 198.2,
    fxRate: 1,
    targetAllocation: 18,
    notes: "核心持仓",
  },
  {
    id: generateUuid(),
    assetType: "stock",
    platform: "Futu",
    market: "US",
    symbol: "NVDA",
    name: "NVIDIA",
    currency: "USD",
    quantity: 32,
    costPrice: 881,
    currentPrice: 930,
    fxRate: 1,
    targetAllocation: 14,
    notes: "成长仓",
  },
  {
    id: generateUuid(),
    assetType: "stock",
    platform: "Phillip",
    market: "KR",
    symbol: "005930",
    name: "Samsung Electronics",
    currency: "KRW",
    quantity: 80,
    costPrice: 71300,
    currentPrice: 75600,
    fxRate: 0.00073,
    targetAllocation: 8,
    notes: "韩股",
  },
  {
    id: generateUuid(),
    assetType: "option",
    positionSide: "long",
    platform: "IBKR",
    market: "US",
    symbol: "AAPL240621C200",
    name: "Apple Jun21 200C",
    underlying: "AAPL",
    optionType: "call",
    strikePrice: 200,
    expiryDate: "2026-06-21",
    contractMultiplier: 100,
    currency: "USD",
    quantity: 3,
    costPrice: 8.5,
    currentPrice: 11.2,
    fxRate: 1,
    targetAllocation: 5,
    notes: "买入看涨",
  },
  {
    id: generateUuid(),
    assetType: "option",
    positionSide: "short",
    platform: "Tiger",
    market: "US",
    symbol: "TSLA240621P150",
    name: "Tesla Jun21 150P",
    underlying: "TSLA",
    optionType: "put",
    strikePrice: 150,
    expiryDate: "2026-06-21",
    contractMultiplier: 100,
    currency: "USD",
    quantity: 2,
    costPrice: 6.3,
    currentPrice: 4.1,
    fxRate: 1,
    targetAllocation: 3,
    notes: "卖出看跌",
  },
  {
    id: generateUuid(),
    assetType: "cash",
    platform: "Futu",
    market: "US",
    symbol: "USD-CASH",
    name: "Broker Cash",
    currency: "USD",
    quantity: 12500,
    costPrice: 1,
    currentPrice: 1,
    fxRate: 1,
    targetAllocation: 10,
    notes: "待投资现金",
  },
  {
    id: generateUuid(),
    assetType: "crypto",
    platform: "OKX",
    market: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    currency: "USDT",
    quantity: 0.86,
    costPrice: 59420,
    currentPrice: 67180,
    fxRate: 1,
    targetAllocation: 30,
    notes: "现货",
  },
  {
    id: generateUuid(),
    assetType: "crypto",
    platform: "Zhuorui",
    market: "CRYPTO",
    symbol: "ETH",
    name: "Ethereum",
    currency: "USDT",
    quantity: 7.2,
    costPrice: 2840,
    currentPrice: 3188,
    fxRate: 1,
    targetAllocation: 12,
    notes: "现货",
  },
  {
    id: generateUuid(),
    assetType: "macro",
    platform: "IBKR",
    market: "FX",
    symbol: "XAUUSD",
    name: "Gold Spot",
    currency: "USD",
    quantity: 1,
    costPrice: 3320,
    currentPrice: 3380,
    fxRate: 1,
    targetAllocation: 4,
    notes: "贵金属",
  },
];

const form = document.querySelector("#holding-form");
const authPanel = document.querySelector("#auth-panel");
const dashboard = document.querySelector("#dashboard");
const authForm = document.querySelector("#auth-form");
const authSubmitBtn = document.querySelector("#auth-submit-btn");
const logoutBtn = document.querySelector("#logout-btn");
const userBadge = document.querySelector("#user-badge");
const authStatus = document.querySelector("#auth-status");
const cancelEditBtn = document.querySelector("#cancel-edit-btn");
const refreshPricesBtn = document.querySelector("#refresh-prices-btn");
const refreshPricesBtnInline = document.querySelector("#refresh-prices-btn-inline");
const lookupPriceBtn = document.querySelector("#lookup-price-btn");
const loadSampleBtn = document.querySelector("#load-sample-btn");
const loadSampleBtnInline = document.querySelector("#load-sample-btn-inline");
const resetBtn = document.querySelector("#reset-btn");
const resetBtnInline = document.querySelector("#reset-btn-inline");
const exportBtn = document.querySelector("#export-btn");
const exportBtnInline = document.querySelector("#export-btn-inline");
const importFileInput = document.querySelector("#import-file");
const importFileInputInline = document.querySelector("#import-file-inline");
const holdingsTableBody = document.querySelector("#holdings-table-body");
const assetAllocation = document.querySelector("#asset-allocation");
const platformAllocation = document.querySelector("#platform-allocation");
const allocationGap = document.querySelector("#allocation-gap");
const assetAllocationChart = document.querySelector("#asset-allocation-chart");
const platformAllocationChart = document.querySelector("#platform-allocation-chart");
const allocationTemplate = document.querySelector("#allocation-item-template");
const syncStatus = document.querySelector("#sync-status");
const priceLookupStatus = document.querySelector("#price-lookup-status");
const priceLookupSource = document.querySelector("#price-lookup-source");
const transactionsTableBody = document.querySelector("#transactions-table-body");
const closedHoldingsTableBody = document.querySelector("#closed-holdings-table-body");
const realizedPnlTableBody = document.querySelector("#realized-pnl-table-body");
const realizedPnlChart = document.querySelector("#realized-pnl-chart");
const navSeriesTableBody = document.querySelector("#nav-series-table-body");
const navSeriesChart = document.querySelector("#nav-series-chart");
const overviewNavTrend = document.querySelector("#overview-nav-trend");
const overviewCashTrend = document.querySelector("#overview-cash-trend");
const overviewPnlTrend = document.querySelector("#overview-pnl-trend");
const reviewMetricsList = document.querySelector("#review-metrics-list");
const reviewDrawdownCard = document.querySelector("#review-drawdown-card");
const reviewReturnBandChart = document.querySelector("#review-return-band-chart");
const assetTypePnlChart = document.querySelector("#asset-type-pnl-chart");
const reviewTotalNav = document.querySelector("#review-total-nav");
const reviewRealizedPnl = document.querySelector("#review-realized-pnl");
const reviewUnrealizedPnl = document.querySelector("#review-unrealized-pnl");
const reviewCash = document.querySelector("#review-cash");
const reviewWinRate = document.querySelector("#review-win-rate");
const filterAssetType = document.querySelector("#filter-asset-type");
const filterPlatform = document.querySelector("#filter-platform");
const filterMarket = document.querySelector("#filter-market");
const sortCost = document.querySelector("#sort-cost");
const sortMarketValue = document.querySelector("#sort-market-value");
const sortPnl = document.querySelector("#sort-pnl");
const sortAllocation = document.querySelector("#sort-allocation");
const txFilterType = document.querySelector("#tx-filter-type");
const txFilterAssetType = document.querySelector("#tx-filter-asset-type");
const txFilterPlatform = document.querySelector("#tx-filter-platform");
const txSearch = document.querySelector("#tx-search");
const closedFilterAssetType = document.querySelector("#closed-filter-asset-type");
const closedFilterPlatform = document.querySelector("#closed-filter-platform");
const closedSearch = document.querySelector("#closed-search");
const rpFilterAssetType = document.querySelector("#rp-filter-asset-type");
const rpFilterPlatform = document.querySelector("#rp-filter-platform");
const rpSearch = document.querySelector("#rp-search");
const authUsername = document.querySelector("#auth-username");
const authPassword = document.querySelector("#auth-password");
const openHoldingModalBtn = document.querySelector("#open-holding-modal-btn");
const holdingModal = document.querySelector("#holding-modal");
const holdingModalBackdrop = document.querySelector("#holding-modal-backdrop");
const holdingModalTitle = document.querySelector("#holding-modal-title");
const holdingModalSubtitle = document.querySelector("#holding-modal-subtitle");
const holdingSubmitBtn = document.querySelector("#holding-submit-btn");
const tradeModal = document.querySelector("#trade-modal");
const tradeModalBackdrop = document.querySelector("#trade-modal-backdrop");
const tradeForm = document.querySelector("#trade-form");
const tradeActionLabel = document.querySelector("#trade-action-label");
const tradeSymbol = document.querySelector("#trade-symbol");
const tradeQuantityField = document.querySelector("#trade-quantity-field");
const tradeQuantityLabel = document.querySelector("#trade-quantity-label");
const tradeQuantityInput = document.querySelector("#trade-quantity");
const tradeUnitPriceLabel = document.querySelector("#trade-unit-price-label");
const tradeUnitPriceInput = document.querySelector("#trade-unit-price");
const tradeDateInput = document.querySelector("#trade-date");
const tradeFeeInput = document.querySelector("#trade-fee");
const tradeTaxInput = document.querySelector("#trade-tax");
const tradeNotesInput = document.querySelector("#trade-notes");
const tradeFormStatus = document.querySelector("#trade-form-status");
const tradeSubmitBtn = document.querySelector("#trade-submit-btn");
const tradeCancelBtn = document.querySelector("#trade-cancel-btn");
const optionSettlementModal = document.querySelector("#option-settlement-modal");
const optionSettlementModalBackdrop = document.querySelector("#option-settlement-modal-backdrop");
const optionSettlementForm = document.querySelector("#option-settlement-form");
const optionSettlementActionLabel = document.querySelector("#option-settlement-action-label");
const optionSettlementSymbol = document.querySelector("#option-settlement-symbol");
const optionSettlementQuantityInput = document.querySelector("#option-settlement-quantity");
const optionSettlementShareQuantity = document.querySelector("#option-settlement-share-quantity");
const optionSettlementStrikePrice = document.querySelector("#option-settlement-strike-price");
const optionSettlementDate = document.querySelector("#option-settlement-date");
const optionSettlementFee = document.querySelector("#option-settlement-fee");
const optionSettlementTax = document.querySelector("#option-settlement-tax");
const optionSettlementNotes = document.querySelector("#option-settlement-notes");
const optionSettlementFormStatus = document.querySelector("#option-settlement-form-status");
const optionSettlementSubmitBtn = document.querySelector("#option-settlement-submit-btn");
const optionSettlementCancelBtn = document.querySelector("#option-settlement-cancel-btn");

const fields = {
  id: document.querySelector("#holding-id"),
  assetType: document.querySelector("#asset-type"),
  platform: document.querySelector("#platform"),
  market: document.querySelector("#market"),
  positionSide: document.querySelector("#position-side"),
  symbol: document.querySelector("#symbol"),
  name: document.querySelector("#name"),
  currency: document.querySelector("#currency"),
  currencyCustom: document.querySelector("#currency-custom"),
  quantity: document.querySelector("#quantity"),
  costPrice: document.querySelector("#cost-price"),
  currentPrice: document.querySelector("#current-price"),
  fxRate: document.querySelector("#fx-rate"),
  targetAllocation: document.querySelector("#target-allocation"),
  notes: document.querySelector("#notes"),
  underlying: document.querySelector("#underlying"),
  optionType: document.querySelector("#option-type"),
  strikePrice: document.querySelector("#strike-price"),
  expiryDate: document.querySelector("#expiry-date"),
  contractMultiplier: document.querySelector("#contract-multiplier"),
};

const optionFields = document.querySelector("#option-fields");
const positionSideField = document.querySelector("#position-side-field");
const quantityLabel = document.querySelector("#quantity-label");
const costPriceLabel = document.querySelector("#cost-price-label");
const currentPriceLabel = document.querySelector("#current-price-label");
const fxRateLabel = document.querySelector("#fx-rate-label");
const costPriceField = document.querySelector("#cost-price-field");
const currentPriceField = document.querySelector("#current-price-field");

let holdings = [];
let transactions = [];
let realizedPnlEntries = [];
let reviewMetrics = null;
let navSeries = [];
let currentUser = null;
let publicConfig = null;
const activeFilters = {
  assetType: "",
  platform: "",
  market: "",
};
let activeSort = "marketValueDesc";
let priceLookupTimer = null;
let priceLookupRequestId = 0;
let activeTradeHoldingId = null;
let activeTradeAction = null;
let activeOptionSettlementHoldingId = null;
let activeHoldingMode = "create";
const chartPalette = ["#0fa06f", "#2f6fed", "#e5972f", "#e35d6a", "#7e57c2", "#0f766e", "#a855f7", "#ef4444"];
const activeTransactionFilters = {
  transactionType: "",
  assetType: "",
  platform: "",
  query: "",
};
const activeClosedFilters = {
  assetType: "",
  platform: "",
  query: "",
};
const activeRealizedPnlFilters = {
  assetType: "",
  platform: "",
  query: "",
};

function toNumber(value) {
  return Number.parseFloat(value) || 0;
}

function formatInputNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatPercent(value) {
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function formatShanghaiDateParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  return formatShanghaiDateParts(value) || (value ? String(value).slice(0, 10) : "-");
}

function getTodayInShanghai() {
  return formatShanghaiDateParts(new Date()) || new Date().toISOString().slice(0, 10);
}

function getAssetTypeLabel(value) {
  return value === "stock"
    ? "股票"
    : value === "option"
      ? "期权"
      : value === "cash"
        ? "现金"
        : value === "macro"
          ? "贵金属 / 外汇"
          : "加密货币";
}

function getSyncBadge(holding) {
  if (holding.status === "CLOSED") {
    return `<span class="chip">已清仓</span>`;
  }

  if (holding.lastPriceSyncStatus === "synced" && holding.lastPriceSyncDate) {
    return `<span class="chip chip-sync-success">已同步 ${holding.lastPriceSyncDate}</span>`;
  }

  if (holding.lastPriceSyncStatus === "failed") {
    const detail = holding.lastPriceSyncError ? ` title="${String(holding.lastPriceSyncError).replace(/"/g, "&quot;")}"` : "";
    return `<span class="chip chip-sync-warning"${detail}>等待重试</span>`;
  }

  if (holding.assetType === "option") {
    return `<span class="chip">待同步</span>`;
  }

  return "";
}

function computeHoldingMetrics(holding) {
  const quantity = toNumber(holding.quantity);
  const costPrice = toNumber(holding.costPrice);
  const currentPrice = toNumber(holding.currentPrice);
  const fxRate = toNumber(holding.fxRate) || 1;
  const contractMultiplier = toNumber(holding.contractMultiplier) || 1;

  if (holding.assetType === "cash") {
    const marketValueBase = quantity * fxRate;
    return {
      costValueBase: marketValueBase,
      marketValueBase,
      pnlBase: 0,
      pnlRate: 0,
    };
  }

  if (holding.assetType === "option") {
    const grossCost = quantity * costPrice * contractMultiplier * fxRate;
    const grossMark = quantity * currentPrice * contractMultiplier * fxRate;
    const isShort = holding.positionSide === "short";

    return {
      costValueBase: grossCost,
      marketValueBase: isShort ? -grossMark : grossMark,
      pnlBase: isShort ? grossCost - grossMark : grossMark - grossCost,
      pnlRate: grossCost > 0 ? ((isShort ? grossCost - grossMark : grossMark - grossCost) / grossCost) * 100 : 0,
    };
  }

  const costValueBase = quantity * costPrice * fxRate;
  const marketValueBase = quantity * currentPrice * fxRate;
  const pnlBase = marketValueBase - costValueBase;

  return {
    costValueBase,
    marketValueBase,
    pnlBase,
    pnlRate: costValueBase > 0 ? (pnlBase / costValueBase) * 100 : 0,
  };
}

function summarizeHoldings(source) {
  const summary = {
    totalAssets: 0,
    totalCost: 0,
    totalMarketValue: 0,
    totalPnl: 0,
    cashMarketValue: 0,
    holdingCost: 0,
    holdingMarketValue: 0,
    holdingPnl: 0,
    platformCount: new Set(),
    byAssetType: {},
    byPlatform: {},
    gaps: [],
  };

  source.forEach((holding) => {
    const metrics = computeHoldingMetrics(holding);
    summary.totalCost += metrics.costValueBase;
    summary.totalMarketValue += metrics.marketValueBase;
    summary.totalPnl += metrics.pnlBase;
    summary.platformCount.add(holding.platform);
    summary.byAssetType[holding.assetType] = (summary.byAssetType[holding.assetType] || 0) + metrics.marketValueBase;
    summary.byPlatform[holding.platform] = (summary.byPlatform[holding.platform] || 0) + metrics.marketValueBase;

    if (holding.assetType === "cash") {
      summary.cashMarketValue += metrics.marketValueBase;
    } else {
      summary.holdingCost += metrics.costValueBase;
      summary.holdingMarketValue += metrics.marketValueBase;
      summary.holdingPnl += metrics.pnlBase;
    }
  });

  summary.totalAssets = summary.holdingMarketValue + summary.cashMarketValue;

  source.forEach((holding) => {
    const metrics = computeHoldingMetrics(holding);
    const actualAllocation =
      summary.totalAssets !== 0 ? (metrics.marketValueBase / summary.totalAssets) * 100 : 0;
    const targetAllocation = toNumber(holding.targetAllocation);

    if (targetAllocation > 0) {
      summary.gaps.push({
        label: `${holding.symbol} · ${holding.platform}`,
        actualAllocation,
        targetAllocation,
        gap: actualAllocation - targetAllocation,
      });
    }
  });

  summary.gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return summary;
}

function updateSummaryCards(summary) {
  document.querySelector("#total-assets").textContent = formatMoney(summary.totalAssets);
  document.querySelector("#total-cash").textContent = formatMoney(summary.cashMarketValue);
  document.querySelector("#total-market-value").textContent = formatMoney(summary.holdingMarketValue);

  const pnlNode = document.querySelector("#total-pnl");
  pnlNode.textContent = formatMoney(summary.holdingPnl);
  pnlNode.className = `metric-value ${summary.holdingPnl >= 0 ? "gain" : "loss"}`;

  const pnlRate = summary.holdingCost > 0 ? (summary.holdingPnl / summary.holdingCost) * 100 : 0;
  document.querySelector("#total-pnl-rate").textContent = `持仓收益率 ${formatPercent(pnlRate)}`;
}

function renderAllocationList(container, items, labelMap, totalMarketValue) {
  if (!items.length) {
    container.classList.add("empty-state");
    container.innerHTML = "暂无数据";
    return;
  }

  container.classList.remove("empty-state");
  container.innerHTML = "";

  items.forEach(([key, value]) => {
    const ratio = totalMarketValue !== 0 ? (value / totalMarketValue) * 100 : 0;
    const fragment = allocationTemplate.content.cloneNode(true);
    fragment.querySelector(".stack-title").textContent = labelMap[key] || key;
    fragment.querySelector(".stack-caption").textContent = `占比 ${ratio.toFixed(2)}%`;
    fragment.querySelector(".stack-value").textContent = formatMoney(value);
    container.appendChild(fragment);
  });
}

function getChartColor(index) {
  return chartPalette[index % chartPalette.length];
}

function renderRingChart(container, items, labelMap, totalMarketValue) {
  if (!container) return;
  if (!items.length || !totalMarketValue) {
    container.className = "mini-chart empty-state";
    container.textContent = "暂无图表数据";
    return;
  }

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const slices = items.map(([key, value], index) => {
    const ratio = Math.abs(value) / Math.abs(totalMarketValue || 1);
    const length = circumference * ratio;
    const color = getChartColor(index);
    const strokeDasharray = `${length} ${Math.max(circumference - length, 0)}`;
    const strokeDashoffset = -offset;
    offset += length;
    return {
      key,
      value,
      ratio,
      color,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  container.className = "mini-chart";
  container.innerHTML = `
    <div class="ring-chart">
      <svg class="ring-chart-svg" viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r="${radius}" fill="none" stroke="rgba(19, 27, 46, 0.08)" stroke-width="20"></circle>
        ${slices
          .map(
            (slice) => `
              <circle
                cx="90"
                cy="90"
                r="${radius}"
                fill="none"
                stroke="${slice.color}"
                stroke-width="20"
                stroke-linecap="butt"
                stroke-dasharray="${slice.strokeDasharray}"
                stroke-dashoffset="${slice.strokeDashoffset}"
                transform="rotate(-90 90 90)"
              ></circle>
            `
          )
          .join("")}
        <text x="90" y="84" text-anchor="middle" font-size="12" fill="#566274">总市值</text>
        <text x="90" y="104" text-anchor="middle" font-size="16" font-weight="700" fill="#131b2e">${formatMoney(totalMarketValue)}</text>
      </svg>
      <div class="ring-chart-legend">
        ${slices
          .map(
            (slice) => `
              <article class="ring-legend-item">
                <span class="ring-legend-dot" style="background:${slice.color}"></span>
                <div class="ring-legend-label">
                  <strong>${escapeHtml(labelMap[slice.key] || slice.key)}</strong>
                  <span>占比 ${(slice.ratio * 100).toFixed(2)}%</span>
                </div>
                <strong class="ring-legend-value">${formatMoney(slice.value)}</strong>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderGapList(gaps) {
  if (!gaps.length) {
    allocationGap.classList.add("empty-state");
    allocationGap.innerHTML = "录入目标仓位后，这里会显示实际仓位和目标之间的差值。";
    return;
  }

  allocationGap.classList.remove("empty-state");
  allocationGap.innerHTML = "";

  gaps.slice(0, 6).forEach((item) => {
    const article = document.createElement("article");
    article.className = "gap-item";
    const direction = item.gap >= 0 ? "超配" : "低配";
    article.innerHTML = `
      <div>
        <strong class="stack-title">${item.label}</strong>
        <span class="stack-caption">目标 ${item.targetAllocation.toFixed(2)}% / 实际 ${item.actualAllocation.toFixed(2)}%</span>
      </div>
      <strong class="gap-value ${item.gap >= 0 ? "gain" : "loss"}">${direction} ${formatPercent(item.gap)}</strong>
    `;
    allocationGap.appendChild(article);
  });
}

function renderRealizedPnlChart() {
  if (!realizedPnlChart) return;
  const rows = getFilteredRealizedPnl()
    .slice()
    .sort((a, b) => Math.abs(b.realizedPnlUsd || 0) - Math.abs(a.realizedPnlUsd || 0))
    .slice(0, 8);

  if (!rows.length) {
    realizedPnlChart.className = "mini-chart empty-state";
    realizedPnlChart.textContent = "还没有已实现盈亏图表数据。";
    return;
  }

  const maxAbs = Math.max(...rows.map((entry) => Math.abs(entry.realizedPnlUsd || 0)), 1);
  realizedPnlChart.className = "mini-chart";
  realizedPnlChart.innerHTML = `
    <div class="pnl-bar-chart">
      ${rows
        .map((entry) => {
          const value = Number(entry.realizedPnlUsd || 0);
          const width = `${(Math.abs(value) / maxAbs) * 50}%`;
          return `
            <article class="pnl-bar-row">
              <div class="pnl-bar-label">
                <strong>${escapeHtml(entry.symbol || "-")}</strong>
                <span>${formatDate(entry.recognizedDate)}</span>
              </div>
              <div class="pnl-bar-track">
                <span class="pnl-bar-fill ${value >= 0 ? "gain" : "loss"}" style="width:${width}"></span>
              </div>
              <strong class="pnl-bar-value ${value >= 0 ? "gain" : "loss"}">${formatMoney(value)}</strong>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function getActiveHoldings(source = holdings) {
  return source.filter((holding) => holding.status !== "CLOSED" && Number(holding.quantity || 0) !== 0);
}

function getFilteredHoldings(source = getActiveHoldings()) {
  return source.filter((holding) => {
    if (activeFilters.assetType && activeFilters.assetType !== holding.assetType) return false;
    if (activeFilters.platform && activeFilters.platform !== holding.platform) return false;
    if (activeFilters.market && activeFilters.market !== holding.market) return false;
    return true;
  });
}

function renderFilterGroup(container, values, selectedValue, formatter = (value) => value) {
  if (!container) return;
  const sortedValues = [...new Set(values)].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
  container.innerHTML = `<option value="">全部</option>${sortedValues
    .map((value) => `<option value="${value}" ${selectedValue === value ? "selected" : ""}>${formatter(value)}</option>`)
    .join("")}`;
}

function getTransactionTypeLabel(value) {
  return value === "OPENING_BALANCE"
    ? "初始持仓"
    : value === "SNAPSHOT_ADJUSTMENT"
      ? "快照调整"
      : value === "ADD_POSITION"
        ? "加仓"
        : value === "REDUCE_POSITION"
          ? "减仓"
          : value === "CLOSE_POSITION"
            ? "清仓"
            : value === "OPTION_EXERCISE"
              ? "期权行权"
            : value === "OPTION_ASSIGNMENT"
                ? "期权指派"
                : value === "OPTION_EXPIRE"
                  ? "到期作废"
                : value === "OPTION_STOCK_IN"
                  ? "交割入股"
                  : value === "OPTION_STOCK_OUT"
                    ? "交割卖股"
            : value === "CASH_INFLOW"
              ? "现金流入"
              : value === "CASH_OUTFLOW"
                ? "现金流出"
                : value;
}

function renderFilters() {
  const activeHoldings = getActiveHoldings();
  renderFilterGroup(filterAssetType, activeHoldings.map((holding) => holding.assetType), activeFilters.assetType, getAssetTypeLabel);
  renderFilterGroup(filterPlatform, activeHoldings.map((holding) => holding.platform), activeFilters.platform);
  renderFilterGroup(filterMarket, activeHoldings.map((holding) => holding.market), activeFilters.market);
}

function getFilteredTransactions(source = transactions) {
  const keyword = activeTransactionFilters.query.trim().toLowerCase();
  return source.filter((transaction) => {
    if (activeTransactionFilters.transactionType && activeTransactionFilters.transactionType !== transaction.transactionType) return false;
    if (activeTransactionFilters.assetType && activeTransactionFilters.assetType !== transaction.assetType) return false;
    if (activeTransactionFilters.platform && activeTransactionFilters.platform !== transaction.platform) return false;
    if (keyword) {
      const haystack = [
        transaction.symbol,
        transaction.name,
        transaction.notes,
        transaction.accountName,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function renderTransactionFilters() {
  renderFilterGroup(txFilterType, transactions.map((transaction) => transaction.transactionType), activeTransactionFilters.transactionType, getTransactionTypeLabel);
  renderFilterGroup(txFilterAssetType, transactions.map((transaction) => transaction.assetType), activeTransactionFilters.assetType, getAssetTypeLabel);
  renderFilterGroup(txFilterPlatform, transactions.map((transaction) => transaction.platform), activeTransactionFilters.platform);
  if (txSearch) {
    txSearch.value = activeTransactionFilters.query;
  }
}

function getFilteredClosedHoldings(source = holdings) {
  const keyword = activeClosedFilters.query.trim().toLowerCase();
  return source.filter((holding) => {
    if (holding.status !== "CLOSED") return false;
    if (activeClosedFilters.assetType && activeClosedFilters.assetType !== holding.assetType) return false;
    if (activeClosedFilters.platform && activeClosedFilters.platform !== holding.platform) return false;
    if (keyword) {
      const haystack = [holding.symbol, holding.name, holding.notes].join(" ").toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function renderClosedHoldingFilters() {
  const closedHoldings = holdings.filter((holding) => holding.status === "CLOSED");
  renderFilterGroup(closedFilterAssetType, closedHoldings.map((holding) => holding.assetType), activeClosedFilters.assetType, getAssetTypeLabel);
  renderFilterGroup(closedFilterPlatform, closedHoldings.map((holding) => holding.platform), activeClosedFilters.platform);
  if (closedSearch) {
    closedSearch.value = activeClosedFilters.query;
  }
}

function getFilteredRealizedPnl(source = realizedPnlEntries) {
  const keyword = activeRealizedPnlFilters.query.trim().toLowerCase();
  return source.filter((entry) => {
    if (activeRealizedPnlFilters.assetType && activeRealizedPnlFilters.assetType !== entry.assetType) return false;
    if (activeRealizedPnlFilters.platform && activeRealizedPnlFilters.platform !== entry.platform) return false;
    if (keyword) {
      const haystack = [entry.symbol, entry.name, entry.notes, entry.accountName].join(" ").toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function renderRealizedPnlFilters() {
  renderFilterGroup(rpFilterAssetType, realizedPnlEntries.map((entry) => entry.assetType), activeRealizedPnlFilters.assetType, getAssetTypeLabel);
  renderFilterGroup(rpFilterPlatform, realizedPnlEntries.map((entry) => entry.platform), activeRealizedPnlFilters.platform);
  if (rpSearch) {
    rpSearch.value = activeRealizedPnlFilters.query;
  }
}

function renderTable(summary) {
  const filteredHoldings = getFilteredHoldings();

  if (!filteredHoldings.length) {
    holdingsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-row">当前没有持仓，已平仓记录可以去“历史已清仓”里查看。</td>
      </tr>
    `;
    return;
  }

  const rows = [...filteredHoldings]
    .sort((a, b) => {
      const metricsA = computeHoldingMetrics(a);
      const metricsB = computeHoldingMetrics(b);
      const allocationA = summary.totalMarketValue !== 0 ? (metricsA.marketValueBase / summary.totalMarketValue) * 100 : 0;
      const allocationB = summary.totalMarketValue !== 0 ? (metricsB.marketValueBase / summary.totalMarketValue) * 100 : 0;

      if (activeSort === "costDesc") return metricsB.costValueBase - metricsA.costValueBase;
      if (activeSort === "costAsc") return metricsA.costValueBase - metricsB.costValueBase;
      if (activeSort === "pnlDesc") return metricsB.pnlBase - metricsA.pnlBase;
      if (activeSort === "pnlAsc") return metricsA.pnlBase - metricsB.pnlBase;
      if (activeSort === "allocationDesc") return allocationB - allocationA;
      if (activeSort === "allocationAsc") return allocationA - allocationB;
      if (activeSort === "marketValueAsc") return metricsA.marketValueBase - metricsB.marketValueBase;
      return metricsB.marketValueBase - metricsA.marketValueBase;
    })
    .map((holding) => {
      const metrics = computeHoldingMetrics(holding);
      const allocation = summary.totalMarketValue !== 0 ? (metrics.marketValueBase / summary.totalMarketValue) * 100 : 0;

      return `
        <tr>
          <td>
            <div class="asset-meta">
              <strong>${holding.symbol}</strong>
              <span class="muted">${holding.name}</span>
              <div class="chip-row">
                <span class="chip">${getAssetTypeLabel(holding.assetType)}</span>
                ${holding.assetType === "option" ? `<span class="chip">${holding.positionSide === "short" ? "卖方" : "买方"}</span>` : ""}
                ${holding.assetType === "option" ? `<span class="chip">${(holding.optionType || "call").toUpperCase()} ${holding.strikePrice || "-"}</span>` : ""}
                ${holding.assetType === "option" && holding.expiryDate ? `<span class="chip">${holding.expiryDate}</span>` : ""}
                ${getSyncBadge(holding)}
                ${holding.notes ? `<span class="chip">${holding.notes}</span>` : ""}
              </div>
              ${holding.assetType === "option" && holding.underlying ? `<span class="muted">标的 ${holding.underlying}</span>` : ""}
            </div>
          </td>
          <td>${holding.platform}</td>
          <td>${holding.market}</td>
          <td>${holding.quantity}${holding.assetType === "option" ? " 张" : holding.assetType === "cash" ? ` ${holding.currency}` : ""}</td>
          <td>
            <div class="asset-meta">
              <strong>${formatMoney(metrics.costValueBase)}</strong>
              <span class="muted">
                ${
                  holding.assetType === "cash"
                    ? `现金面额 ${holding.quantity} ${holding.currency}`
                    : holding.assetType === "option" && holding.positionSide === "short"
                      ? "收取权利金"
                      : "建仓价格"
                }
                ${holding.assetType === "cash" ? "" : `${holding.costPrice} ${holding.currency}`}
              </span>
            </div>
          </td>
          <td>
            <div class="asset-meta">
              <strong>${formatMoney(metrics.marketValueBase)}</strong>
              <span class="muted">
                ${
                  holding.assetType === "cash"
                    ? `兑美元汇率 ${holding.fxRate}`
                    : holding.assetType === "option" && holding.positionSide === "short"
                      ? "当前回补负债"
                      : "当前价格"
                }
                ${holding.assetType === "cash" ? "" : `${holding.currentPrice} ${holding.currency}`}
              </span>
            </div>
          </td>
          <td class="${metrics.pnlBase >= 0 ? "gain" : "loss"}">
            <div class="asset-meta">
              <strong>${formatMoney(metrics.pnlBase)}</strong>
              <span>${formatPercent(metrics.pnlRate)}</span>
            </div>
          </td>
          <td>${allocation.toFixed(2)}%</td>
          <td>
            <div class="table-actions">
              ${holding.status !== "CLOSED" && holding.assetType === "option" ? `<button class="inline-button" data-action="option-expire" data-id="${holding.id}">到期</button>` : ""}
              ${holding.status !== "CLOSED" && holding.assetType === "option" ? `<button class="inline-button" data-action="option-settlement" data-id="${holding.id}">${holding.positionSide === "short" ? "指派" : "行权"}</button>` : ""}
              ${holding.status !== "CLOSED" ? `<button class="inline-button" data-action="add-position" data-id="${holding.id}">加仓</button>` : ""}
              ${holding.status !== "CLOSED" && holding.assetType !== "cash" ? `<button class="inline-button" data-action="reduce-position" data-id="${holding.id}">减仓</button>` : ""}
              ${holding.status !== "CLOSED" ? `<button class="inline-button" data-action="close-position" data-id="${holding.id}">清仓</button>` : ""}
              <button class="inline-button" data-action="refresh-price" data-id="${holding.id}">刷新</button>
              <button class="inline-button" data-action="edit" data-id="${holding.id}">编辑</button>
              <button class="inline-button delete" data-action="delete" data-id="${holding.id}">删除</button>
            </div>
          </td>
        </tr>
      `;
    });

  holdingsTableBody.innerHTML = rows.join("");
}

function renderTransactionsTable() {
  renderTransactionFilters();
  const rows = getFilteredTransactions();

  if (!rows.length) {
    transactionsTableBody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-row">还没有交易流水，先做一次加仓、减仓或清仓后，这里就会开始累积记录。</td>
      </tr>
    `;
    return;
  }

  transactionsTableBody.innerHTML = rows
    .map((transaction) => `
      <tr>
        <td>${formatDate(transaction.tradeDate)}</td>
        <td><span class="chip">${getTransactionTypeLabel(transaction.transactionType)}</span></td>
        <td>
          <div class="asset-meta">
            <strong>${transaction.symbol || "-"}</strong>
            <span class="muted">${transaction.name || ""}</span>
            <div class="chip-row">
              ${transaction.assetType ? `<span class="chip">${getAssetTypeLabel(transaction.assetType)}</span>` : ""}
              ${transaction.accountName ? `<span class="chip">${transaction.accountName}</span>` : ""}
            </div>
          </div>
        </td>
        <td>${transaction.platform || "-"}</td>
        <td>${transaction.notes ? escapeHtml(transaction.notes) : "-"}</td>
        <td>${transaction.quantity || 0}</td>
        <td>${transaction.unitPrice ? `${transaction.unitPrice} ${transaction.tradeCurrency}` : `0 ${transaction.tradeCurrency || ""}`}</td>
        <td class="${transaction.netAmount >= 0 ? "gain" : "loss"}">${transaction.tradeCurrency ? `${transaction.netAmount.toFixed(2)} ${transaction.tradeCurrency}` : transaction.netAmount.toFixed(2)}</td>
        <td class="${transaction.realizedPnlAmount >= 0 ? "gain" : "loss"}">${formatMoney(transaction.realizedPnlAmount || 0)}</td>
        <td>${transaction.sourceRef || "-"}</td>
        <td>
          ${
            ["OPENING_BALANCE", "ADD_POSITION", "REDUCE_POSITION", "CLOSE_POSITION", "SNAPSHOT_ADJUSTMENT"].includes(transaction.transactionType)
              ? `<button class="inline-button delete" data-action="revert-transaction" data-id="${transaction.id}">撤销</button>`
              : "-"
          }
        </td>
      </tr>
    `)
    .join("");
}

function renderClosedHoldingsTable() {
  renderClosedHoldingFilters();

  if (!closedHoldingsTableBody) return;
  const rows = getFilteredClosedHoldings();

  if (!rows.length) {
    closedHoldingsTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-row">还没有已清仓仓位，完成一次清仓后这里会自动归档。</td>
      </tr>
    `;
    return;
  }

  closedHoldingsTableBody.innerHTML = rows
    .sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")))
    .map((holding) => `
      <tr>
        <td>${formatDate(holding.closedAt)}</td>
        <td>
          <div class="asset-meta">
            <strong>${holding.symbol}</strong>
            <span class="muted">${holding.name}</span>
            <div class="chip-row">
              <span class="chip">${getAssetTypeLabel(holding.assetType)}</span>
              <span class="chip">${holding.market}</span>
            </div>
          </div>
        </td>
        <td>${holding.platform}</td>
        <td>${holding.notes ? escapeHtml(holding.notes) : "-"}</td>
        <td>${holding.currentPrice ? `${holding.currentPrice} ${holding.currency}` : "-"}</td>
        <td class="${holding.realizedPnlTotal >= 0 ? "gain" : "loss"}">${formatMoney(holding.realizedPnlTotal || 0)}</td>
        <td>${holding.notes || "-"}</td>
      </tr>
    `)
    .join("");
}

function renderRealizedPnlTable() {
  renderRealizedPnlFilters();

  if (!realizedPnlTableBody) return;
  const rows = getFilteredRealizedPnl();

  if (!rows.length) {
    realizedPnlTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-row">还没有已实现盈亏记录，完成一次减仓或清仓后这里会自动出现。</td>
      </tr>
    `;
    return;
  }

  realizedPnlTableBody.innerHTML = rows
    .map((entry) => `
      <tr>
        <td>${formatDate(entry.recognizedDate)}</td>
        <td>
          <div class="asset-meta">
            <strong>${entry.symbol || "-"}</strong>
            <span class="muted">${entry.name || ""}</span>
            <div class="chip-row">
              ${entry.assetType ? `<span class="chip">${getAssetTypeLabel(entry.assetType)}</span>` : ""}
              ${entry.accountName ? `<span class="chip">${entry.accountName}</span>` : ""}
            </div>
          </div>
        </td>
        <td>${entry.platform || "-"}</td>
        <td>${entry.notes ? escapeHtml(entry.notes) : "-"}</td>
        <td>${entry.quantityClosed || 0}</td>
        <td>${entry.tradeCurrency ? `${entry.proceedsAmount.toFixed(2)} ${entry.tradeCurrency}` : entry.proceedsAmount.toFixed(2)}</td>
        <td>${entry.tradeCurrency ? `${entry.costAmount.toFixed(2)} ${entry.tradeCurrency}` : entry.costAmount.toFixed(2)}</td>
        <td class="${entry.realizedPnlUsd >= 0 ? "gain" : "loss"}">${formatMoney(entry.realizedPnlUsd || 0)}</td>
        <td>${entry.notes || "-"}</td>
      </tr>
    `)
    .join("");
}

function renderReviewMetricsSection() {
  if (reviewTotalNav) {
    reviewTotalNav.textContent = formatMoney(reviewMetrics?.totalNavUsd || 0);
  }
  if (reviewRealizedPnl) {
    reviewRealizedPnl.textContent = formatMoney(reviewMetrics?.realizedPnlUsd || 0);
    reviewRealizedPnl.className = `metric-value ${(reviewMetrics?.realizedPnlUsd || 0) >= 0 ? "gain" : "loss"}`;
  }
  if (reviewUnrealizedPnl) {
    reviewUnrealizedPnl.textContent = formatMoney(reviewMetrics?.unrealizedPnlUsd || 0);
    reviewUnrealizedPnl.className = `metric-value ${(reviewMetrics?.unrealizedPnlUsd || 0) >= 0 ? "gain" : "loss"}`;
  }
  if (reviewCash) {
    reviewCash.textContent = formatMoney(reviewMetrics?.currentCashUsd || 0);
  }
  if (reviewWinRate) {
    reviewWinRate.textContent = `胜率 ${formatPercent(reviewMetrics?.winRate || 0)}`;
  }

  if (!reviewMetricsList) return;
  const metrics = reviewMetrics || {};
  const hasDistinctWorstTrade = Number(metrics.closedTrades || 0) > 1;
  const items = [
    { title: "总盈亏", caption: "已实现 + 未实现", value: formatMoney(metrics.totalPnlUsd || 0), tone: (metrics.totalPnlUsd || 0) >= 0 ? "gain" : "loss" },
    { title: "已完成交易", caption: `盈利 ${metrics.winningTrades || 0} / 亏损 ${metrics.losingTrades || 0} / 持平 ${metrics.flatTrades || 0}`, value: String(metrics.closedTrades || 0) },
    { title: "平均盈利交易", caption: "仅统计已实现盈利交易", value: formatMoney(metrics.avgWinUsd || 0), tone: "gain" },
    { title: "平均亏损交易", caption: "仅统计已实现亏损交易", value: formatMoney(metrics.avgLossUsd || 0), tone: "loss" },
    { title: "最佳交易", caption: metrics.bestTrade ? `${metrics.bestTrade.symbol} · ${metrics.bestTrade.platform} · ${formatDate(metrics.bestTrade.recognizedDate)}` : "暂无", value: formatMoney(metrics.bestTrade?.realizedPnlUsd || 0), tone: "gain" },
    ...(hasDistinctWorstTrade
      ? [{ title: "最差交易", caption: metrics.worstTrade ? `${metrics.worstTrade.symbol} · ${metrics.worstTrade.platform} · ${formatDate(metrics.worstTrade.recognizedDate)}` : "暂无", value: formatMoney(metrics.worstTrade?.realizedPnlUsd || 0), tone: "loss" }]
      : []),
  ];

  reviewMetricsList.classList.remove("empty-state");
  reviewMetricsList.innerHTML = items
    .map((item) => `
      <article class="stack-item">
        <div>
          <strong class="stack-title">${item.title}</strong>
          <span class="stack-caption">${item.caption}</span>
        </div>
        <strong class="stack-value ${item.tone || ""}">${item.value}</strong>
      </article>
    `)
    .join("");
}

function buildLinePath(points, width, height, padding) {
  if (!points.length) return "";
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  return points
    .map((point, index) => {
      const x = padding + stepX * index;
      const y = height - padding - ((point.value - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function computeNavStats(series = navSeries) {
  const sorted = [...series]
    .filter((entry) => entry && entry.snapshotDate)
    .sort((a, b) => String(a.snapshotDate || "").localeCompare(String(b.snapshotDate || "")));

  if (!sorted.length) {
    return {
      sorted,
      maxDrawdownPct: 0,
      maxDrawdownValue: 0,
      peakDate: null,
      troughDate: null,
      periodReturnPct: 0,
      bestDayReturnPct: 0,
      worstDayReturnPct: 0,
    };
  }

  let peak = Number(sorted[0].navUsd || 0);
  let peakDate = sorted[0].snapshotDate;
  let maxDrawdownPct = 0;
  let maxDrawdownValue = 0;
  let troughDate = sorted[0].snapshotDate;
  let bestDayReturnPct = -Infinity;
  let worstDayReturnPct = Infinity;

  sorted.forEach((entry, index) => {
    const nav = Number(entry.navUsd || 0);
    if (nav > peak) {
      peak = nav;
      peakDate = entry.snapshotDate;
    }

    const drawdownValue = peak - nav;
    const drawdownPct = peak > 0 ? (drawdownValue / peak) * 100 : 0;
    if (drawdownPct > maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      maxDrawdownValue = drawdownValue;
      troughDate = entry.snapshotDate;
    }

    if (index > 0) {
      const prev = Number(sorted[index - 1].navUsd || 0);
      const returnPct = prev > 0 ? ((nav - prev) / prev) * 100 : 0;
      bestDayReturnPct = Math.max(bestDayReturnPct, returnPct);
      worstDayReturnPct = Math.min(worstDayReturnPct, returnPct);
    }
  });

  const first = Number(sorted[0].navUsd || 0);
  const last = Number(sorted.at(-1)?.navUsd || 0);
  const periodReturnPct = first > 0 ? ((last - first) / first) * 100 : 0;

  return {
    sorted,
    maxDrawdownPct,
    maxDrawdownValue,
    peakDate,
    troughDate,
    periodReturnPct,
    bestDayReturnPct: Number.isFinite(bestDayReturnPct) ? bestDayReturnPct : 0,
    worstDayReturnPct: Number.isFinite(worstDayReturnPct) ? worstDayReturnPct : 0,
  };
}

function renderSparkline(container, series, key, label) {
  if (!container) return;
  const sorted = [...series]
    .filter((entry) => entry && entry.snapshotDate)
    .sort((a, b) => String(a.snapshotDate || "").localeCompare(String(b.snapshotDate || "")));

  if (sorted.length < 2) {
    container.className = "sparkline-card empty-state";
    container.textContent = `还没有足够的${label}快照。`;
    return;
  }

  const points = sorted.map((entry) => ({
    label: formatDate(entry.snapshotDate),
    value: Number(entry[key] || 0),
  }));
  const width = 320;
  const height = 100;
  const padding = 10;
  const path = buildLinePath(points, width, height, padding);
  const first = points[0].value;
  const last = points.at(-1)?.value || 0;
  const delta = last - first;

  container.className = "sparkline-card";
  container.innerHTML = `
    <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path}" fill="none" stroke="${delta >= 0 ? "#0fa06f" : "#e35d6a"}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <div class="sparkline-meta">
      <div class="sparkline-meta-block">
        <span>起点</span>
        <strong>${formatMoney(first)}</strong>
      </div>
      <div class="sparkline-meta-block">
        <span>最新</span>
        <strong>${formatMoney(last)}</strong>
      </div>
      <div class="sparkline-meta-block">
        <span>变化</span>
        <strong class="${delta >= 0 ? "gain" : "loss"}">${formatMoney(delta)}</strong>
      </div>
    </div>
  `;
}

function renderNavSeriesChart() {
  if (!navSeriesChart) return;
  if (!navSeries.length) {
    navSeriesChart.className = "nav-chart empty-state";
    navSeriesChart.textContent = "还没有历史净值曲线，系统会从今天开始持续沉淀。";
    return;
  }

  const sorted = [...navSeries].sort((a, b) => String(a.snapshotDate || "").localeCompare(String(b.snapshotDate || "")));
  const points = sorted.map((entry) => ({
    label: formatDate(entry.snapshotDate),
    value: Number(entry.navUsd || 0),
  }));
  const width = 760;
  const height = 240;
  const padding = 26;
  const path = buildLinePath(points, width, height, padding);
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  navSeriesChart.className = "nav-chart";
  navSeriesChart.innerHTML = `
    <svg class="nav-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="navLine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2f6fed"></stop>
          <stop offset="100%" stop-color="#0fa06f"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(19,27,46,0.08)" stroke-width="1"></line>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="rgba(19,27,46,0.08)" stroke-width="1"></line>
      <path d="${path}" fill="none" stroke="url(#navLine)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
    </svg>
    <div class="nav-chart-meta">
      <span>最低净值 ${formatMoney(min)}</span>
      <span>最高净值 ${formatMoney(max)}</span>
      <span>最新净值 ${formatMoney(points.at(-1)?.value || 0)}</span>
    </div>
  `;
}

function renderReviewDrawdownCard() {
  if (!reviewDrawdownCard) return;
  const stats = computeNavStats();
  if (stats.sorted.length < 2) {
    reviewDrawdownCard.className = "stack-list empty-state";
    reviewDrawdownCard.textContent = "还没有足够的净值快照来计算最大回撤。";
    return;
  }

  reviewDrawdownCard.className = "stack-list";
  reviewDrawdownCard.innerHTML = `
    <article class="stack-item">
      <div>
        <strong class="stack-title">最大回撤</strong>
        <span class="stack-caption">从 ${formatDate(stats.peakDate)} 到 ${formatDate(stats.troughDate)}</span>
      </div>
      <strong class="stack-value loss">${formatPercent(stats.maxDrawdownPct)}</strong>
    </article>
    <article class="stack-item">
      <div>
        <strong class="stack-title">回撤金额</strong>
        <span class="stack-caption">峰值净值到低点净值的回落幅度</span>
      </div>
      <strong class="stack-value loss">${formatMoney(stats.maxDrawdownValue)}</strong>
    </article>
  `;
}

function renderReturnBandChart() {
  if (!reviewReturnBandChart) return;
  const stats = computeNavStats();
  if (stats.sorted.length < 2) {
    reviewReturnBandChart.className = "mini-chart empty-state";
    reviewReturnBandChart.textContent = "还没有足够的收益区间图表数据。";
    return;
  }

  const items = [
    { title: "区间收益", caption: "首个快照到最新快照", value: stats.periodReturnPct },
    { title: "最佳日收益", caption: "单日净值变动最大正值", value: stats.bestDayReturnPct },
    { title: "最差日收益", caption: "单日净值变动最大负值", value: stats.worstDayReturnPct },
  ];
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.value)), 1);

  reviewReturnBandChart.className = "mini-chart";
  reviewReturnBandChart.innerHTML = `
    <div class="pnl-bar-chart">
      ${items
        .map((item) => {
          const width = `${(Math.abs(item.value) / maxAbs) * 50}%`;
          return `
            <article class="pnl-bar-row">
              <div class="pnl-bar-label">
                <strong>${item.title}</strong>
                <span>${item.caption}</span>
              </div>
              <div class="pnl-bar-track">
                <span class="pnl-bar-fill ${item.value >= 0 ? "gain" : "loss"}" style="width:${width}"></span>
              </div>
              <strong class="pnl-bar-value ${item.value >= 0 ? "gain" : "loss"}">${formatPercent(item.value)}</strong>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAssetTypePnlChart() {
  if (!assetTypePnlChart) return;

  const totals = new Map();
  holdings.forEach((holding) => {
    const key = holding.assetType || "unknown";
    const current = totals.get(key) || 0;
    totals.set(key, current + computeHoldingMetrics(holding).pnlBase);
  });

  realizedPnlEntries.forEach((entry) => {
    const key = entry.assetType || "unknown";
    const current = totals.get(key) || 0;
    totals.set(key, current + Number(entry.realizedPnlUsd || 0));
  });

  const rows = [...totals.entries()]
    .map(([assetType, pnl]) => ({ assetType, pnl }))
    .filter((item) => Math.abs(item.pnl) > 0)
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  if (!rows.length) {
    assetTypePnlChart.className = "mini-chart empty-state";
    assetTypePnlChart.textContent = "还没有足够的资产类型收益对比数据。";
    return;
  }

  const maxAbs = Math.max(...rows.map((item) => Math.abs(item.pnl)), 1);
  assetTypePnlChart.className = "mini-chart";
  assetTypePnlChart.innerHTML = `
    <div class="pnl-bar-chart">
      ${rows
        .map((item) => {
          const width = `${(Math.abs(item.pnl) / maxAbs) * 50}%`;
          return `
            <article class="pnl-bar-row">
              <div class="pnl-bar-label">
                <strong>${getAssetTypeLabel(item.assetType)}</strong>
                <span>已实现 + 未实现</span>
              </div>
              <div class="pnl-bar-track">
                <span class="pnl-bar-fill ${item.pnl >= 0 ? "gain" : "loss"}" style="width:${width}"></span>
              </div>
              <strong class="pnl-bar-value ${item.pnl >= 0 ? "gain" : "loss"}">${formatMoney(item.pnl)}</strong>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderNavSeriesTable() {
  if (!navSeriesTableBody) return;
  if (!navSeries.length) {
    navSeriesTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-row">还没有历史净值快照，系统会从今天开始持续沉淀。</td>
      </tr>
    `;
    return;
  }

  navSeriesTableBody.innerHTML = [...navSeries]
    .sort((a, b) => String(b.snapshotDate || "").localeCompare(String(a.snapshotDate || "")))
    .map((entry) => `
      <tr>
        <td>${formatDate(entry.snapshotDate)}</td>
        <td>${formatMoney(entry.navUsd || 0)}</td>
        <td>${formatMoney(entry.cashUsd || 0)}</td>
        <td>${formatMoney(entry.marketValueUsd || 0)}</td>
        <td class="${(entry.unrealizedPnlUsd || 0) >= 0 ? "gain" : "loss"}">${formatMoney(entry.unrealizedPnlUsd || 0)}</td>
        <td class="${(entry.realizedPnlUsd || 0) >= 0 ? "gain" : "loss"}">${formatMoney(entry.realizedPnlUsd || 0)}</td>
        <td class="${(entry.totalPnlUsd || 0) >= 0 ? "gain" : "loss"}">${formatMoney(entry.totalPnlUsd || 0)}</td>
      </tr>
    `)
    .join("");
}

function renderDashboard() {
  const activeHoldings = getActiveHoldings();
  const summary = summarizeHoldings(activeHoldings);
  updateSummaryCards(summary);
  renderFilters();
  renderAllocationList(assetAllocation, Object.entries(summary.byAssetType), { stock: "股票", option: "期权", cash: "现金", crypto: "加密货币", macro: "贵金属 / 外汇" }, summary.totalMarketValue);
  renderAllocationList(platformAllocation, Object.entries(summary.byPlatform), {}, summary.totalMarketValue);
  renderRingChart(assetAllocationChart, Object.entries(summary.byAssetType), { stock: "股票", option: "期权", cash: "现金", crypto: "加密货币", macro: "贵金属 / 外汇" }, summary.totalMarketValue);
  renderRingChart(platformAllocationChart, Object.entries(summary.byPlatform), {}, summary.totalMarketValue);
  renderGapList(summary.gaps);
  renderSparkline(overviewNavTrend, navSeries, "navUsd", "净值");
  renderSparkline(overviewCashTrend, navSeries, "cashUsd", "现金");
  renderSparkline(overviewPnlTrend, navSeries, "totalPnlUsd", "盈亏");
  renderTable(summary);
  renderTransactionsTable();
  renderClosedHoldingsTable();
  renderRealizedPnlTable();
  renderRealizedPnlChart();
  renderReviewMetricsSection();
  renderReviewDrawdownCard();
  renderReturnBandChart();
  renderAssetTypePnlChart();
  renderNavSeriesChart();
  renderNavSeriesTable();
}

function getCurrencyValue() {
  return fields.currency.value === "CUSTOM"
    ? fields.currencyCustom.value.trim().toUpperCase()
    : fields.currency.value;
}

function setCurrencyValue(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const predefined = ["USD", "HKD", "KRW", "USDT", "USDC"];

  if (predefined.includes(normalized)) {
    fields.currency.value = normalized;
    fields.currencyCustom.value = "";
    fields.currencyCustom.classList.add("is-hidden");
  } else if (normalized) {
    fields.currency.value = "CUSTOM";
    fields.currencyCustom.value = normalized;
    fields.currencyCustom.classList.remove("is-hidden");
  } else {
    fields.currency.value = "USD";
    fields.currencyCustom.value = "";
    fields.currencyCustom.classList.add("is-hidden");
  }
}

function updateCurrencyField() {
  if (fields.currency.value === "CUSTOM") {
    fields.currencyCustom.classList.remove("is-hidden");
  } else {
    fields.currencyCustom.classList.add("is-hidden");
    fields.currencyCustom.value = "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resetForm() {
  form.reset();
  fields.id.value = "";
  fields.assetType.value = "stock";
  fields.platform.value = "IBKR";
  fields.market.value = "US";
  fields.positionSide.value = "long";
  fields.contractMultiplier.value = "100";
  fields.fxRate.value = "1";
  setCurrencyValue("USD");
  updateFormForAssetType();
  setPriceLookupStatus("填好代码、市场和币种后，系统会先查数据库缓存，未命中时再请求 Yahoo Finance 代理服务，包括 XAUUSD / XAGUSD 这类贵金属映射。");
}

function closeHoldingModal() {
  activeHoldingMode = "create";
  resetForm();
  if (holdingModalTitle) holdingModalTitle.textContent = "新增持仓";
  if (holdingModalSubtitle) holdingModalSubtitle.textContent = "录入每个平台上的股票、期权、现金和加密货币持仓。";
  if (holdingSubmitBtn) holdingSubmitBtn.textContent = "保存持仓";
  holdingModal?.classList.add("is-hidden");
  holdingModal?.setAttribute("aria-hidden", "true");
}

function openHoldingModal(mode = "create", holding = null) {
  activeHoldingMode = mode;
  resetForm();

  if (mode === "edit" && holding) {
    populateForm(holding);
    if (holdingModalTitle) holdingModalTitle.textContent = "编辑持仓";
    if (holdingModalSubtitle) holdingModalSubtitle.textContent = "修改这条持仓后，系统会同步更新快照、行情和账本关联。";
    if (holdingSubmitBtn) holdingSubmitBtn.textContent = "保存修改";
  } else {
    if (holdingModalTitle) holdingModalTitle.textContent = "新增持仓";
    if (holdingModalSubtitle) holdingModalSubtitle.textContent = "录入每个平台上的股票、期权、现金和加密货币持仓。";
    if (holdingSubmitBtn) holdingSubmitBtn.textContent = "保存持仓";
  }

  holdingModal?.classList.remove("is-hidden");
  holdingModal?.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    fields.assetType?.focus();
  }, 0);
}

function updateFormForAssetType() {
  const isCrypto = fields.assetType.value === "crypto";
  const isOption = fields.assetType.value === "option";
  const isCash = fields.assetType.value === "cash";
  const isMacro = fields.assetType.value === "macro";

  if (isCrypto) {
    fields.market.value = "CRYPTO";
    if (!fields.fxRate.value) fields.fxRate.value = "1";
  } else if (isMacro) {
    fields.market.value = "FX";
    if (!fields.fxRate.value) fields.fxRate.value = "1";
    if (!["USD", "CUSTOM"].includes(fields.currency.value)) {
      setCurrencyValue("USD");
    }
  } else if (fields.market.value === "CRYPTO") {
    fields.market.value = "US";
  } else if (fields.market.value === "FX") {
    fields.market.value = "US";
  }

  if (isOption) {
    positionSideField.classList.remove("is-hidden");
    optionFields.classList.remove("is-hidden");
    quantityLabel.textContent = "持仓张数";
    costPriceLabel.textContent = "开仓权利金";
    currentPriceLabel.textContent = "当前权利金";
    fxRateLabel.textContent = "兑美元汇率";
    costPriceField.classList.remove("is-hidden");
    currentPriceField.classList.remove("is-hidden");
    if (fields.market.value === "CRYPTO") fields.market.value = "US";
    if (!fields.contractMultiplier.value) fields.contractMultiplier.value = "100";
  } else if (isCash) {
    positionSideField.classList.add("is-hidden");
    optionFields.classList.add("is-hidden");
    quantityLabel.textContent = "现金金额";
    fxRateLabel.textContent = "兑美元汇率";
    costPriceField.classList.add("is-hidden");
    currentPriceField.classList.add("is-hidden");
    fields.costPrice.value = "1";
    fields.currentPrice.value = "1";
    if (!fields.symbol.value || fields.symbol.value.endsWith("-CASH")) {
      fields.symbol.value = `${getCurrencyValue() || "USD"}-CASH`;
    }
    if (!fields.name.value) fields.name.value = "Cash Balance";
  } else {
    positionSideField.classList.add("is-hidden");
    optionFields.classList.add("is-hidden");
    quantityLabel.textContent = "持仓数量";
    costPriceLabel.textContent = "成本价";
    currentPriceLabel.textContent = "现价";
    fxRateLabel.textContent = "汇率到基准币";
    costPriceField.classList.remove("is-hidden");
    currentPriceField.classList.remove("is-hidden");
    if (isMacro) {
      quantityLabel.textContent = "持仓数量";
      costPriceLabel.textContent = "成本价";
      currentPriceLabel.textContent = "现价";
      fxRateLabel.textContent = "兑美元汇率";
    }
  }
}

function populateForm(holding) {
  fields.id.value = holding.id;
  fields.assetType.value = holding.assetType;
  fields.platform.value = holding.platform;
  fields.market.value = holding.market;
  fields.positionSide.value = holding.positionSide || "long";
  fields.symbol.value = holding.symbol;
  fields.name.value = holding.name;
  setCurrencyValue(holding.currency);
  fields.quantity.value = holding.quantity;
  fields.costPrice.value = holding.costPrice;
  fields.currentPrice.value = holding.currentPrice;
  fields.fxRate.value = holding.fxRate;
  fields.targetAllocation.value = holding.targetAllocation || "";
  fields.notes.value = holding.notes || "";
  fields.underlying.value = holding.underlying || "";
  fields.optionType.value = holding.optionType || "call";
  fields.strikePrice.value = holding.strikePrice || "";
  fields.expiryDate.value = holding.expiryDate || "";
  fields.contractMultiplier.value = holding.contractMultiplier || 100;
  updateFormForAssetType();
  setPriceLookupStatus("已载入这条持仓，修改代码或关键字段后可重新获取 T-1 价格。");
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = "请求失败";
    let status = response.status;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      message = response.statusText || message;
    }
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

function setAuthStatus(message, tone = "") {
  authStatus.textContent = message;
  authStatus.className = `sync-status ${tone}`.trim();
}

function setAuthenticatedState(user) {
  currentUser = user;
  const authenticated = Boolean(user);

  authPanel.classList.toggle("is-hidden", authenticated);
  dashboard.classList.toggle("is-hidden", !authenticated);
  logoutBtn.classList.toggle("is-hidden", !authenticated);

  if (authenticated) {
    userBadge.textContent = `当前用户：${user.username}`;
    setAuthStatus("登录成功，你现在看到的只会是自己的持仓数据。", "success");
    dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    userBadge.textContent = "请先登录后查看个人投资总览";
    holdings = [];
    transactions = [];
    realizedPnlEntries = [];
    reviewMetrics = null;
    navSeries = [];
    renderDashboard();
    setSyncStatus("登录后可同步和查看属于你自己的持仓。");
  }
}

async function loadSession() {
  const payload = await request("/api/auth/session");
  setAuthenticatedState(payload.user || null);
  return payload.user || null;
}

async function loadPublicConfig() {
  publicConfig = await request("/api/config/public");
}

async function refreshHoldings() {
  holdings = await request("/api/holdings");
  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();
}

function setSyncStatus(message, tone = "") {
  syncStatus.textContent = message;
  syncStatus.className = `sync-status ${tone}`.trim();
}

function setPriceLookupStatus(message, tone = "", source = null) {
  if (priceLookupStatus) {
    priceLookupStatus.textContent = message;
    priceLookupStatus.className = `sync-status ${tone}`.trim();
  }

  if (!priceLookupSource) return;

  if (source?.url) {
    priceLookupSource.innerHTML = `参考来源：<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title || source.url)}</a>`;
    priceLookupSource.className = "sync-status";
  } else {
    priceLookupSource.textContent = "";
    priceLookupSource.className = "sync-status is-hidden";
  }
}

function setTradeStatus(message, tone = "") {
  if (!tradeFormStatus) return;
  tradeFormStatus.textContent = message;
  tradeFormStatus.className = `sync-status ${tone}`.trim();
}

function buildHoldingDraft() {
  return {
    id: fields.id.value || generateUuid(),
    assetType: fields.assetType.value,
    positionSide: fields.assetType.value === "option" ? fields.positionSide.value : "long",
    platform: fields.platform.value,
    market: fields.market.value,
    symbol: fields.symbol.value.trim().toUpperCase(),
    name: fields.name.value.trim() || fields.symbol.value.trim().toUpperCase(),
    currency: getCurrencyValue(),
    quantity: toNumber(fields.quantity.value),
    costPrice: fields.assetType.value === "cash" ? 1 : toNumber(fields.costPrice.value),
    currentPrice: fields.assetType.value === "cash" ? 1 : toNumber(fields.currentPrice.value),
    fxRate: toNumber(fields.fxRate.value) || 1,
    targetAllocation: toNumber(fields.targetAllocation.value),
    notes: fields.notes.value.trim(),
    underlying: fields.assetType.value === "option" ? fields.underlying.value.trim().toUpperCase() : "",
    optionType: fields.assetType.value === "option" ? fields.optionType.value : "",
    strikePrice: fields.assetType.value === "option" ? toNumber(fields.strikePrice.value) : 0,
    expiryDate: fields.assetType.value === "option" ? fields.expiryDate.value : "",
    contractMultiplier: fields.assetType.value === "option" ? toNumber(fields.contractMultiplier.value) || 100 : 1,
  };
}

function canLookupPrice(holding) {
  if (!holding.platform || !holding.symbol || !holding.currency) {
    return false;
  }

  if (holding.assetType === "option") {
    return Boolean(
      holding.underlying &&
      holding.optionType &&
      holding.strikePrice > 0 &&
      holding.expiryDate
    );
  }

  return true;
}

function applyLookupSnapshot(snapshot) {
  if (snapshot?.currentPrice != null && fields.assetType.value !== "cash") {
    fields.currentPrice.value = formatInputNumber(snapshot.currentPrice);
  }
}

async function lookupT1PriceViaBridge({ silent = false } = {}) {
  if (!currentUser) return null;

  const holding = buildHoldingDraft();
  if (!canLookupPrice(holding)) {
    if (!silent) {
      setPriceLookupStatus("请先补全代码、市场、币种，以及期权所需的标的、行权价和到期日。", "warning");
    }
    return null;
  }

  const requestId = ++priceLookupRequestId;
  if (lookupPriceBtn) lookupPriceBtn.disabled = true;
  if (!silent) {
    setPriceLookupStatus("正在获取最近一个交易日收盘价...");
  }

  try {
    const snapshot = await request("/api/prices/lookup", {
      method: "POST",
      body: JSON.stringify(holding),
    });

    if (requestId !== priceLookupRequestId) {
      return snapshot;
    }

    if (!snapshot?.found || snapshot.currentPrice == null) {
      const message = snapshot?.notes || "未能返回可靠价格。";
      setPriceLookupStatus(message, "warning");
      return snapshot;
    }

    applyLookupSnapshot(snapshot);
    const dateLabel = snapshot.priceDate ? `，收盘日 ${snapshot.priceDate}` : "";
    const sourceLabel = snapshot.cacheHit ? "数据库缓存" : (snapshot.source || "Yahoo Finance");
    setPriceLookupStatus(
      `已回填 T-1 价格${dateLabel}，来源 ${sourceLabel}。`,
      "success"
    );
    return snapshot;
  } catch (error) {
    if (requestId === priceLookupRequestId && !silent) {
      setPriceLookupStatus(`行情获取失败：${error.message}`, "warning");
    }
    throw error;
  } finally {
    if (requestId === priceLookupRequestId && lookupPriceBtn) {
      lookupPriceBtn.disabled = false;
    }
  }
}

function scheduleAutoPriceLookup() {
  if (!currentUser) return;
  const holding = buildHoldingDraft();
  if (!canLookupPrice(holding)) return;

  window.clearTimeout(priceLookupTimer);
  priceLookupTimer = window.setTimeout(() => {
    lookupT1PriceViaBridge({ silent: true }).catch(() => {});
  }, 450);
}

async function refreshLatestPrices() {
  if (!currentUser) return;
  refreshPricesBtn.disabled = true;
  setSyncStatus("正在同步 T-1 收盘价...");

  try {
    const result = await request("/api/prices/refresh", { method: "POST" });
    holdings = result.holdings || [];
    transactions = await request("/api/transactions");
    realizedPnlEntries = await request("/api/realized-pnl");
    reviewMetrics = await request("/api/review-metrics");
    navSeries = await request("/api/nav-series");
    renderDashboard();

    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const prefix = `已同步 ${result.updatedCount || 0} 条持仓的 T-1 价格`;

    if (warnings.length) {
      console.warn("行情同步警告：", warnings);
      setSyncStatus(`${prefix}。`, "warning");
    } else {
      setSyncStatus(`${prefix}。`, "success");
    }
  } catch (error) {
    if (error.status === 401) {
      setAuthenticatedState(null);
      setAuthStatus("登录已失效，请重新登录。", "warning");
      return;
    }
    setSyncStatus(`T-1 行情同步失败，继续显示数据库中的上次价格：${error.message}`, "warning");
    await refreshHoldings();
  } finally {
    refreshPricesBtn.disabled = false;
  }
}

async function saveHolding() {
  let holding = buildHoldingDraft();

  if (holding.assetType !== "cash" && holding.currentPrice <= 0 && canLookupPrice(holding)) {
    const snapshot = await lookupT1PriceViaBridge();
    if (snapshot?.found && snapshot.currentPrice != null) {
      holding = {
        ...holding,
        currentPrice: snapshot.currentPrice,
      };
    }
  }

  const existingIndex = holdings.findIndex((item) => item.id === holding.id);
  const method = existingIndex >= 0 ? "PUT" : "POST";
  const url = existingIndex >= 0 ? `/api/holdings/${holding.id}` : "/api/holdings";
  const saved = await request(url, { method, body: JSON.stringify(holding) });

  if (existingIndex >= 0) {
    holdings[existingIndex] = saved;
  } else {
    holdings.unshift(saved);
  }

  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();
  closeHoldingModal();
}

async function importHoldings(data) {
  holdings = await request("/api/holdings/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();
  resetForm();
}

async function submitHoldingTrade(holding, payload) {
  const result = await request(`/api/holdings/${holding.id}/trades`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (Array.isArray(result?.relatedHoldings)) {
    result.relatedHoldings.forEach((relatedHolding) => {
      if (!relatedHolding?.id) return;
      const relatedIndex = holdings.findIndex((item) => item.id === relatedHolding.id);
      if (relatedIndex >= 0) {
        holdings[relatedIndex] = relatedHolding;
      } else {
        holdings.unshift(relatedHolding);
      }
    });
  }

  if (result?.holding) {
    const index = holdings.findIndex((item) => item.id === holding.id);
    if (index >= 0) {
      holdings[index] = result.holding;
    } else {
      holdings.unshift(result.holding);
    }
  }

  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();

  return result;
}

async function submitOptionSettlement(holding, payload) {
  const result = await request(`/api/holdings/${holding.id}/option-settlement`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (Array.isArray(result?.relatedHoldings)) {
    result.relatedHoldings.forEach((relatedHolding) => {
      if (!relatedHolding?.id) return;
      const relatedIndex = holdings.findIndex((item) => item.id === relatedHolding.id);
      if (relatedIndex >= 0) {
        holdings[relatedIndex] = relatedHolding;
      } else {
        holdings.unshift(relatedHolding);
      }
    });
  }

  if (result?.holding) {
    const index = holdings.findIndex((item) => item.id === holding.id);
    if (index >= 0) {
      holdings[index] = result.holding;
    } else {
      holdings.unshift(result.holding);
    }
  }

  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();

  return result;
}

async function submitOptionExpiration(holding, payload) {
  const result = await request(`/api/holdings/${holding.id}/option-expire`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (result?.holding) {
    const index = holdings.findIndex((item) => item.id === holding.id);
    if (index >= 0) {
      holdings[index] = result.holding;
    } else {
      holdings.unshift(result.holding);
    }
  }

  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();

  return result;
}

async function revertHoldingTransaction(transaction) {
  const result = await request(`/api/transactions/${transaction.id}/revert`, {
    method: "POST",
  });

  if (result?.deletedHoldingId) {
    holdings = holdings.filter((item) => item.id !== result.deletedHoldingId);
  }

  if (Array.isArray(result?.relatedHoldings)) {
    result.relatedHoldings.forEach((relatedHolding) => {
      if (!relatedHolding?.id) return;
      const relatedIndex = holdings.findIndex((item) => item.id === relatedHolding.id);
      if (relatedIndex >= 0) {
        holdings[relatedIndex] = relatedHolding;
      } else {
        holdings.unshift(relatedHolding);
      }
    });
  }

  if (result?.holding?.id) {
    const index = holdings.findIndex((item) => item.id === result.holding.id);
    if (index >= 0) {
      holdings[index] = result.holding;
    } else {
      holdings.unshift(result.holding);
    }
  }

  transactions = await request("/api/transactions");
  realizedPnlEntries = await request("/api/realized-pnl");
  reviewMetrics = await request("/api/review-metrics");
  navSeries = await request("/api/nav-series");
  renderDashboard();

  return result;
}

function closeTradeModal() {
  activeTradeHoldingId = null;
  activeTradeAction = null;
  tradeForm?.reset();
  tradeModal?.classList.add("is-hidden");
  tradeModal?.setAttribute("aria-hidden", "true");
}

function setOptionSettlementStatus(message, tone = "") {
  if (!optionSettlementFormStatus) return;
  optionSettlementFormStatus.textContent = message;
  optionSettlementFormStatus.className = `sync-status ${tone}`.trim();
}

function closeOptionSettlementModal() {
  activeOptionSettlementHoldingId = null;
  optionSettlementForm?.reset();
  optionSettlementModal?.classList.add("is-hidden");
  optionSettlementModal?.setAttribute("aria-hidden", "true");
}

function openOptionSettlementModal(holding) {
  activeOptionSettlementHoldingId = holding.id;
  const isAssignment = holding.positionSide === "short";
  const actionLabel = isAssignment ? "被指派" : "行权";
  const shareQuantity = Number(holding.quantity || 0) * (Number(holding.contractMultiplier || 1) || 1);

  optionSettlementActionLabel.value = `${actionLabel} ${(holding.optionType || "call").toUpperCase()}`;
  optionSettlementSymbol.value = `${holding.symbol} · 标的 ${holding.underlying}`;
  optionSettlementQuantityInput.value = String(holding.quantity || "");
  optionSettlementShareQuantity.value = String(shareQuantity || 0);
  optionSettlementStrikePrice.value = `${holding.strikePrice || 0} ${holding.currency}`;
  optionSettlementDate.value = getTodayInShanghai();
  optionSettlementFee.value = "";
  optionSettlementTax.value = "";
  optionSettlementNotes.value = "";
  setOptionSettlementStatus(
    isAssignment
      ? "提交后会按被指派逻辑同步股票交割、现金变动和账本。"
      : "提交后会按行权逻辑同步股票交割、现金变动和账本。"
  );

  optionSettlementModal.classList.remove("is-hidden");
  optionSettlementModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => optionSettlementQuantityInput?.focus(), 0);
}

function openTradeModal(holding, action) {
  activeTradeHoldingId = holding.id;
  activeTradeAction = action;

  const actionLabel = action === "add" ? "加仓" : action === "reduce" ? "减仓" : "清仓";
  const quantityLabel = holding.assetType === "option" ? "张数" : "数量";
  const isClose = action === "close";
  const defaultUnitPrice = Number(holding.currentPrice || 0) || Number(holding.costPrice || 0) || 0;

  tradeActionLabel.value = actionLabel;
  tradeSymbol.value = `${holding.symbol} · ${holding.name}`;
  tradeQuantityLabel.textContent = quantityLabel;
  if (tradeUnitPriceLabel) {
    tradeUnitPriceLabel.textContent = isClose ? "清仓价格" : "成交价";
  }
  tradeUnitPriceInput.placeholder = isClose ? "请输入清仓价格" : "请输入成交价";
  tradeQuantityField.classList.toggle("is-hidden", isClose);
  tradeQuantityInput.required = !isClose;
  tradeQuantityInput.value = isClose ? "" : action === "reduce" ? String(holding.quantity || "") : "";
  tradeUnitPriceInput.value = defaultUnitPrice ? String(defaultUnitPrice) : "";
  tradeDateInput.value = getTodayInShanghai();
  tradeFeeInput.value = "";
  tradeTaxInput.value = "";
  tradeNotesInput.value = "";
  setTradeStatus(`填写${actionLabel}信息后，系统会自动更新持仓快照和账本。`);
  tradeModal.classList.remove("is-hidden");
  tradeModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    if (isClose) {
      tradeUnitPriceInput?.focus();
    } else {
      tradeQuantityInput?.focus();
    }
  }, 0);
}

async function continueAuth(username, password) {
  const normalizedUsername = String(username || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedUsername) {
    setAuthStatus("请输入用户名。", "warning");
    authUsername.focus();
    return;
  }

  if (normalizedPassword.length < 6) {
    setAuthStatus("密码至少需要 6 位。", "warning");
    authPassword.focus();
    return;
  }

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "正在进入...";
  setAuthStatus("正在验证账号信息...", "");

  try {
    const payload = await request("/api/auth/entry", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        password: normalizedPassword,
      }),
    });

    const sessionUser = await loadSession();
    setAuthenticatedState(sessionUser || payload.user || null);
    if (payload.mode === "register" && payload.claimedLegacyData) {
      setAuthStatus("注册成功，系统已将历史未归属持仓自动归到这个首个账户。", "success");
    } else if (payload.mode === "register") {
      setAuthStatus("注册成功，已自动登录。", "success");
    } else {
      setAuthStatus("登录成功。", "success");
    }
    await refreshLatestPrices();
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = "继续";
  }
}

async function logout() {
  await request("/api/auth/logout", { method: "POST" });
  setAuthenticatedState(null);
  resetForm();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveHolding().catch((error) => window.alert(error.message || "保存失败"));
});

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  continueAuth(authUsername.value, authPassword.value)
    .then(() => {
      authForm.reset();
    })
    .catch((error) => {
      setAuthStatus(error.message || "登录 / 注册失败", "warning");
    });
});

cancelEditBtn.addEventListener("click", closeHoldingModal);
logoutBtn.addEventListener("click", () => {
  logout().catch((error) => {
    setAuthStatus(error.message || "退出失败", "warning");
  });
});
refreshPricesBtn.addEventListener("click", () => {
  refreshLatestPrices().catch((error) => {
    setSyncStatus(`T-1 行情同步失败：${error.message}`, "warning");
  });
});
refreshPricesBtnInline?.addEventListener("click", () => {
  refreshLatestPrices().catch((error) => {
    setSyncStatus(`T-1 行情同步失败：${error.message}`, "warning");
  });
});
fields.assetType.addEventListener("change", updateFormForAssetType);
fields.assetType.addEventListener("change", scheduleAutoPriceLookup);
fields.market.addEventListener("change", scheduleAutoPriceLookup);
fields.currency.addEventListener("change", () => {
  updateCurrencyField();
  if (fields.assetType.value === "cash" && (!fields.symbol.value || fields.symbol.value.endsWith("-CASH"))) {
    fields.symbol.value = `${getCurrencyValue() || "USD"}-CASH`;
  }
  scheduleAutoPriceLookup();
});
fields.optionType.addEventListener("change", scheduleAutoPriceLookup);

[
  fields.symbol,
  fields.name,
  fields.underlying,
  fields.strikePrice,
  fields.expiryDate,
].forEach((field) => {
  field?.addEventListener("blur", scheduleAutoPriceLookup);
});

lookupPriceBtn?.addEventListener("click", () => {
  lookupT1PriceViaBridge().catch(() => {});
});

loadSampleBtn.addEventListener("click", () => {
  importHoldings(sampleHoldings.map((item) => ({ ...item, id: generateUuid() }))).catch((error) =>
    window.alert(error.message || "载入示例数据失败")
  );
});
loadSampleBtnInline?.addEventListener("click", () => {
  importHoldings(sampleHoldings.map((item) => ({ ...item, id: generateUuid() }))).catch((error) =>
    window.alert(error.message || "载入示例数据失败")
  );
});

resetBtn.addEventListener("click", () => {
  if (!window.confirm("确定要清空当前全部持仓吗？")) return;
  importHoldings([]).catch((error) => window.alert(error.message || "清空失败"));
});
resetBtnInline?.addEventListener("click", () => {
  if (!window.confirm("确定要清空当前全部持仓吗？")) return;
  importHoldings([]).catch((error) => window.alert(error.message || "清空失败"));
});

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(holdings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "investment-dashboard-holdings.json";
  anchor.click();
  URL.revokeObjectURL(url);
});
exportBtnInline?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(holdings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "investment-dashboard-holdings.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

importFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("导入文件格式不正确");

    await importHoldings(
      parsed.map((item) => ({
        ...item,
        id: item.id || generateUuid(),
      }))
    );
  } catch (error) {
    window.alert(error.message || "导入失败，请检查 JSON 文件");
  } finally {
    importFileInput.value = "";
  }
});

importFileInputInline?.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("导入文件格式不正确");

    await importHoldings(
      parsed.map((item) => ({
        ...item,
        id: item.id || generateUuid(),
      }))
    );
  } catch (error) {
    window.alert(error.message || "导入失败，请检查 JSON 文件");
  } finally {
    importFileInputInline.value = "";
  }
});

openHoldingModalBtn?.addEventListener("click", () => {
  openHoldingModal("create");
});

holdingModalBackdrop?.addEventListener("click", closeHoldingModal);

holdingsTableBody.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const target = holdings.find((item) => item.id === id);
  if (!target) return;

  if (action === "edit") {
    openHoldingModal("edit", target);
  }

  if (action === "add-position") {
    openTradeModal(target, "add");
  }

  if (action === "reduce-position") {
    openTradeModal(target, "reduce");
  }

  if (action === "close-position") {
    openTradeModal(target, "close");
  }

  if (action === "option-settlement") {
    openOptionSettlementModal(target);
  }

  if (action === "option-expire") {
    const confirmed = window.confirm(
      `确定把 ${target.symbol} 标记为到期作废吗？\n\n这会关闭对应期权持仓，并把剩余未实现盈亏转成已实现盈亏。不会新增一笔现金流。`
    );
    if (!confirmed) return;

    request(`/api/holdings/${target.id}/option-expire`, {
      method: "POST",
      body: JSON.stringify({
        quantity: target.quantity,
        tradeDate: getTodayInShanghai(),
        notes: "到期作废",
      }),
    })
      .then(async (result) => {
        if (result?.holding) {
          const index = holdings.findIndex((item) => item.id === target.id);
          if (index >= 0) {
            holdings[index] = result.holding;
          }
        }
        transactions = await request("/api/transactions");
        realizedPnlEntries = await request("/api/realized-pnl");
        reviewMetrics = await request("/api/review-metrics");
        navSeries = await request("/api/nav-series");
        renderDashboard();
        setSyncStatus(`${target.symbol} 已按到期作废处理。`, "success");
      })
      .catch((error) => window.alert(error.message || "期权到期处理失败"));
  }

  if (action === "delete") {
    request(`/api/holdings/${id}`, { method: "DELETE" })
      .then(async () => {
        holdings = holdings.filter((item) => item.id !== id);
        transactions = await request("/api/transactions");
        realizedPnlEntries = await request("/api/realized-pnl");
        reviewMetrics = await request("/api/review-metrics");
        navSeries = await request("/api/nav-series");
        renderDashboard();
        if (fields.id.value === id) resetForm();
      })
      .catch((error) => window.alert(error.message || "删除失败"));
  }

  if (action === "refresh-price") {
    request(`/api/prices/refresh/${id}`, { method: "POST" })
      .then((result) => {
        holdings = result.holdings || holdings;
        renderDashboard();
        if (Array.isArray(result.warnings) && result.warnings.length) {
          console.warn(`单条行情刷新警告(${target.symbol})：`, result.warnings);
          setSyncStatus(`${target.symbol} 行情刷新已完成。`, "warning");
        } else {
          setSyncStatus(`${target.symbol} 行情刷新成功。`, "success");
        }
      })
      .catch((error) => {
        console.warn(`单条行情刷新失败(${target.symbol})：`, error.message || error);
        setSyncStatus(`${target.symbol} 行情刷新失败。`, "warning");
      });
  }
});

tradeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const holding = holdings.find((item) => item.id === activeTradeHoldingId);
  if (!holding || !activeTradeAction) {
    closeTradeModal();
    return;
  }

  const isClose = activeTradeAction === "close";
  const quantity = isClose ? null : Number(tradeQuantityInput.value);
  const unitPrice = Number(tradeUnitPriceInput.value);
  const feeAmount = Number(tradeFeeInput.value || 0);
  const taxAmount = Number(tradeTaxInput.value || 0);

  if (!isClose && (!Number.isFinite(quantity) || quantity <= 0)) {
    setTradeStatus("数量必须大于 0。", "warning");
    return;
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    setTradeStatus("成交价必须是有效数字。", "warning");
    return;
  }

  tradeSubmitBtn.disabled = true;
  setTradeStatus("正在提交交易并更新账本...", "");

  try {
    const payload = {
      action: activeTradeAction,
      unitPrice,
      tradeDate: tradeDateInput.value || getTodayInShanghai(),
      feeAmount: Number.isFinite(feeAmount) ? feeAmount : 0,
      taxAmount: Number.isFinite(taxAmount) ? taxAmount : 0,
      notes: tradeNotesInput.value.trim(),
    };

    if (!isClose) {
      payload.quantity = quantity;
    }

    const result = await submitHoldingTrade(holding, payload);
    const realizedPnl = Number(result?.realizedPnlUsd || 0);

    if (activeTradeAction === "add") {
      setSyncStatus(`${holding.symbol} 已完成加仓。`, "success");
    } else if (activeTradeAction === "reduce") {
      setSyncStatus(`${holding.symbol} 已完成减仓，已实现盈亏 ${formatMoney(realizedPnl)}。`, "success");
    } else {
      setSyncStatus(`${holding.symbol} 已完成清仓，已实现盈亏 ${formatMoney(realizedPnl)}。`, "success");
    }

    closeTradeModal();
  } catch (error) {
    setTradeStatus(error.message || "交易提交失败", "warning");
  } finally {
    tradeSubmitBtn.disabled = false;
  }
});

optionSettlementQuantityInput?.addEventListener("input", () => {
  const holding = holdings.find((item) => item.id === activeOptionSettlementHoldingId);
  if (!holding) return;
  const contracts = Number(optionSettlementQuantityInput.value || 0);
  const shareQuantity = Number.isFinite(contracts) ? contracts * (Number(holding.contractMultiplier || 1) || 1) : 0;
  optionSettlementShareQuantity.value = String(shareQuantity || 0);
});

optionSettlementForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const holding = holdings.find((item) => item.id === activeOptionSettlementHoldingId);
  if (!holding) {
    closeOptionSettlementModal();
    return;
  }

  const quantity = Number(optionSettlementQuantityInput.value);
  const feeAmount = Number(optionSettlementFee.value || 0);
  const taxAmount = Number(optionSettlementTax.value || 0);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    setOptionSettlementStatus("合约张数必须大于 0。", "warning");
    return;
  }

  optionSettlementSubmitBtn.disabled = true;
  setOptionSettlementStatus("正在处理期权结算并同步股票、现金和账本...", "");

  try {
    const result = await submitOptionSettlement(holding, {
      action: holding.positionSide === "short" ? "assignment" : "exercise",
      quantity,
      tradeDate: optionSettlementDate.value || getTodayInShanghai(),
      feeAmount: Number.isFinite(feeAmount) ? feeAmount : 0,
      taxAmount: Number.isFinite(taxAmount) ? taxAmount : 0,
      notes: optionSettlementNotes.value.trim(),
    });

    setSyncStatus(
      `${holding.symbol} 已完成${holding.positionSide === "short" ? "指派" : "行权"}，同步了 ${result.shareQuantity || 0} 股标的资产。`,
      "success"
    );
    closeOptionSettlementModal();
  } catch (error) {
    setOptionSettlementStatus(error.message || "期权结算失败", "warning");
  } finally {
    optionSettlementSubmitBtn.disabled = false;
  }
});

tradeCancelBtn?.addEventListener("click", closeTradeModal);
tradeModalBackdrop?.addEventListener("click", closeTradeModal);
optionSettlementCancelBtn?.addEventListener("click", closeOptionSettlementModal);
optionSettlementModalBackdrop?.addEventListener("click", closeOptionSettlementModal);

[filterAssetType, filterPlatform, filterMarket].forEach((container, index) => {
  container?.addEventListener("change", (event) => {
    const key = index === 0 ? "assetType" : index === 1 ? "platform" : "market";
    activeFilters[key] = event.target.value || "";
    renderDashboard();
  });
});

[txFilterType, txFilterAssetType, txFilterPlatform].forEach((container, index) => {
  container?.addEventListener("change", (event) => {
    const key = index === 0 ? "transactionType" : index === 1 ? "assetType" : "platform";
    activeTransactionFilters[key] = event.target.value || "";
    renderTransactionsTable();
  });
});

txSearch?.addEventListener("input", (event) => {
  activeTransactionFilters.query = event.target.value || "";
  renderTransactionsTable();
});

transactionsTableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.dataset.action !== "revert-transaction") return;

  const transaction = transactions.find((item) => item.id === button.dataset.id);
  if (!transaction) return;

  const confirmed = window.confirm(
    `确定要撤销 ${transaction.symbol || "这条"}${getTransactionTypeLabel(transaction.transactionType)}流水吗？\n\n目前只支持撤销该持仓的最新一笔初始录入、加仓、减仓、清仓或快照调整。`
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    await revertHoldingTransaction(transaction);
    setSyncStatus(`${transaction.symbol || "该标的"} 的错误流水已撤销。`, "success");
  } catch (error) {
    window.alert(error.message || "撤销失败");
  } finally {
    button.disabled = false;
  }
});

[closedFilterAssetType, closedFilterPlatform].forEach((container, index) => {
  container?.addEventListener("change", (event) => {
    const key = index === 0 ? "assetType" : "platform";
    activeClosedFilters[key] = event.target.value || "";
    renderClosedHoldingsTable();
  });
});

closedSearch?.addEventListener("input", (event) => {
  activeClosedFilters.query = event.target.value || "";
  renderClosedHoldingsTable();
});

[rpFilterAssetType, rpFilterPlatform].forEach((container, index) => {
  container?.addEventListener("change", (event) => {
    const key = index === 0 ? "assetType" : "platform";
    activeRealizedPnlFilters[key] = event.target.value || "";
    renderRealizedPnlTable();
  });
});

rpSearch?.addEventListener("input", (event) => {
  activeRealizedPnlFilters.query = event.target.value || "";
  renderRealizedPnlTable();
});

[sortCost, sortMarketValue, sortPnl, sortAllocation].forEach((select) => {
  select?.addEventListener("change", () => {
    activeSort = select.value || (select.id === "sort-market-value" ? "marketValueDesc" : "marketValueDesc");

    [sortCost, sortMarketValue, sortPnl, sortAllocation].forEach((item) => {
      if (item !== select && item) {
        item.value = item.id === "sort-market-value" ? "marketValueDesc" : "";
      }
    });

    renderDashboard();
  });
});

resetForm();
setAuthenticatedState(null);
loadPublicConfig()
  .then(() => loadSession())
  .then((user) => {
    if (user) {
      return refreshLatestPrices();
    }
    return null;
  })
  .catch((error) => {
    setAuthenticatedState(null);
    setAuthStatus(`无法初始化登录状态：${error.message}`, "warning");
  });
