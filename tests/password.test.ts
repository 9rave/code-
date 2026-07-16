import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateSalt, passwordParams } from "../src/security/password";

describe("password (PBKDF2-SHA256)", () => {
  it("同密码同盐验证通过", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("secret-123", salt);
    expect(await verifyPassword("secret-123", salt, hash)).toBe(true);
  });

  it("错误密码验证失败", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("secret-123", salt);
    expect(await verifyPassword("wrong-password", salt, hash)).toBe(false);
  });

  it("不同盐产生不同哈希", async () => {
    const h1 = await hashPassword("secret-123", generateSalt());
    const h2 = await hashPassword("secret-123", generateSalt());
    expect(h1).not.toBe(h2);
  });

  it("参数版本化输出非空", () => {
    expect(passwordParams()).toContain("pbkdf2-sha256");
  });
});
