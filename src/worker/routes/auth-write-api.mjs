import { randomUUID } from "node:crypto";
import { json } from "../lib/response.mjs";
import { mapUser } from "../lib/mappers.mjs";
import {
  createInviteCode,
  createSessionToken,
  hashPassword,
  normalizeUsername,
  sha256Sync,
  verifyPassword,
} from "../lib/passwords.mjs";
import { buildExpiredSessionCookie, buildSessionCookie } from "../lib/session-cookie.mjs";
import { all, first, run } from "../repositories/d1-client.mjs";
import { getAuthenticatedUser } from "../lib/auth.mjs";
import { parseCookies } from "../lib/cookies.mjs";

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ""));
}

function responseWithSession(payload, token, expiresAt, init = {}) {
  const response = json(payload, init);
  response.headers.append("Set-Cookie", buildSessionCookie(token, expiresAt));
  return response;
}

function responseWithoutSession(init = {}) {
  const response = new Response(null, init);
  response.headers.append("Set-Cookie", buildExpiredSessionCookie());
  return response;
}

async function createSession(env, userId) {
  const token = createSessionToken();
  const tokenHash = sha256Sync(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await run(
    env,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [randomUUID(), userId, tokenHash, expiresAt.toISOString().slice(0, 19).replace("T", " ")]
  );

  return { token, expiresAt };
}

async function createUniqueInviteCode(env) {
  while (true) {
    const candidate = createInviteCode();
    const existing = await first(env, "SELECT id FROM users WHERE invite_code = ? LIMIT 1", [candidate]);
    if (!existing) return candidate;
  }
}

async function registerOrLogin(env, body, { allowAutoLogin = false } = {}) {
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");

  if (!username || password.length < 6) {
    return json({ error: "用户名不能为空，密码至少 6 位。" }, { status: 400 });
  }

  if (allowAutoLogin) {
    const existingUser = await first(env, "SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
    if (existingUser) {
      if (!verifyPassword(password, existingUser.password_hash)) {
        return json({ error: "用户名或密码不正确。" }, { status: 401 });
      }

      const { token, expiresAt } = await createSession(env, existingUser.id);
      return responseWithSession(
        { mode: "login", user: mapUser(existingUser) },
        token,
        expiresAt
      );
    }
  }

  const countRow = await first(env, "SELECT COUNT(*) AS count FROM users");
  const isFirstUser = Number(countRow?.count || 0) === 0;
  const userId = randomUUID();
  const personalInviteCode = await createUniqueInviteCode(env);

  try {
    await run(
      env,
      `INSERT INTO users (id, username, invite_code, invited_by, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, username, personalInviteCode, null, hashPassword(password)]
    );

    if (isFirstUser) {
      await run(env, "UPDATE holdings SET user_id = ? WHERE user_id IS NULL", [userId]);
    }

    const { token, expiresAt } = await createSession(env, userId);
    return responseWithSession(
      {
        mode: "register",
        user: {
          id: userId,
          username,
          inviteCode: personalInviteCode,
          invitedBy: null,
        },
        claimedLegacyData: isFirstUser,
      },
      token,
      expiresAt,
      { status: 201 }
    );
  } catch (error) {
    if (/unique/i.test(String(error?.message || ""))) {
      return json({ error: "该用户名已存在。" }, { status: 409 });
    }
    throw error;
  }
}

export async function handleAuthEntryApi(request, env, { fallback }) {
  try {
    const body = await request.json();
    return registerOrLogin(env, body, { allowAutoLogin: true });
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    throw error;
  }
}

export async function handleAuthRegisterApi(request, env, { fallback }) {
  try {
    const body = await request.json();
    return registerOrLogin(env, body, { allowAutoLogin: false });
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    throw error;
  }
}

export async function handleAuthLoginApi(request, env, { fallback }) {
  try {
    const body = await request.json();
    const username = normalizeUsername(body?.username);
    const password = String(body?.password || "");

    const userRow = await first(env, "SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      return json({ error: "用户名或密码不正确。" }, { status: 401 });
    }

    const { token, expiresAt } = await createSession(env, userRow.id);
    return responseWithSession({ user: mapUser(userRow) }, token, expiresAt);
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    throw error;
  }
}

export async function handleAuthLogoutApi(request, env, { fallback }) {
  try {
    const user = await getAuthenticatedUser(env, request);
    const cookies = parseCookies(request.headers.get("cookie") || "");
    const token = cookies.investment_session;
    if (user && token) {
      await run(env, "DELETE FROM sessions WHERE token_hash = ?", [sha256Sync(token)]);
    }

    return responseWithoutSession({ status: 204 });
  } catch (error) {
    if (fallback && isMissingTableError(error)) return fallback();
    throw error;
  }
}
