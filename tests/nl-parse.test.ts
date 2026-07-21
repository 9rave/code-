import { describe, it, expect } from "vitest";
import { parseTaskText } from "../src/adapters/nl-parse";

// 固定基准时间：2026-07-21（周二，上海时区同日）
const NOW = new Date("2026-07-21T03:00:00Z");
const p = (s: string) => parseTaskText(s, NOW);

describe("nl-parse · 时间解析", () => {
  it("明天下午3点 → 次日 15:00", () => {
    const r = p("明天下午3点开会");
    expect(r.dueDate).toBe("2026-07-22");
    expect(r.dueTime).toBe("15:00");
    expect(r.title).toBe("开会");
  });

  it("晚上8点半 → 20:30", () => {
    const r = p("晚上8点半吃药");
    expect(r.dueTime).toBe("20:30");
    expect(r.title).toBe("吃药");
  });

  it("显式 HH:MM（下午修正为 24h）", () => {
    const r = p("下午14:30 开会"); // 已给24h，下午修饰不叠加
    expect(r.dueTime).toBe("14:30");
  });

  it("绝对日期 + 早上 → 日期与时间", () => {
    const r = p("2026-08-01 早上7点跑步");
    expect(r.dueDate).toBe("2026-08-01");
    expect(r.dueTime).toBe("07:00");
    expect(r.title).toBe("跑步");
  });

  it("下周一 → 顺延到下周", () => {
    const r = p("下周一交周报");
    expect(r.dueDate).toBe("2026-08-03"); // 2026-07-21 周二 → 下周一
  });
});

describe("nl-parse · 周期", () => {
  it("每天9点喝水 → daily", () => {
    const r = p("每天9点喝水");
    expect(r.recurrence).toBe("daily");
    expect(r.dueTime).toBe("09:00");
    expect(r.title).toBe("喝水");
  });

  it("每小时活动 → hourly", () => {
    const r = p("每小时起来活动一下");
    expect(r.recurrence).toBe("hourly");
    expect(r.title).toBe("起来活动一下");
  });

  it("每周 → weekly", () => {
    const r = p("每周一复习英语");
    expect(r.recurrence).toBe("weekly");
  });
});

describe("nl-parse · 优先级与标签", () => {
  it("高优先级 → high", () => {
    const r = p("高优先级 周五交报告");
    expect(r.priority).toBe("high");
    expect(r.dueDate).toBe("2026-07-24"); // 本周五
    expect(r.title).toBe("交报告");
  });

  it("紧急 + 电话标签", () => {
    const r = p("提醒我紧急打电话给张三");
    expect(r.priority).toBe("high");
    expect(r.tags).toContain("电话");
    expect(r.title).toBe("打电话给张三");
  });

  it("不急 → low", () => {
    const r = p("不急，慢慢整理资料");
    expect(r.priority).toBe("low");
  });
});

describe("nl-parse · 容错", () => {
  it("纯标题无时间 → 仅标题", () => {
    const r = p("买牛奶");
    expect(r.title).toBe("买牛奶");
    expect(r.dueDate).toBeNull();
    expect(r.dueTime).toBeNull();
    expect(r.recurrence).toBeNull();
    expect(r.confident).toBe(true);
  });

  it("空输入兜底", () => {
    const r = p("   ");
    expect(r.title).toBeTruthy();
  });
});
