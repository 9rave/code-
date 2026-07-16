// ID 与 requestId 生成（使用 Web Crypto 全局 crypto）
export function uuid(): string {
  return crypto.randomUUID();
}

export function requestId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
