export const AUTH_COOKIE_NAME = "cet6_reader_auth";
export const AUTH_TOKEN_MESSAGE = "cet6-reader-auth-v1";

export function accessPassword() {
  return process.env.APP_ACCESS_PASSWORD?.trim() || "";
}

export function authSecret() {
  return process.env.APP_AUTH_SECRET?.trim() || accessPassword();
}

export function isAuthConfigured() {
  return Boolean(accessPassword());
}

export async function accessToken() {
  const secret = authSecret();
  if (!secret) return "";

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(AUTH_TOKEN_MESSAGE));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidAccessToken(token?: string | null) {
  if (!isAuthConfigured()) return true;
  if (!token) return false;
  return token === (await accessToken());
}
