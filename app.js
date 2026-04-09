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
const lanHint = document.querySelector("#lan-hint");
const inviteCodeField = document.querySelector("#invite-code-field");
const invitePanel = document.querySelector("#invite-panel");
const myInviteCode = document.querySelector("#my-invite-code");
const cancelEditBtn = document.querySelector("#cancel-edit-btn");
const refreshPricesBtn = document.querySelector("#refresh-prices-btn");
const loadSampleBtn = document.querySelector("#load-sample-btn");
const resetBtn = document.querySelector("#reset-btn");
const exportBtn = document.querySelector("#export-btn");
const importFileInput = document.querySelector("#import-file");
const holdingsTableBody = document.querySelector("#holdings-table-body");
const assetAllocation = document.querySelector("#asset-allocation");
const platformAllocation = document.querySelector("#platform-allocation");
const allocationGap = document.querySelector("#allocation-gap");
const allocationTemplate = document.querySelector("#allocation-item-template");
const syncStatus = document.querySelector("#sync-status");
const filterAssetType = document.querySelector("#filter-asset-type");
const filterPlatform = document.querySelector("#filter-platform");
const filterMarket = document.querySelector("#filter-market");
const sortCost = document.querySelector("#sort-cost");
const sortMarketValue = document.querySelector("#sort-market-value");
const sortPnl = document.querySelector("#sort-pnl");
const sortAllocation = document.querySelector("#sort-allocation");
const authUsername = document.querySelector("#auth-username");
const authPassword = document.querySelector("#auth-password");
const authInviteCode = document.querySelector("#auth-invite-code");

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
let currentUser = null;
let publicConfig = null;
const activeFilters = {
  assetType: "",
  platform: "",
  market: "",
};
let activeSort = "marketValueDesc";

function toNumber(value) {
  return Number.parseFloat(value) || 0;
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
    totalCost: 0,
    totalMarketValue: 0,
    totalPnl: 0,
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
  });

  source.forEach((holding) => {
    const metrics = computeHoldingMetrics(holding);
    const actualAllocation =
      summary.totalMarketValue !== 0 ? (metrics.marketValueBase / summary.totalMarketValue) * 100 : 0;
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
  document.querySelector("#total-market-value").textContent = formatMoney(summary.totalMarketValue);
  document.querySelector("#total-cost").textContent = formatMoney(summary.totalCost);

  const pnlNode = document.querySelector("#total-pnl");
  pnlNode.textContent = formatMoney(summary.totalPnl);
  pnlNode.className = `metric-value ${summary.totalPnl >= 0 ? "gain" : "loss"}`;

  const pnlRate = summary.totalCost > 0 ? (summary.totalPnl / summary.totalCost) * 100 : 0;
  document.querySelector("#total-pnl-rate").textContent = `收益率 ${formatPercent(pnlRate)}`;
  document.querySelector("#platform-count").textContent = String(summary.platformCount.size);
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

function getFilteredHoldings(source = holdings) {
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

function renderFilters() {
  renderFilterGroup(filterAssetType, holdings.map((holding) => holding.assetType), activeFilters.assetType, getAssetTypeLabel);
  renderFilterGroup(filterPlatform, holdings.map((holding) => holding.platform), activeFilters.platform);
  renderFilterGroup(filterMarket, holdings.map((holding) => holding.market), activeFilters.market);
}

function renderTable(summary) {
  const filteredHoldings = getFilteredHoldings();

  if (!filteredHoldings.length) {
    holdingsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-row">还没有持仓，先录入一条数据吧。</td>
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
      if (activeSort === "pnlDesc") return metricsB.pnlBase - metricsA.pnlBase;
      if (activeSort === "allocationDesc") return allocationB - allocationA;
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
                ${holding.assetType === "option" ? getSyncBadge(holding) : ""}
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
              <button class="inline-button" data-action="edit" data-id="${holding.id}">编辑</button>
              <button class="inline-button delete" data-action="delete" data-id="${holding.id}">删除</button>
            </div>
          </td>
        </tr>
      `;
    });

  holdingsTableBody.innerHTML = rows.join("");
}

function renderDashboard() {
  const summary = summarizeHoldings(holdings);
  updateSummaryCards(summary);
  renderFilters();
  renderAllocationList(assetAllocation, Object.entries(summary.byAssetType), { stock: "股票", option: "期权", cash: "现金", crypto: "加密货币", macro: "贵金属 / 外汇" }, summary.totalMarketValue);
  renderAllocationList(platformAllocation, Object.entries(summary.byPlatform), {}, summary.totalMarketValue);
  renderGapList(summary.gaps);
  renderTable(summary);
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
  invitePanel.classList.toggle("is-hidden", !authenticated);

  if (authenticated) {
    userBadge.textContent = `当前用户：${user.username}`;
    myInviteCode.textContent = user.inviteCode || "-";
    setAuthStatus("登录成功，你现在看到的只会是自己的持仓数据。", "success");
    dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    userBadge.textContent = "请先登录后查看个人投资总览";
    myInviteCode.textContent = "-";
    holdings = [];
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
  const addresses = Array.isArray(publicConfig.lanAddresses) ? publicConfig.lanAddresses : [];

  if (publicConfig.host === "0.0.0.0" && addresses.length) {
    lanHint.textContent = `局域网可访问地址：${addresses.map((address) => `http://${address}:${publicConfig.port}`).join(" ，")}`;
    lanHint.className = "sync-status success";
  } else {
    lanHint.textContent = `当前仅本机访问：http://127.0.0.1:${publicConfig.port}`;
    lanHint.className = "sync-status";
  }

  inviteCodeField.classList.toggle("is-hidden", !publicConfig.inviteRequired);
  authInviteCode.required = false;
}

async function refreshHoldings() {
  holdings = await request("/api/holdings");
  renderDashboard();
}

function setSyncStatus(message, tone = "") {
  syncStatus.textContent = message;
  syncStatus.className = `sync-status ${tone}`.trim();
}

async function refreshLatestPrices() {
  if (!currentUser) return;
  refreshPricesBtn.disabled = true;
  setSyncStatus("正在同步 T-1 收盘价...");

  try {
    const result = await request("/api/prices/refresh", { method: "POST" });
    holdings = result.holdings || [];
    renderDashboard();

    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const prefix = `已同步 ${result.updatedCount || 0} 条持仓的 T-1 价格`;

    if (warnings.length) {
      console.warn("行情同步警告：", warnings);
      setSyncStatus(`${prefix}；部分项目未更新，请打开控制台查看详细日志。`, "warning");
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
  const holding = {
    id: fields.id.value || generateUuid(),
    assetType: fields.assetType.value,
    positionSide: fields.assetType.value === "option" ? fields.positionSide.value : "long",
    platform: fields.platform.value,
    market: fields.market.value,
    symbol: fields.symbol.value.trim().toUpperCase(),
    name: fields.name.value.trim(),
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

  const existingIndex = holdings.findIndex((item) => item.id === holding.id);
  const method = existingIndex >= 0 ? "PUT" : "POST";
  const url = existingIndex >= 0 ? `/api/holdings/${holding.id}` : "/api/holdings";
  const saved = await request(url, { method, body: JSON.stringify(holding) });

  if (existingIndex >= 0) {
    holdings[existingIndex] = saved;
  } else {
    holdings.unshift(saved);
  }

  renderDashboard();
  resetForm();
}

async function importHoldings(data) {
  holdings = await request("/api/holdings/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
  renderDashboard();
  resetForm();
}

async function continueAuth(username, password, inviteCode) {
  const normalizedUsername = String(username || "").trim();
  const normalizedPassword = String(password || "");
  const normalizedInviteCode = String(inviteCode || "").trim();

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
        inviteCode: normalizedInviteCode,
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
  continueAuth(authUsername.value, authPassword.value, authInviteCode.value)
    .then(() => {
      authForm.reset();
      if (publicConfig?.inviteRequired) {
        authInviteCode.value = "";
      }
    })
    .catch((error) => {
      setAuthStatus(error.message || "登录 / 注册失败", "warning");
    });
});

cancelEditBtn.addEventListener("click", resetForm);
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
fields.assetType.addEventListener("change", updateFormForAssetType);
fields.currency.addEventListener("change", () => {
  updateCurrencyField();
  if (fields.assetType.value === "cash" && (!fields.symbol.value || fields.symbol.value.endsWith("-CASH"))) {
    fields.symbol.value = `${getCurrencyValue() || "USD"}-CASH`;
  }
});

loadSampleBtn.addEventListener("click", () => {
  importHoldings(sampleHoldings.map((item) => ({ ...item, id: generateUuid() }))).catch((error) =>
    window.alert(error.message || "载入示例数据失败")
  );
});

resetBtn.addEventListener("click", () => {
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

holdingsTableBody.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const target = holdings.find((item) => item.id === id);
  if (!target) return;

  if (action === "edit") {
    populateForm(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (action === "delete") {
    request(`/api/holdings/${id}`, { method: "DELETE" })
      .then(() => {
        holdings = holdings.filter((item) => item.id !== id);
        renderDashboard();
        if (fields.id.value === id) resetForm();
      })
      .catch((error) => window.alert(error.message || "删除失败"));
  }
});

[filterAssetType, filterPlatform, filterMarket].forEach((container, index) => {
  container?.addEventListener("change", (event) => {
    const key = index === 0 ? "assetType" : index === 1 ? "platform" : "market";
    activeFilters[key] = event.target.value || "";
    renderDashboard();
  });
});

[sortCost, sortMarketValue, sortPnl, sortAllocation].forEach((select) => {
  select?.addEventListener("change", () => {
    activeSort =
      sortCost.value ||
      sortMarketValue.value ||
      sortPnl.value ||
      sortAllocation.value ||
      "marketValueDesc";

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
