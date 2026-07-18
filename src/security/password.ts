// 密码哈希：Web Crypto PBKDF2-SHA256（见开发指南 §7.2）
// Workers 与 Node 20+ 均提供全局 crypto.subtle。盐 ≥16 字节，派生 32 字节。

const ITERATIONS = 100_000; // Cloudflare Workers 的 Web Crypto 上限为 100000（高于此值抛 NotSupportedError）
const KEY_BITS = 256;
const SALT_BYTES = 16;

import { HttpError } from "../utils/errors";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return toHex(salt.buffer);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_BITS
  );
  return toHex(bits);
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  return constantTimeEqual(actual, expectedHash);
}

export function passwordParams(): string {
  return `pbkdf2-sha256|${ITERATIONS}|${KEY_BITS}`;
}

// 密码策略（见 ADR-004）：≥12 位，且含大小写/数字/符号中至少 3 类。
// 违反时抛出 HttpError(400)，由调用方向上传播。
export function validatePasswordPolicy(password: string): void {
  if (!password || password.length < 12) {
    throw new HttpError(400, "VALIDATION_ERROR", "密码至少 12 位");
  }
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;
  if (classes < 3) {
    throw new HttpError(400, "VALIDATION_ERROR", "密码须包含大小写字母、数字、符号中至少 3 类");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
