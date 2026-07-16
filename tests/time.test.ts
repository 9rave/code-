import { describe, it, expect } from "vitest";
import { businessDate, isOverdue, addDays } from "../src/utils/time";

describe("businessDate", () => {
  it("返回 YYYY-MM-DD 格式", () => {
    const d = businessDate(new Date("2026-07-17T01:00:00Z"));
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("按上海时区计算（跨 UTC 日界）", () => {
    // UTC 16:00 = 上海次日 00:00
    const d = businessDate(new Date("2026-07-17T16:00:00Z"), "Asia/Shanghai");
    expect(d).toBe("2026-07-18");
  });
});

describe("isOverdue", () => {
  it("due_date 早于业务日期则逾期", () => {
    expect(isOverdue("2026-07-16", "2026-07-17")).toBe(true);
  });
  it("无截止日不算逾期", () => {
    expect(isOverdue(null, "2026-07-17")).toBe(false);
  });
  it("等于业务日期不算逾期", () => {
    expect(isOverdue("2026-07-17", "2026-07-17")).toBe(false);
  });
});

describe("addDays", () => {
  it("加一天", () => {
    expect(addDays("2026-07-17", 1)).toBe("2026-07-18");
  });
});
