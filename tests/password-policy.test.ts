import { describe, it, expect } from "vitest";
import { validatePasswordPolicy } from "../src/security/password";

// 密码策略单测（ADR-004）：≥12 位 + 至少 3 类字符
describe("validatePasswordPolicy", () => {
  it("拒绝过短密码", () => {
    expect(() => validatePasswordPolicy("Ab1!")).toThrow(/12/);
  });

  it("拒绝仅单类字符", () => {
    expect(() => validatePasswordPolicy("aaaaaaaaaaaa")).toThrow();
  });

  it("拒绝仅两类字符（全小写+数字）", () => {
    expect(() => validatePasswordPolicy("abcdefgh1234")).toThrow();
  });

  it("接受强密码（大小写+数字+符号）", () => {
    expect(() => validatePasswordPolicy("Abcdef123456!")).not.toThrow();
  });

  it("接受大小写+数字（3 类）", () => {
    expect(() => validatePasswordPolicy("Abcdef123456")).not.toThrow();
  });
});
