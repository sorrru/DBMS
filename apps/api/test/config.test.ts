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
