import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const valid = {
  JWT_SECRET: "a".repeat(32),
  ANONYMOUS_ID_SECRET: "b".repeat(32),
};

describe("loadEnv", () => {
  it("uses the milestone 4 survey write defaults", () => {
    const loaded = loadEnv(valid);
    expect(loaded.surveyWriteRateLimit).toBe(120);
    expect(loaded.surveyWriteRateWindowMs).toBe(60_000);
    expect(loaded.jumpRuleMaxPerQuestion).toBe(20);
    expect(loaded.fillSessionRateLimitWindowMs).toBe(900_000);
    expect(loaded.fillSessionAccountIpMax).toBe(20);
    expect(loaded.fillSessionIpMax).toBe(100);
    expect(loaded.submissionRateLimitWindowMs).toBe(900_000);
    expect(loaded.submissionAccountMax).toBe(60);
    expect(loaded.submissionSessionMax).toBe(10);
    expect(loaded.statisticsRateLimitWindowMs).toBe(60_000);
    expect(loaded.statisticsRateLimitUserMax).toBe(30);
    expect(loaded.statisticsMaxTimeMs).toBe(10_000);
  });
  it("bounds statistics settings", () => {
    for (const [name, value] of [
      ["STATISTICS_RATE_LIMIT_WINDOW_MS", "86400001"],
      ["STATISTICS_RATE_LIMIT_USER_MAX", "0"],
      ["STATISTICS_MAX_TIME_MS", "60001"],
    ] as const)
      expect(() => loadEnv({ ...valid, [name]: value })).toThrow(name);
  });
  it("bounds all submission rate-limit settings", () => {
    expect(
      loadEnv({ ...valid, SUBMISSION_RATE_LIMIT_WINDOW_MS: "86400000" })
        .submissionRateLimitWindowMs,
    ).toBe(86_400_000);
    for (const [name, value] of [
      ["SUBMISSION_RATE_LIMIT_WINDOW_MS", "86400001"],
      ["SUBMISSION_RATE_LIMIT_ACCOUNT_MAX", "0"],
      ["SUBMISSION_RATE_LIMIT_SESSION_MAX", "10001"],
    ] as const)
      expect(() => loadEnv({ ...valid, [name]: value })).toThrow(name);
  });
  it("bounds all fill-session rate-limit settings", () => {
    expect(
      loadEnv({ ...valid, FILL_SESSION_RATE_LIMIT_WINDOW_MS: "86400000" })
        .fillSessionRateLimitWindowMs,
    ).toBe(86_400_000);
    for (const [name, value] of [
      ["FILL_SESSION_RATE_LIMIT_WINDOW_MS", "86400001"],
      ["FILL_SESSION_RATE_LIMIT_ACCOUNT_IP_MAX", "0"],
      ["FILL_SESSION_RATE_LIMIT_IP_MAX", "10001"],
    ] as const)
      expect(() => loadEnv({ ...valid, [name]: value })).toThrow(name);
  });
  it("accepts only a 1 to 100 jump-rule limit", () => {
    expect(
      loadEnv({ ...valid, JUMP_RULE_MAX_PER_QUESTION: "100" })
        .jumpRuleMaxPerQuestion,
    ).toBe(100);
    for (const value of ["0", "101", "1.5", "invalid"])
      expect(() =>
        loadEnv({ ...valid, JUMP_RULE_MAX_PER_QUESTION: value }),
      ).toThrow(/JUMP_RULE_MAX_PER_QUESTION/);
  });
  it("rejects weak, example and identical secrets", () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: "short" })).toThrow(
      /JWT_SECRET/,
    );
    expect(() =>
      loadEnv({ ...valid, JWT_SECRET: valid.ANONYMOUS_ID_SECRET }),
    ).toThrow(/不能相同/);
    expect(() =>
      loadEnv({
        ...valid,
        JWT_SECRET: "replace-with-at-least-32-random-characters",
      }),
    ).toThrow(/示例值/);
  });
});
