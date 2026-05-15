function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value) {
  const buffer = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(digest);
}
