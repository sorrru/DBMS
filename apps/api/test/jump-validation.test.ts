import { describe, expect, it } from "vitest";
import type { SurveyQuestion } from "../src/surveys/questions.js";
import {
  normalizeJumpRules,
  parseJumpRulesUpdate,
} from "../src/surveys/jumps.js";

const option = (optionId: string) => ({ optionId, text: optionId });
const question = (
  questionId: string,
  type: SurveyQuestion["type"],
  options: SurveyQuestion["options"] = [],
): SurveyQuestion => ({
  questionId,
  type,
  title: questionId,
  required: false,
  validation:
    type === "multiple"
      ? { minSelections: 1, maxSelections: options.length }
      : type === "number"
        ? { integerOnly: false, minValue: null, maxValue: null }
        : type === "text"
          ? { minLength: 0, maxLength: 2_000, digitsOnly: false }
          : {},
  options,
  jumpRules: [],
});
const target = question("q_target", "text");

describe("jump rule request validation", () => {
  it("rejects unknown fields and malformed IDs", () => {
    expect(() =>
      parseJumpRulesUpdate({ revision: 1, rules: [], extra: true }),
    ).toThrow();
    expect(() =>
      parseJumpRulesUpdate({
        revision: 1,
        rules: [
          {
            operator: "equals",
            value: "o_1",
            targetQuestionId: "bad id",
          },
        ],
      }),
    ).toThrow();
  });

  it("supports the full type/operator matrix", () => {
    const single = question("q_single", "single", [
      option("o_a"),
      option("o_b"),
    ]);
    expect(
      normalizeJumpRules(
        single,
        [single, target],
        [{ operator: "equals", value: "o_a", targetQuestionId: "q_target" }],
        20,
      )[0],
    ).toMatchObject({ operator: "equals", value: "o_a" });

    const multiple = question("q_multiple", "multiple", [
      option("o_a"),
      option("o_b"),
    ]);
    for (const operator of [
      "contains",
      "containsAll",
      "containsAny",
    ] as const) {
      const value = operator === "contains" ? "o_a" : ["o_b", "o_a"];
      const saved = normalizeJumpRules(
        multiple,
        [multiple, target],
        [{ operator, value, targetQuestionId: "q_target" }],
        20,
      )[0]!;
      expect(saved.operator).toBe(operator);
      if (Array.isArray(saved.value))
        expect(saved.value).toEqual(["o_a", "o_b"]);
    }

    const numeric = question("q_number", "number");
    for (const operator of ["equals", "gt", "gte", "lt", "lte"] as const)
      expect(
        normalizeJumpRules(
          numeric,
          [numeric, target],
          [{ operator, value: -0, targetQuestionId: "q_target" }],
          20,
        )[0],
      ).toMatchObject({ operator, value: 0 });
  });

  it("rejects self targets, foreign options, duplicate values, text rules and overflow", () => {
    const multiple = question("q_multiple", "multiple", [
      option("o_a"),
      option("o_b"),
    ]);
    const invalidCases = [
      [
        {
          operator: "contains",
          value: "o_foreign",
          targetQuestionId: "q_target",
        },
      ],
      [
        {
          operator: "containsAll",
          value: ["o_a", "o_a"],
          targetQuestionId: "q_target",
        },
      ],
      [{ operator: "contains", value: "o_a", targetQuestionId: "q_multiple" }],
    ];
    for (const rules of invalidCases)
      expect(() =>
        normalizeJumpRules(multiple, [multiple, target], rules as never, 20),
      ).toThrow();
    expect(() =>
      normalizeJumpRules(
        question("q_text", "text"),
        [question("q_text", "text"), target],
        [{ operator: "equals", value: "x", targetQuestionId: "q_target" }],
        20,
      ),
    ).toThrow();
    expect(() =>
      normalizeJumpRules(
        multiple,
        [multiple, target],
        Array.from({ length: 21 }, () => ({
          operator: "contains" as const,
          value: "o_a",
          targetQuestionId: "q_target",
        })),
        20,
      ),
    ).toThrow();
  });

  it("accepts only existing source rule IDs and rejects duplicates", () => {
    const source = question("q_single", "single", [
      option("o_a"),
      option("o_b"),
    ]);
    source.jumpRules = [
      {
        ruleId: "r_existing",
        operator: "equals",
        value: "o_a",
        targetQuestionId: "q_target",
      },
    ];
    expect(() =>
      normalizeJumpRules(
        source,
        [source, target],
        [
          {
            ruleId: "r_forged",
            operator: "equals",
            value: "o_a",
            targetQuestionId: "q_target",
          },
        ],
        20,
      ),
    ).toThrow();
    expect(() =>
      normalizeJumpRules(
        source,
        [source, target],
        [
          {
            ruleId: "r_existing",
            operator: "equals",
            value: "o_a",
            targetQuestionId: "q_target",
          },
          {
            ruleId: "r_existing",
            operator: "equals",
            value: "o_b",
            targetQuestionId: "q_target",
          },
        ],
        20,
      ),
    ).toThrow();
  });
});
