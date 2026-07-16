// 业务日期与时间的统一工具（见开发指南 §5.1 / §8.1 / §12.2）
// 所有"今天/逾期"判断都必须经过 businessDate()，避免服务器本地时区与跨日归属错误。

export function businessDate(now: Date = new Date(), timeZone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // => YYYY-MM-DD
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isOverdue(dueDate: string | null, businessDateStr: string): boolean {
  return !!dueDate && dueDate < businessDateStr;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
