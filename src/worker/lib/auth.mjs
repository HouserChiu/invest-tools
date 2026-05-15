import { first } from "../repositories/d1-client.mjs";
import { parseCookies } from "./cookies.mjs";
import { sha256 } from "./crypto.mjs";
import { mapUser } from "./mappers.mjs";

const SESSION_COOKIE_NAME = "investment_session";

export async function getAuthenticatedUser(env, request) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await first(
    env,
    `SELECT users.id, users.username, users.invite_code, users.invited_by, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?
       AND sessions.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [tokenHash]
  );

  return mapUser(row);
}
