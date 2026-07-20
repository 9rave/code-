// 轻量 5 字段 cron 解析与计算（标准 Vixie cron 语义，见 §调度器）
// 支持：`*`, `a-b`, `a/b`, `*/b`, `a,b,c`。dow 0-6（0=周日），表达式中 7 归一化为 0。
// 不依赖任何第三方库，便于在 Cloudflare Workers 中运行与单元测试。

export type CronExpr = string;

type Pred = (v: number) => boolean;

function fieldPredicate(raw: string, min: number, max: number): Pred {
  const set = new Set<number>();
  for (const part of raw.split(",")) {
    const p = part.trim();
    if (p === "") continue;
    let step = 1;
    let rangeStr = p;
    const slash = p.indexOf("/");
    if (slash >= 0) {
      step = parseInt(p.slice(slash + 1), 10);
      if (!Number.isFinite(step) || step < 1) step = 1;
      rangeStr = p.slice(0, slash);
    }
    let lo = min;
    let hi = max;
    if (rangeStr !== "*") {
      const dash = rangeStr.indexOf("-");
      if (dash >= 0) {
        lo = parseInt(rangeStr.slice(0, dash), 10);
        hi = parseInt(rangeStr.slice(dash + 1), 10);
      } else {
        lo = hi = parseInt(rangeStr, 10);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    // 显式值域校验：越界（如 dow=8、minute=70、month=13）直接判非法，
    // 由 parse 抛出、isValidCron 捕获为 false，同时 nextRun 也会拒收非法表达式。
    if (rangeStr !== "*" && (lo < min || hi > max || lo > hi)) {
      throw new Error(`cron 字段越界: ${raw}`);
    }
    lo = Math.max(min, lo);
    hi = Math.min(max, hi);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return (v: number) => set.has(v);
}

export function isValidCron(expr: string): boolean {
  try {
    parse(expr);
    return true;
  } catch {
    return false;
  }
}

export function parse(expr: CronExpr): {
  minute: Pred;
  hour: Pred;
  dom: Pred;
  month: Pred;
  dow: Pred;
} {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron 必须为 5 个字段");
  const dowField = f[4].replace(/\b7\b/g, "0"); // 周日 7 → 0
  return {
    minute: fieldPredicate(f[0], 0, 59),
    hour: fieldPredicate(f[1], 0, 23),
    dom: fieldPredicate(f[2], 1, 31),
    month: fieldPredicate(f[3], 1, 12),
    dow: fieldPredicate(dowField, 0, 6),
  };
}

// 计算 expr 在 after 之后的下一次触发时间（最多向前搜索 8 年）
export function nextRun(expr: CronExpr, after: Date): Date {
  const p = parse(expr);
  const f = expr.trim().split(/\s+/);
  const domStar = f[2].trim() === "*";
  const dowStar = f[4].trim() === "*";

  const c = new Date(after.getTime());
  c.setUTCSeconds(0, 0);
  c.setUTCMinutes(c.getUTCMinutes() + 1); // 从下一分钟起算，避免重复触发同一分钟

  const limit = new Date(after.getTime() + 8 * 365 * 24 * 60 * 60 * 1000);
  while (c <= limit) {
    const m = c.getUTCMonth() + 1;
    const d = c.getUTCDate();
    const h = c.getUTCHours();
    const min = c.getUTCMinutes();
    const w = c.getUTCDay(); // 0=Sun

    if (!p.month(m)) {
      c.setUTCDate(1);
      c.setUTCHours(0, 0, 0, 0);
      c.setUTCMonth(c.getUTCMonth() + 1);
      continue;
    }
    if (!p.hour(h)) {
      c.setUTCHours(h + 1, 0, 0, 0);
      continue;
    }
    if (!p.minute(min)) {
      c.setUTCMinutes(min + 1);
      continue;
    }
    const domOk = p.dom(d);
    const dowOk = p.dow(w);
    // Vixie 规则：dom 与 dow 同时受限 → OR；否则（任一为 *）→ AND
    const ok = !domStar && !dowStar ? domOk || dowOk : domOk && dowOk;
    if (ok) return c;
    c.setUTCMinutes(min + 1);
  }
  throw new Error("cron 在未来 8 年内无匹配时间");
}
