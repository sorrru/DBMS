import { describe, expect, it } from "vitest";
import {
  computePath,
  evaluateNextQuestion,
  validateAnswer,
  validateForPublish,
  type SurveyQuestion,
} from "./index.js";

const option = (optionId: string) => ({ optionId, text: optionId });
const single = (
  questionId: string,
  required = false,
  jumpRules: SurveyQuestion["jumpRules"] = [],
): SurveyQuestion => ({
  questionId,
  type: "single",
  title: questionId,
  required,
  validation: {},
  options: [option(`${questionId}_a`), option(`${questionId}_b`)],
  jumpRules,
});
const numberQuestion = (
  questionId: string,
  jumpRules: SurveyQuestion["jumpRules"] = [],
): SurveyQuestion => ({
  questionId,
  type: "number",
  title: questionId,
  required: false,
  validation: { integerOnly: false, minValue: null, maxValue: null },
  options: [],
  jumpRules,
});

describe("routing", () => {
  it("uses the first matching rule and otherwise follows the default edge", () => {
    const questions = [
      single("q_1", false, [
        {
          ruleId: "r_first",
          operator: "equals",
          value: "q_1_a",
          targetQuestionId: "q_3",
        },
        {
          ruleId: "r_shadowed",
          operator: "equals",
          value: "q_1_a",
          targetQuestionId: "q_2",
        },
      ]),
      single("q_2"),
      single("q_3"),
    ];
    expect(evaluateNextQuestion(questions, "q_1", "q_1_a")).toEqual({
      kind: "question",
      questionId: "q_3",
    });
    expect(evaluateNextQuestion(questions, "q_1", null)).toEqual({
      kind: "question",
      questionId: "q_2",
    });
    expect(evaluateNextQuestion(questions, "q_1", ["q_1_a"])).toEqual({
      kind: "question",
      questionId: "q_2",
    });
  });

  it("supports numeric boundaries, normalizes -0, and detects actual loops", () => {
    const questions = [
      numberQuestion("q_1", [
        {
          ruleId: "r_gt",
          operator: "gt",
          value: 0,
          targetQuestionId: "q_3",
        },
      ]),
      numberQuestion("q_2"),
      numberQuestion("q_3", [
        {
          ruleId: "r_back",
          operator: "lte",
          value: 0,
          targetQuestionId: "q_1",
        },
      ]),
    ];
    expect(evaluateNextQuestion(questions, "q_1", -0)).toEqual({
      kind: "question",
      questionId: "q_2",
    });
    expect(computePath(questions, { q_1: 2, q_3: 0 })).toEqual({
      ok: false,
      questionIds: ["q_1", "q_3"],
      repeatedQuestionId: "q_1",
    });
  });

  it("evaluates every numeric operator and naturally ends after the last question", () => {
    const cases = [
      ["equals", 5, 5, true],
      ["equals", 5, 4, false],
      ["gt", 5, 6, true],
      ["gte", 5, 5, true],
      ["lt", 5, 4, true],
      ["lte", 5, 5, true],
    ] as const;
    for (const [operator, threshold, answer, matches] of cases) {
      const questions = [
        numberQuestion("q_1", [
          {
            ruleId: `r_${operator}`,
            operator,
            value: threshold,
            targetQuestionId: "q_3",
          },
        ]),
        numberQuestion("q_2"),
        numberQuestion("q_3"),
      ];
      expect(evaluateNextQuestion(questions, "q_1", answer)).toEqual({
        kind: "question",
        questionId: matches ? "q_3" : "q_2",
      });
    }
    expect(
      evaluateNextQuestion([numberQuestion("q_last")], "q_last", 1),
    ).toEqual({
      kind: "end",
    });
  });
});

describe("answer validation", () => {
  it("normalizes text and rejects a noncanonical number", () => {
    const text: SurveyQuestion = {
      questionId: "q_text",
      type: "text",
      title: "文本",
      required: true,
      validation: { minLength: 1, maxLength: 20, digitsOnly: false },
      options: [],
      jumpRules: [],
    };
    expect(validateAnswer(text, "  第一行\n第二行  ")).toEqual({
      ok: true,
      value: "第一行\n第二行",
      answered: true,
    });
    expect(validateAnswer(numberQuestion("q_n"), "5")).toMatchObject({
      ok: false,
    });
  });
});

describe("publish validation", () => {
  it("finds an unreachable question using the precise default-edge model", () => {
    const questions = [
      single("q_1", true, [
        {
          ruleId: "r_a",
          operator: "equals",
          value: "q_1_a",
          targetQuestionId: "q_3",
        },
        {
          ruleId: "r_b",
          operator: "equals",
          value: "q_1_b",
          targetQuestionId: "q_3",
        },
      ]),
      single("q_2"),
      single("q_3"),
    ];
    const result = validateForPublish(
      { revision: 4, deadline: null, questions },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.revision).toBe(4);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "QUESTION_UNREACHABLE",
        questionId: "q_2",
      }),
    );
  });

  it("reports each stable backward rule with its shortest cycle", () => {
    const questions = [
      single("q_1", false, [
        {
          ruleId: "r_forward",
          operator: "equals",
          value: "q_1_a",
          targetQuestionId: "q_3",
        },
      ]),
      single("q_2"),
      single("q_3", false, [
        {
          ruleId: "r_back",
          operator: "equals",
          value: "q_3_a",
          targetQuestionId: "q_2",
        },
      ]),
    ];
    const result = validateForPublish(
      { revision: 1, deadline: null, questions },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "JUMP_CYCLE",
        questionId: "q_3",
        ruleId: "r_back",
        questionIds: ["q_3", "q_2", "q_3"],
      }),
    );
  });

  it("reports structure, deadline, empty survey, and shadowed rules", () => {
    const empty = validateForPublish(
      { revision: 2, deadline: "2025-01-01T00:00:00Z", questions: [] },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(empty.errors.map(({ code }) => code)).toEqual([
      "DEADLINE_PASSED",
      "EMPTY_SURVEY",
    ]);

    const questions = [
      single("q_1", false, [
        {
          ruleId: "r_1",
          operator: "equals",
          value: "q_1_a",
          targetQuestionId: "q_2",
        },
        {
          ruleId: "r_2",
          operator: "equals",
          value: "q_1_a",
          targetQuestionId: "q_2",
        },
      ]),
      single("q_2"),
    ];
    const result = validateForPublish(
      { revision: 3, deadline: null, questions },
      new Date(),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "SHADOWED_RULE", ruleId: "r_2" }),
    );
  });

  it("matches graph guarantees against lazy path enumeration with a fixed seed", () => {
    let state = 0x5eed1234;
    const random = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    let loopingPaths = 0;
    let exploredPaths = 0;
    for (let size = 2; size <= 7; size += 1) {
      const questions = Array.from({ length: size }, (_unused, index) =>
        single(`q_${index + 1}`, true),
      );
      questions.forEach((question, from) => {
        question.options.forEach((choice, choiceIndex) => {
          if (random() < 0.45) return;
          let to = Math.floor(random() * size);
          if (to === from) to = (to + 1) % size;
          question.jumpRules.push({
            ruleId: `r_${from}_${choiceIndex}`,
            operator: "equals",
            value: choice.optionId,
            targetQuestionId: questions[to]!.questionId,
          });
        });
      });
      const check = validateForPublish(
        { revision: 1, deadline: null, questions },
        new Date("2026-01-01T00:00:00Z"),
      );
      const unreachable = new Set(
        check.warnings
          .filter(({ code }) => code === "QUESTION_UNREACHABLE")
          .map(({ questionId }) => questionId),
      );
      let graphLoops = 0;
      const walk = (questionId: string, path: string[]): void => {
        if (path.includes(questionId)) {
          graphLoops += 1;
          exploredPaths += 1;
          return;
        }
        expect(unreachable.has(questionId)).toBe(false);
        const question = questions.find(
          (candidate) => candidate.questionId === questionId,
        )!;
        for (const choice of question.options) {
          const next = evaluateNextQuestion(
            questions,
            question.questionId,
            choice.optionId,
          );
          if (next.kind === "end") exploredPaths += 1;
          else walk(next.questionId, [...path, questionId]);
        }
      };
      walk(questions[0]!.questionId, []);
      if (!check.errors.some(({ code }) => code === "JUMP_CYCLE"))
        expect(graphLoops).toBe(0);
      loopingPaths += graphLoops;
    }
    expect(exploredPaths).toBeGreaterThan(0);
    expect(loopingPaths / exploredPaths).toBeGreaterThanOrEqual(0);
    expect(loopingPaths / exploredPaths).toBeLessThanOrEqual(1);
  });
});
