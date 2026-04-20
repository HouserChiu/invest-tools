from datetime import datetime, timezone
from typing import Dict, Optional
import os
import time

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing_extensions import Literal


app = FastAPI(title="Local Market Proxy", version="0.1.0")

CACHE_TTL_SECONDS = int(os.getenv("QUOTE_PROXY_CACHE_TTL", "300"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("QUOTE_PROXY_TIMEOUT", "20"))

_cache: Dict[str, dict] = {}

HTTP_PROXIES = {
    "http": os.getenv("HTTP_PROXY") or os.getenv("http_proxy"),
    "https": os.getenv("HTTPS_PROXY") or os.getenv("https_proxy"),
}
HTTP_PROXIES = {key: value for key, value in HTTP_PROXIES.items() if value}


class QuoteRequest(BaseModel):
    assetType: Literal["stock", "crypto", "option", "macro"]
    symbol: Optional[str] = None
    market: Optional[str] = "US"
    currency: Optional[str] = "USD"
    underlying: Optional[str] = None
    optionType: Optional[Literal["call", "put"]] = None
    strikePrice: Optional[float] = None
    expiryDate: Optional[str] = None


def get_cache(key: str):
    item = _cache.get(key)
    if not item:
        return None
    if time.time() - item["ts"] > CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return item["value"]


def set_cache(key: str, value: dict):
    _cache[key] = {
        "ts": time.time(),
        "value": value,
    }


def yahoo_get_json(url: str, params: Optional[dict] = None) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
    }

    try:
        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=REQUEST_TIMEOUT_SECONDS,
            proxies=HTTP_PROXIES or None,
        )
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Yahoo request error: {error}")

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Yahoo request failed: HTTP {response.status_code}")

    try:
        return response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Yahoo returned non-JSON response")


def normalize_stock_symbol(symbol: str, market: str) -> str:
    normalized = (symbol or "").strip().upper()
    normalized_market = (market or "US").strip().upper()

    if not normalized:
        raise HTTPException(status_code=400, detail="symbol is required for stock")

    if normalized_market == "HK" and not normalized.endswith(".HK"):
        return f"{normalized}.HK"

    if normalized_market in {"KR", "KOSPI"} and not (normalized.endswith(".KS") or normalized.endswith(".KQ")):
        return f"{normalized}.KS"

    if normalized_market in {"KQ", "KOSDAQ"} and not normalized.endswith(".KQ"):
        return f"{normalized}.KQ"

    if normalized_market == "JP" and not normalized.endswith(".T"):
        return f"{normalized}.T"

    if normalized_market in {"UK", "LON", "LSE"} and not normalized.endswith(".L"):
        return f"{normalized}.L"

    return normalized


def normalize_crypto_symbol(symbol: str, currency: str) -> str:
    base = (symbol or "").strip().upper()
    quote = (currency or "USD").strip().upper()

    if not base:
        raise HTTPException(status_code=400, detail="symbol is required for crypto")

    if "-" in base:
        return base

    return f"{base}-{quote}"


def normalize_macro_symbol(symbol: str, currency: str) -> str:
    normalized = (symbol or "").strip().upper()
    quote_currency = (currency or "USD").strip().upper()

    if not normalized:
        raise HTTPException(status_code=400, detail="symbol is required for macro")

    if normalized in {"GC=F", "SI=F"}:
        return normalized

    if normalized in {"XAUUSD=X", "XAUUSD"}:
        return "GC=F"

    if normalized in {"XAGUSD=X", "XAGUSD"}:
        return "SI=F"

    compact = normalized.replace("/", "").replace("-", "")

    if len(compact) == 6 and compact.isalpha():
        return f"{compact}=X"

    raise HTTPException(status_code=400, detail=f"Unsupported macro symbol: {symbol}")


def build_usd_fx_symbol(currency: str) -> str:
    quote = (currency or "").strip().upper()
    if not quote or quote == "USD":
        return ""
    return f"USD{quote}=X"


def build_yahoo_option_symbol(
    underlying: str,
    expiry_date: str,
    option_type: str,
    strike_price: float,
) -> str:
    root = (underlying or "").strip().upper()
    if not root:
        raise HTTPException(status_code=400, detail="underlying is required for option")

    try:
        expiry = datetime.strptime(expiry_date, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="expiryDate must be YYYY-MM-DD")

    if option_type not in {"call", "put"}:
        raise HTTPException(status_code=400, detail="optionType must be call or put")

    if strike_price is None or strike_price <= 0:
        raise HTTPException(status_code=400, detail="strikePrice must be > 0")

    cp_flag = "C" if option_type == "call" else "P"
    strike_code = str(int(round(float(strike_price) * 1000))).zfill(8)
    return f"{root}{expiry.strftime('%y%m%d')}{cp_flag}{strike_code}"


def parse_chart_close(symbol: str) -> dict:
    cache_key = f"chart:{symbol}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    payload = yahoo_get_json(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
        params={
            "interval": "1d",
            "range": "15d",
            "includePrePost": "false",
            "events": "div,splits",
        },
    )

    chart = payload.get("chart", {})
    error = chart.get("error")
    if error:
        raise HTTPException(status_code=404, detail=str(error))

    results = chart.get("result") or []
    if not results:
        raise HTTPException(status_code=404, detail=f"No chart result for {symbol}")

    item = results[0]
    timestamps = item.get("timestamp") or []
    quote = ((item.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []

    latest = None
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        latest = {
            "priceDate": datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat(),
            "currentPrice": float(close),
        }

    if not latest:
        raise HTTPException(status_code=404, detail=f"No valid close price found for {symbol}")

    meta = item.get("meta") or {}
    result = {
        "found": True,
        "symbol": symbol,
        "currentPrice": latest["currentPrice"],
        "priceDate": latest["priceDate"],
        "quoteCurrency": meta.get("currency") or "USD",
        "source": "Yahoo Finance chart",
    }
    set_cache(cache_key, result)
    return result


def lookup_stock(payload: QuoteRequest) -> dict:
    symbol = normalize_stock_symbol(payload.symbol or "", payload.market or "US")
    return parse_chart_close(symbol)


def lookup_crypto(payload: QuoteRequest) -> dict:
    base = (payload.symbol or "").strip().upper()
    quote = (payload.currency or "USD").strip().upper()
    symbol = normalize_crypto_symbol(base, quote)

    try:
        return parse_chart_close(symbol)
    except HTTPException as direct_error:
        # Yahoo often has crypto in USD, but not necessarily in USDT/USDC/HKD/KRW pairs.
        usd_snapshot = parse_chart_close(f"{base}-USD")

        if quote in {"USD", "USDT", "USDC"}:
            return {
                **usd_snapshot,
                "symbol": symbol,
                "quoteCurrency": quote,
                "source": "Yahoo Finance chart (USD proxy)",
            }

        fx_symbol = build_usd_fx_symbol(quote)
        if not fx_symbol:
            raise direct_error

        fx_snapshot = parse_chart_close(fx_symbol)
        converted_price = float(usd_snapshot["currentPrice"]) * float(fx_snapshot["currentPrice"])

        return {
            "found": True,
            "symbol": symbol,
            "currentPrice": converted_price,
            "priceDate": usd_snapshot["priceDate"],
            "quoteCurrency": quote,
            "source": f"Yahoo Finance chart (USD converted to {quote})",
        }


def lookup_option(payload: QuoteRequest) -> dict:
    yahoo_symbol = build_yahoo_option_symbol(
        underlying=payload.underlying or "",
        expiry_date=payload.expiryDate or "",
        option_type=payload.optionType or "",
        strike_price=payload.strikePrice or 0,
    )
    result = parse_chart_close(yahoo_symbol)
    result["underlying"] = (payload.underlying or "").strip().upper()
    result["optionSymbol"] = yahoo_symbol
    return result


def lookup_macro(payload: QuoteRequest) -> dict:
    symbol = normalize_macro_symbol(payload.symbol or "", payload.currency or "USD")
    result = parse_chart_close(symbol)
    return result


@app.get("/health")
def health():
    return {
        "ok": True,
        "cacheSize": len(_cache),
        "proxyEnabled": bool(HTTP_PROXIES),
    }


@app.post("/quote/t1")
def quote_t1(payload: QuoteRequest):
    if payload.assetType == "stock":
        return lookup_stock(payload)

    if payload.assetType == "crypto":
        return lookup_crypto(payload)

    if payload.assetType == "option":
        return lookup_option(payload)

    if payload.assetType == "macro":
        return lookup_macro(payload)

    raise HTTPException(status_code=400, detail="Unsupported assetType")
