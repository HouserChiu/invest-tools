import { getAuthenticatedUser } from "../lib/auth.mjs";
import { json } from "../lib/response.mjs";
import { lookupQuote, refreshMarketPrices } from "../repositories/quotes.mjs";

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

function errorResponse(error, fallbackMessage, status = 400) {
  return json({ error: error?.message || fallbackMessage }, { status: Number(error?.status || status) });
}

export async function handlePriceLookupApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return fallback ? fallback() : unauthorized();

    const body = await request.json();
    const holding = {
      ...body,
      name: String(body?.name || body?.symbol || "").trim(),
    };
    const result = await lookupQuote(env, holding);
    return json({
      found: result.found,
      currentPrice: result.currentPrice,
      fxRateToUsd: result.fxRateToUsd,
      quoteCurrency: result.quoteCurrency,
      priceDate: result.priceDate,
      source: result.source,
      cacheHit: Boolean(result.cacheHit),
      notes: result.notes || "",
    });
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Price lookup failed");
  }
}

export async function handleRefreshPricesApi(request, env, { holdingId = "", fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) return fallback ? fallback() : unauthorized();

    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const result = await refreshMarketPrices(env, user.id, {
      holdingId,
      force: Boolean(body?.force),
    });
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Price refresh failed", 500);
  }
}
