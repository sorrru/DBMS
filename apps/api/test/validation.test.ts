import { describe, expect, it } from "vitest";
import { validateCredentials } from "../src/auth/validation.js";
import {
  PasswordService,
  type ScryptProfile,
} from "../src/security/password.js";

const profile: ScryptProfile = {
  N: 1_024,
  r: 8,
  p: 1,
  maxmem: 8 * 1024 * 1024,
  saltBytes: 16,
  keyBytes: 32,
};
const passwords = new PasswordService(profile, "unused");

describe("credential validation", () => {
  it("trims and lowercases only the lookup username", () => {
    expect(
      validateCredentials(
        { username: " Alice_7 ", password: "Password123" },
        passwords,
        true,
      ),
    ).toMatchObject({ username: "Alice_7", usernameNormalized: "alice_7" });
  });

  it.each([
    { username: "中Alice", password: "Password123" },
    { username: "ab", password: "Password123" },
    { username: "Alice", password: "short1" },
    { username: "Alice", password: "NoDigitsHere" },
    { username: "Alice", password: "1234567890" },
  ])("rejects invalid registration input %#", (body) => {
    expect(() => validateCredentials(body, passwords, true)).toThrow();
  });
});
