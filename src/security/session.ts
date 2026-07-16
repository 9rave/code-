// 会话：HMAC-SHA256 签名的无状态 Token，存 HttpOnly Cookie（见开发指南 §7.3）
// Cookie: session=<signed-token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800

export interface SessionPayload {
  sub: string; // user id
  iat: number; // 签发时间（秒）
  exp: number; // 过期时间（秒）
  sessionVersion: number; // 改密后递增，使旧 Token 失效
}

const TTL_SECONDS = 28800; // 8 小时

function b64urlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  const pad = input.length % 4 ? "=".repeat(4 - (input.length % 4)) : "";
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

export async function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  secret: string,
  ttlSeconds: number = TTL_SECONDS
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const body = b64urlEncode(JSON.stringify({ ...payload, iat, exp }));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = await hmac(secret, body);
  if (!constantTimeEqual(expected, sig)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieValue(token: string): string {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
}
