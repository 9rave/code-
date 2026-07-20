import { describe, it, expect } from "vitest";
import { isValidCron, nextRun, parse } from "../src/utils/cron";

describe("cron util", () => {
  it("isValidCron", () => {
    expect(isValidCron("30 0 * * 1-5")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1,3,5")).toBe(true);
    expect(isValidCron("bad")).toBe(false);
    expect(isValidCron("0 9 * *")).toBe(false);
    expect(isValidCron("0 9 * * 8")).toBe(false); // dow 8 越界（归一化后仍无效）
  });

  it("parse 字段边界", () => {
    const p = parse("0 9 * * *");
    expect(p.minute(0)).toBe(true);
    expect(p.minute(1)).toBe(false);
    expect(p.hour(9)).toBe(true);
    expect(p.hour(10)).toBe(false);
  });

  it("nextRun: 同一分钟内不重复触发", () => {
    const base = new Date("2026-07-20T08:00:00Z");
    const n = nextRun("0 9 * * *", base);
    expect(n.toISOString()).toBe("2026-07-20T09:00:00.000Z");
  });

  it("nextRun: 已过时刻跳到次日", () => {
    const base = new Date("2026-07-20T09:00:00Z");
    const n = nextRun("0 9 * * *", base);
    expect(n.toISOString()).toBe("2026-07-21T09:00:00.000Z");
  });

  it("nextRun: 步进 */15", () => {
    const base = new Date("2026-07-20T08:07:00Z");
    const n = nextRun("*/15 * * * *", base);
    expect(n.toISOString()).toBe("2026-07-20T08:15:00.000Z");
  });

  it("nextRun: 周一 00:00（dow）", () => {
    // 2026-07-20 是周一，nextRun 周一 0 点应为次日周一（因 +1min）
    const base = new Date("2026-07-20T00:00:30Z");
    const n = nextRun("0 0 * * 1", base);
    expect(n.getUTCDay()).toBe(1);
    expect(n.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("nextRun: dom 与 dow 同时受限时为 OR", () => {
    // 每月 15 号或周一 09:30
    const base = new Date("2026-07-20T00:00:00Z"); // 该月 15 号已过
    const n = nextRun("30 9 15 * 1", base);
    // 下一个周一 09:30（2026-07-20 是周一）→ 当日 09:30
    expect(n.toISOString()).toBe("2026-07-20T09:30:00.000Z");
  });
});
