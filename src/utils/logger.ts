// 结构化日志（见开发指南 §13.4）
// 重要：调用方必须保证不传入 password、Cookie、SESSION_SECRET、Webhook 或完整敏感任务内容。

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown>, reqId: string): void {
  console.log(
    JSON.stringify({
      level,
      requestId: reqId,
      event,
      ...fields,
      ts: new Date().toISOString(),
    })
  );
}
