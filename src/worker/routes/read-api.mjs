import { getAuthenticatedUser } from "../lib/auth.mjs";
import { json } from "../lib/response.mjs";
import { listHoldings, listRealizedPnl, listTransactions } from "../repositories/portfolio-read.mjs";

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

export async function handleSessionApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (user || request.headers.get("cookie")) {
      return json({ user });
    }

    return json({ user: null });
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    throw error;
  }
}

export async function handleHoldingsApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    const holdings = await listHoldings(env, user.id);
    return json(holdings);
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    throw error;
  }
}

export async function handleTransactionsApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    const transactions = await listTransactions(env, user.id, new URL(request.url).searchParams);
    return json(transactions);
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    throw error;
  }
}

export async function handleRealizedPnlApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    const entries = await listRealizedPnl(env, user.id, new URL(request.url).searchParams);
    return json(entries);
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    throw error;
  }
}
