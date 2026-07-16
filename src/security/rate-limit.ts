// 速率限制：单实例内存兜底（见开发指南 §7.5）
// 注意：Workers 多实例下内存不共享。生产应改用 KV / D1 做跨请求计数。
// 登录 IP 限流、AI 每日手动上限均走此接口。

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private store = new Map<string, Bucket>();

  constructor(private windowMs: number, private max: number) {}

  check(key: string): boolean {
    const now = Date.now();
    const b = this.store.get(key);
    if (!b || b.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (b.count >= this.max) return false;
    b.count++;
    return true;
  }
}

// 预置限流器
export const loginLimiter = new RateLimiter(15 * 60 * 1000, 10); // 10 次 / 15 分钟 / IP
