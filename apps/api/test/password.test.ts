import { describe, expect, it } from "vitest";
import {
  PasswordService,
  productionDummyHash,
  productionScryptProfile,
  type ScryptProfile,
} from "../src/security/password.js";

export const testScryptProfile: ScryptProfile = {
  N: 1_024,
  r: 8,
  p: 1,
  maxmem: 8 * 1024 * 1024,
  saltBytes: 16,
  keyBytes: 32,
};

describe("PasswordService", () => {
  it("normalizes with NFKC and verifies a test-profile hash", async () => {
    const service = new PasswordService(testScryptProfile, "unused");
    const hash = await service.hash("Ｐassword１２３");
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    await expect(service.verify("Password123", hash)).resolves.toBe(true);
  });

  it.each([
    "other$1024$8$1$abc$abc",
    "scrypt$999999999$8$1$abc$abc",
    "scrypt$1024$8$1$***$abc",
    "scrypt$1024$8$1$YWJj$YWJj",
  ])("safely rejects malformed or unapproved record %s", async (record) => {
    const service = new PasswordService(testScryptProfile, "unused");
    await expect(service.verify("Password123", record)).resolves.toBe(false);
  });

  it("accepts the offline production dummy record with the production profile", async () => {
    const service = new PasswordService(
      productionScryptProfile,
      productionDummyHash,
    );
    await expect(
      service.verify("not-a-real-user-password-9284", productionDummyHash),
    ).resolves.toBe(true);
  });
});
