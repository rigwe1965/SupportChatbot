import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  validatePassword,
  verifyAgainstDummy,
  verifyPassword,
} from "@/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips: the right password verifies, a wrong one doesn't", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never contains the password and records its parameters", async () => {
    const hash = await hashPassword("super secret value");
    expect(hash).not.toContain("super secret value");
    expect(hash).toMatch(/^scrypt\$65536\$8\$2\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("uses a fresh random salt each time", async () => {
    const [a, b] = await Promise.all([hashPassword("same password!"), hashPassword("same password!")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password!", a)).toBe(true);
    expect(await verifyPassword("same password!", b)).toBe(true);
  });

  it("treats visually identical unicode forms as the same password", async () => {
    const hash = await hashPassword("café-password"); // é as one character
    expect(await verifyPassword("café-password", hash)).toBe(true); // e + combining accent
  });

  it("verifies hashes made with other parameters, so settings can be raised later", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("old-style password", salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
    expect(await verifyPassword("old-style password", stored)).toBe(true);
    expect(await verifyPassword("other", stored)).toBe(false);
  });

  it.each([
    "",
    "plaintext-password",
    "bcrypt$10$abc$def",
    "scrypt$$$$$",
    "scrypt$65536$8$2$onlysalt",
    "scrypt$abc$8$2$c2FsdA==$aGFzaA==",
    "scrypt$0$8$2$c2FsdA==$aGFzaA==",
    "scrypt$-1$8$2$c2FsdA==$aGFzaA==",
  ])("rejects malformed stored hash %j without throwing", async (stored) => {
    await expect(verifyPassword("whatever", stored)).resolves.toBe(false);
  });

  it("verifyAgainstDummy always resolves quietly (used to hide which accounts exist)", async () => {
    await expect(verifyAgainstDummy("anything")).resolves.toBeUndefined();
  });
});

describe("validatePassword", () => {
  it("accepts reasonable passwords, including spaces and unicode", () => {
    expect(validatePassword("correct horse battery staple")).toBeNull();
    expect(validatePassword("pässwörd-多语言-ok")).toBeNull();
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1) + "b")).toBeNull();
  });

  it.each([
    [undefined, /required/],
    [null, /required/],
    [12345678901, /required/],
    ["short", /at least 10/],
    ["a".repeat(MIN_PASSWORD_LENGTH - 1), /at least 10/],
    ["a".repeat(MAX_PASSWORD_LENGTH + 1), /at most 128/],
    ["aaaaaaaaaaaa", /too easy/],
    ["          ", /spaces|easy/],
  ])("rejects %j", (value, message) => {
    expect(validatePassword(value)).toMatch(message);
  });

  it("allows the exact length limits", () => {
    expect(validatePassword("ab".repeat(MIN_PASSWORD_LENGTH / 2))).toBeNull();
    expect(validatePassword("ab".repeat(MAX_PASSWORD_LENGTH / 2))).toBeNull();
  });
});
