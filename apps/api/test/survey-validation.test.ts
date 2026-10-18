import { describe, expect, it } from "vitest";
import {
  validateCreateSurvey,
  validateDraftPatch,
  validateListQuery,
} from "../src/surveys/validation.js";

describe("survey validation", () => {
  it("counts Unicode code points instead of UTF-16 units", () => {
    expect(
      validateCreateSurvey({ internalName: "😀".repeat(80) }).internalName,
    ).toHaveLength(160);
    expect(() =>
      validateCreateSurvey({ internalName: "😀".repeat(81) }),
    ).toThrow();
  });
  it.each(["   ", "名称\n第二行", "名称\u0000"])(
    "rejects invalid name %j",
    (internalName) => {
      expect(() => validateCreateSurvey({ internalName })).toThrow();
    },
  );
  it("requires revision, rejects unknown fields and distinguishes null deadline", () => {
    expect(() => validateDraftPatch({ title: "标题" })).toThrow();
    expect(() => validateDraftPatch({ revision: 1, ownerId: "x" })).toThrow();
    expect(
      validateDraftPatch({ revision: 1, deadline: null }).changes.deadline,
    ).toBeNull();
  });
  it("requires an explicit timezone and a deadline within five years", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(() =>
      validateDraftPatch({ revision: 1, deadline: "2027-01-01T00:00:00" }, now),
    ).toThrow();
    expect(() =>
      validateDraftPatch(
        { revision: 1, deadline: "2032-01-01T00:00:00Z" },
        now,
      ),
    ).toThrow();
    expect(
      validateDraftPatch(
        { revision: 1, deadline: "2027-01-01T08:00:00+08:00" },
        now,
      ).changes.deadline?.toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
  });
  it.each(["0", "-1", "1.5", "51", ["2"]])(
    "rejects invalid limit %j",
    (limit) => {
      expect(() => validateListQuery(limit, undefined)).toThrow();
    },
  );
});
