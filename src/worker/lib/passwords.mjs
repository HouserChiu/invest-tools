import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function sha256Sync(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password, passwordHash) {
  const [salt, expected] = String(passwordHash || "").split(":");
  if (!salt || !expected) return false;
  const derived = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expected, "hex"));
}

export function createInviteCode() {
  return randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}
