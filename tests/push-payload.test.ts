import { describe, it, expect } from "vitest";
import { buildNotifyPayload } from "../src/services/push-service";

describe("buildNotifyPayload (host-aware webhook adapter)", () => {
  it("ntfy: 返回 title/message/tags/priority", () => {
    const p = buildNotifyPayload("https://ntfy.sh/my-topic", "morning", "hello");
    expect(p).toMatchObject({ title: "AI Todo 早报", message: "hello", priority: 3 });
    expect(Array.isArray(p.tags)).toBe(true);
  });

  it("pushplus: 返回 title/content + template=txt（token 在 URL query，不入 body）", () => {
    const p = buildNotifyPayload("https://www.pushplus.plus/send?token=abc123", "evening", "body");
    expect(p).toMatchObject({ title: "AI Todo 晚报", content: "body", template: "txt" });
    expect(p).not.toHaveProperty("token");
    expect(p).not.toHaveProperty("message");
  });

  it("server酱: 返回 title/desp", () => {
    const p = buildNotifyPayload("https://sctapi.ftqq.com/SCTabc.send", "weekly", "w");
    expect(p).toMatchObject({ title: "AI Todo 周报", desp: "w" });
  });

  it("未知 host: 回退 ntfy 格式", () => {
    const p = buildNotifyPayload("https://example.com/hook", "test", "x");
    expect(p).toHaveProperty("message", "x");
    expect(p).toHaveProperty("title");
  });
});
