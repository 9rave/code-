import { describe, it, expect } from "vitest";
import { evaluateWindow } from "../src/db/queries";

// 纯函数单测：固定窗口限流数学（不依赖 DB）
describe("evaluateWindow (D1 限流核心)", () => {
  it("首次/窗口外 -> count=1 且允许", () => {
    const r = evaluateWindow(null, 1000, 900_000, 10);
    expect(r.count).toBe(1);
    expect(r.allowed).toBe(true);
    expect(r.retryAfterMs).toBe(900_000);
  });

  it("窗口内累加", () => {
    const r = evaluateWindow({ count: 3, resetAt: 5000 }, 1000, 900_000, 10);
    expect(r.count).toBe(4);
    expect(r.allowed).toBe(true);
  });

  it("超过上限 -> 不允许并返回 retryAfter", () => {
    const r = evaluateWindow({ count: 10, resetAt: 5000 }, 1000, 900_000, 10);
    expect(r.count).toBe(11);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(4000);
  });

  it("窗口过期 -> 重置为 1", () => {
    const r = evaluateWindow({ count: 10, resetAt: 999 }, 1000, 900_000, 10);
    expect(r.count).toBe(1);
    expect(r.allowed).toBe(true);
  });
});
