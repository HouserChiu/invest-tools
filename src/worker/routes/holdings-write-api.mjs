import { getAuthenticatedUser } from "../lib/auth.mjs";
import { json } from "../lib/response.mjs";
import { createHolding, deleteHolding, updateHolding } from "../repositories/portfolio-write.mjs";

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

function errorResponse(error) {
  const message = error?.message || "Holding write failed";
  const status = Number(error?.status || 400);
  return json({ error: message }, { status });
}

export async function handleCreateHoldingApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    const payload = await request.json();
    const holding = await createHolding(env, user.id, payload);
    return json(holding, { status: 201 });
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    return errorResponse(error);
  }
}

export async function handleUpdateHoldingApi(request, env, { holdingId, fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    const payload = await request.json();
    const holding = await updateHolding(env, user.id, holdingId, payload);
    return json(holding);
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    return errorResponse(error);
  }
}

export async function handleDeleteHoldingApi(request, env, { holdingId, fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    await deleteHolding(env, user.id, holdingId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    return errorResponse(error);
  }
}
