import { getAuthenticatedUser } from "../lib/auth.mjs";
import { json } from "../lib/response.mjs";
import {
  buildReviewMetricsD1,
  ensureNavSnapshotsForTodayD1,
  listNavSeriesD1,
} from "../repositories/review-read.mjs";

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

export async function handleReviewMetricsApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    await ensureNavSnapshotsForTodayD1(env, user.id);
    const metrics = await buildReviewMetricsD1(env, user.id);
    return json(metrics);
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    throw error;
  }
}

export async function handleNavSeriesApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    if (!user) {
      return fallback ? fallback() : unauthorized();
    }

    await ensureNavSnapshotsForTodayD1(env, user.id);
    const entries = await listNavSeriesD1(env, user.id, new URL(request.url).searchParams.get("limit"));
    return json(entries);
  } catch (error) {
    if (fallback && isMissingTableError(error)) {
      return fallback();
    }
    throw error;
  }
}
