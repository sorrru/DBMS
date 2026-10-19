import { describe, expect, it } from "vitest";
import {
  normalizeQuestion,
  parseCreateQuestion,
  parseQuestionOrder,
  parseReplaceQuestion,
  validateAnswer,
  type SurveyQuestion,
} from "../src/surveys/questions.js";

const build = (
  type: "single" | "multiple" | "text" | "number",
  overrides: Partial<Parameters<typeof normalizeQuestion>[1]> = {},
): SurveyQuestion =>
  normalizeQuestion(
    type,
    {
      title: "问题",
      required: false,
      validation: {},
      options:
        type === "single" || type === "multiple"
          ? [{ text: "选项一" }, { text: "选项二" }]
          : [],
      ...overrides,
    },
    undefined,
    [],
  );

describe("question definition validation", () => {
  it("requires validation, defaults required and stores canonical defaults", () => {
    const parsed = parseCreateQuestion({
      revision: 1,
      type: "text",
      title: "内容",
      validation: {},
      options: [],
    });
    expect(parsed.required).toBe(false);
    expect(build("text").validation).toEqual({
      minLength: 0,
      maxLength: 2_000,
      digitsOnly: false,
    });
    expect(build("number").validation).toEqual({
      integerOnly: false,
      minValue: null,
      maxValue: null,
    });
    expect(() =>
      parseCreateQuestion({
        revision: 1,
        type: "text",
        title: "内容",
        options: [],
      }),
    ).toThrow();
  });

  it("uses NFC for duplicate checks, rejects bidi controls and keeps ZWJ", () => {
    expect(() =>
      build("single", {
        options: [{ text: "é" }, { text: "e\u0301" }],
      }),
    ).toThrow();
    expect(() => build("text", { title: "危险\u202e标题" })).toThrow();
    expect(() => build("text", { title: "两行\n标题" })).toThrow();
    expect(build("text", { title: "家庭👨‍👩‍👧" }).title).toContain("‍");
  });

  it("rejects immutable fields and missing required on replacement", () => {
    expect(() =>
      parseReplaceQuestion({
        revision: 1,
        title: "问题",
        validation: {},
        options: [],
      }),
    ).toThrow();
    for (const forbidden of ["type", "questionId", "jumpRules", "unknown"]) {
      expect(() =>
        parseReplaceQuestion({
          revision: 1,
          title: "问题",
          required: false,
          validation: {},
          options: [],
          [forbidden]: forbidden === "jumpRules" ? [] : "value",
        }),
      ).toThrow();
    }
    for (const forbidden of ["questionId", "jumpRules", "unknown"]) {
      expect(() =>
        parseCreateQuestion({
          revision: 1,
          type: "text",
          title: "问题",
          validation: {},
          options: [],
          [forbidden]: forbidden === "jumpRules" ? [] : "value",
        }),
      ).toThrow();
    }
  });

  it("rejects malformed, duplicate and structurally invalid order IDs", () => {
    expect(() =>
      parseQuestionOrder({ revision: 1, questionIds: ["bad"] }),
    ).toThrow();
    expect(() =>
      parseQuestionOrder({ revision: 1, questionIds: "q_first" }),
    ).toThrow();
  });
});

describe("validateAnswer", () => {
  it("treats required whitespace text as unanswered and normalizes text", () => {
    const required = build("text", { required: true });
    expect(validateAnswer(required, " \n ")).toMatchObject({ ok: false });
    const optional = build("text", {
      validation: { minLength: 2, maxLength: 20 },
    });
    expect(validateAnswer(optional, "  第一行\n第二行  ")).toEqual({
      ok: true,
      value: "第一行\n第二行",
      answered: true,
    });
  });

  it("rejects wrong answer types, duplicate options and foreign options", () => {
    const single = build("single");
    expect(validateAnswer(single, [single.options[0]!.optionId]).ok).toBe(
      false,
    );
    const multiple = build("multiple");
    const optionId = multiple.options[0]!.optionId;
    expect(validateAnswer(multiple, [optionId, optionId]).ok).toBe(false);
    expect(validateAnswer(multiple, ["o_foreign"]).ok).toBe(false);
    expect(validateAnswer(build("number"), "12").ok).toBe(false);
  });

  it("accepts only ASCII digits and normalizes negative zero", () => {
    const digits = build("text", { validation: { digitsOnly: true } });
    expect(validateAnswer(digits, "0123")).toMatchObject({ ok: true });
    expect(validateAnswer(digits, "１２３").ok).toBe(false);
    expect(validateAnswer(digits, "١٢٣").ok).toBe(false);
    expect(validateAnswer(build("number"), -0)).toEqual({
      ok: true,
      value: 0,
      answered: true,
    });
    expect(validateAnswer(build("number"), Infinity).ok).toBe(false);
    expect(
      validateAnswer(build("number"), Number.MAX_SAFE_INTEGER + 1).ok,
    ).toBe(false);
    expect(() =>
      build("number", {
        validation: { integerOnly: true, minValue: 1.5 },
      }),
    ).toThrow();
  });
});
