import { describe, expect, it } from "vitest";
import { TokenService } from "../src/security/token.js";

const service = new TokenService("test-secret-that-is-long-enough-for-hs256");

describe("TokenService", () => {
  it("accepts a valid HS256 token and rejects expiration", () => {
    const token = service.sign("user-id", 1_000);
    expect(service.verify(token, 1_001)).toBe("user-id");
    expect(service.verify(token, 1_000 + 7_200)).toBeUndefined();
  });

  it("rejects another algorithm, alg none and another key", () => {
    const valid = service.sign("user-id", 1_000);
    const [header, payload, signature] = valid.split(".");
    const otherAlgorithm = `${Buffer.from(JSON.stringify({ alg: "HS512", typ: "JWT" })).toString("base64url")}.${payload}.${signature}`;
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${payload}.`;
    expect(service.verify(otherAlgorithm, 1_001)).toBeUndefined();
    expect(service.verify(none, 1_001)).toBeUndefined();
    expect(
      new TokenService("another-secret-that-is-long-enough-1234").verify(
        valid,
        1_001,
      ),
    ).toBeUndefined();
    expect(header).toBeTruthy();
  });
});
