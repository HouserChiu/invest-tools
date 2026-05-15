import { getAuthenticatedUser } from "../lib/auth.mjs";
import { json } from "../lib/response.mjs";
import {
  processCashTransfer,
  processFxExchange,
  processHoldingTrade,
  processOptionExpiration,
  processOptionSettlement,
  revertHoldingTrade,
} from "../repositories/portfolio-write.mjs";

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

function errorResponse(error, fallbackMessage) {
  const message = error?.message || fallbackMessage;
  const status = Number(error?.status || 400);
  return json({ error: message }, { status });
}

async function requireUser(request, env, fallback) {
  const user = await getAuthenticatedUser(env, request);
  if (!user) {
    if (fallback) return { response: await fallback() };
    return { response: unauthorized() };
  }
  return { user };
}

export async function handleHoldingTradeApi(request, env, { holdingId, fallback }) {
  try {
    const auth = await requireUser(request, env, fallback);
    if (auth.response) return auth.response;

    const payload = await request.json();
    const result = await processHoldingTrade(env, auth.user.id, holdingId, payload);
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Holding trade failed");
  }
}

export async function handleOptionSettlementApi(request, env, { holdingId, fallback }) {
  try {
    const auth = await requireUser(request, env, fallback);
    if (auth.response) return auth.response;

    const payload = await request.json();
    const result = await processOptionSettlement(env, auth.user.id, holdingId, payload);
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Option settlement failed");
  }
}

export async function handleOptionExpireApi(request, env, { holdingId, fallback }) {
  try {
    const auth = await requireUser(request, env, fallback);
    if (auth.response) return auth.response;

    const payload = await request.json();
    const result = await processOptionExpiration(env, auth.user.id, holdingId, payload);
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Option expiration failed");
  }
}

export async function handleRevertTransactionApi(request, env, { transactionId, fallback }) {
  try {
    const auth = await requireUser(request, env, fallback);
    if (auth.response) return auth.response;

    const result = await revertHoldingTrade(env, auth.user.id, transactionId);
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Transaction revert failed");
  }
}

export async function handleCashTransferApi(request, env, { fallback }) {
  try {
    const auth = await requireUser(request, env, fallback);
    if (auth.response) return auth.response;

    const payload = await request.json();
    const result = await processCashTransfer(env, auth.user.id, payload);
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "Cash transfer failed");
  }
}

export async function handleFxExchangeApi(request, env, { fallback }) {
  try {
    const auth = await requireUser(request, env, fallback);
    if (auth.response) return auth.response;

    const payload = await request.json();
    const result = await processFxExchange(env, auth.user.id, payload);
    return json(result);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    return errorResponse(error, "FX exchange failed");
  }
}
