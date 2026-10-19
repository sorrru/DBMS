import { randomBytes } from "node:crypto";
import { validationError } from "../errors/api-error.js";

export type QuestionType = "single" | "multiple" | "text" | "number";

export interface QuestionOption {
  optionId: string;
  text: string;
}

export type QuestionValidation =
  | Record<string, never>
  | { minSelections: number; maxSelections: number }
  | { minLength: number; maxLength: number; digitsOnly: boolean }
  | {
      integerOnly: boolean;
      minValue: number | null;
      maxValue: number | null;
    };

export interface SurveyQuestion {
  questionId: string;
  type: QuestionType;
  title: string;
  required: boolean;
  validation: QuestionValidation;
  options: QuestionOption[];
  jumpRules: unknown[];
}

export interface RawOption {
  optionId?: string;
  text: string;
}

export interface RawQuestionDefinition {
  title: string;
  required: boolean;
  validation: Record<string, unknown>;
  options: RawOption[];
}

export interface RawCreateQuestion extends RawQuestionDefinition {
  revision: number;
  type: QuestionType;
}

export interface RawReplaceQuestion extends RawQuestionDefinition {
  revision: number;
}

export type AnswerResult =
  | { ok: true; value: string | string[] | number | null; answered: boolean }
  | { ok: false; path: string; reason: string };

const forbiddenCharacters = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const questionIdPattern = /^q_[A-Za-z0-9_-]+$/;
const optionIdPattern = /^o_[A-Za-z0-9_-]+$/;
const safeMaximum = Number.MAX_SAFE_INTEGER;

const fail = (path: string, message = "请求参数不符合要求"): never => {
  throw validationError(path, message);
};

const codePoints = (value: string): number => Array.from(value).length;

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail(unknown, "请求包含不允许的字段");
}

function positiveRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail("revision");
  return value as number;
}

function rawOptions(value: unknown, allowIds: boolean): RawOption[] {
  if (!Array.isArray(value)) fail("options");
  return (value as unknown[]).map((candidate, index) => {
    const option = plainObject(candidate, `options[${index}]`);
    exactKeys(option, new Set(allowIds ? ["optionId", "text"] : ["text"]));
    if (typeof option.text !== "string") fail(`options[${index}].text`);
    if (
      "optionId" in option &&
      (typeof option.optionId !== "string" ||
        !optionIdPattern.test(option.optionId))
    )
      fail(`options[${index}].optionId`);
    return {
      text: option.text as string,
      ...(typeof option.optionId === "string"
        ? { optionId: option.optionId }
        : {}),
    };
  });
}

function rawDefinition(
  value: Record<string, unknown>,
  allowIds: boolean,
): RawQuestionDefinition {
  if (typeof value.title !== "string") fail("title");
  if (typeof value.required !== "boolean") fail("required");
  return {
    title: value.title as string,
    required: value.required as boolean,
    validation: plainObject(value.validation, "validation"),
    options: rawOptions(value.options, allowIds),
  };
}

export function parseCreateQuestion(body: unknown): RawCreateQuestion {
  const value = plainObject(body, "body");
  exactKeys(
    value,
    new Set(["revision", "type", "title", "required", "validation", "options"]),
  );
  if (
    value.type !== "single" &&
    value.type !== "multiple" &&
    value.type !== "text" &&
    value.type !== "number"
  )
    fail("type");
  if ("required" in value && typeof value.required !== "boolean")
    fail("required");
  const withDefault = { ...value, required: value.required ?? false };
  return {
    revision: positiveRevision(value.revision),
    type: value.type as QuestionType,
    ...rawDefinition(withDefault, false),
  };
}

export function parseReplaceQuestion(body: unknown): RawReplaceQuestion {
  const value = plainObject(body, "body");
  exactKeys(
    value,
    new Set(["revision", "title", "required", "validation", "options"]),
  );
  return {
    revision: positiveRevision(value.revision),
    ...rawDefinition(value, true),
  };
}

export function parseRevision(body: unknown): number {
  const value = plainObject(body, "body");
  exactKeys(value, new Set(["revision"]));
  return positiveRevision(value.revision);
}

export function parseQuestionOrder(body: unknown): {
  revision: number;
  questionIds: string[];
} {
  const value = plainObject(body, "body");
  exactKeys(value, new Set(["revision", "questionIds"]));
  if (!Array.isArray(value.questionIds)) fail("questionIds");
  const questionIds = (value.questionIds as unknown[]).map((id, index) => {
    if (typeof id !== "string" || !questionIdPattern.test(id))
      fail(`questionIds[${index}]`);
    return id as string;
  });
  return { revision: positiveRevision(value.revision), questionIds };
}

export function validQuestionId(value: string): string {
  if (!questionIdPattern.test(value)) fail("questionId");
  return value;
}

function normalizedText(value: string, path: string, maximum: number): string {
  const normalized = value.normalize("NFC").trim();
  if (
    codePoints(normalized) < 1 ||
    codePoints(normalized) > maximum ||
    forbiddenCharacters.test(normalized)
  )
    fail(path);
  return normalized;
}

function integer(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) fail(path);
  return value as number;
}

function optionalNumber(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > safeMaximum
  )
    fail(path);
  return Object.is(value, -0) ? 0 : (value as number);
}

function normalizedValidation(
  type: QuestionType,
  candidate: Record<string, unknown>,
  optionCount: number,
): QuestionValidation {
  if (type === "single") {
    exactKeys(candidate, new Set());
    return {};
  }
  if (type === "multiple") {
    exactKeys(candidate, new Set(["minSelections", "maxSelections"]));
    const minSelections = integer(
      candidate.minSelections,
      "validation.minSelections",
      1,
    );
    const maxSelections = integer(
      candidate.maxSelections,
      "validation.maxSelections",
      optionCount,
    );
    if (
      minSelections < 1 ||
      minSelections > maxSelections ||
      maxSelections > optionCount
    )
      fail("validation.maxSelections");
    return { minSelections, maxSelections };
  }
  if (type === "text") {
    exactKeys(candidate, new Set(["minLength", "maxLength", "digitsOnly"]));
    const minLength = integer(candidate.minLength, "validation.minLength", 0);
    const maxLength = integer(
      candidate.maxLength,
      "validation.maxLength",
      2_000,
    );
    const digitsOnlyValue = candidate.digitsOnly ?? false;
    if (typeof digitsOnlyValue !== "boolean") fail("validation.digitsOnly");
    const digitsOnly = digitsOnlyValue as boolean;
    if (minLength < 0 || minLength > maxLength || maxLength > 2_000)
      fail("validation.maxLength");
    return { minLength, maxLength, digitsOnly };
  }
  exactKeys(candidate, new Set(["integerOnly", "minValue", "maxValue"]));
  const integerOnlyValue = candidate.integerOnly ?? false;
  if (typeof integerOnlyValue !== "boolean") fail("validation.integerOnly");
  const integerOnly = integerOnlyValue as boolean;
  const minValue = optionalNumber(candidate.minValue, "validation.minValue");
  const maxValue = optionalNumber(candidate.maxValue, "validation.maxValue");
  if (minValue !== null && maxValue !== null && minValue > maxValue)
    fail("validation.maxValue");
  if (
    integerOnly &&
    ((minValue !== null && !Number.isInteger(minValue)) ||
      (maxValue !== null && !Number.isInteger(maxValue)))
  )
    fail("validation.integerOnly");
  return { integerOnly, minValue, maxValue };
}

const newId = (prefix: "q" | "o", used: Set<string>): string => {
  let value: string;
  do value = `${prefix}_${randomBytes(12).toString("base64url")}`;
  while (used.has(value));
  used.add(value);
  return value;
};

export function normalizeQuestion(
  type: QuestionType,
  raw: RawQuestionDefinition,
  existing: SurveyQuestion | undefined,
  allQuestions: SurveyQuestion[],
): SurveyQuestion {
  const choice = type === "single" || type === "multiple";
  if (
    (choice && (raw.options.length < 2 || raw.options.length > 50)) ||
    (!choice && raw.options.length !== 0)
  )
    fail("options");
  const usedIds = new Set(
    allQuestions.flatMap((question) => [
      question.questionId,
      ...question.options.map((option) => option.optionId),
    ]),
  );
  const existingIds = new Set(
    existing?.options.map((option) => option.optionId),
  );
  const submittedIds = new Set<string>();
  const seenTexts = new Set<string>();
  const options = raw.options.map((option, index): QuestionOption => {
    if (option.optionId) {
      if (submittedIds.has(option.optionId)) fail(`options[${index}].optionId`);
      if (!existingIds.has(option.optionId)) fail(`options[${index}].optionId`);
      submittedIds.add(option.optionId);
    }
    const text = normalizedText(option.text, `options[${index}].text`, 200);
    if (seenTexts.has(text)) fail(`options[${index}].text`, "选项文字不能重复");
    seenTexts.add(text);
    return {
      optionId: option.optionId ?? newId("o", usedIds),
      text,
    };
  });
  return {
    questionId: existing?.questionId ?? newId("q", usedIds),
    type,
    title: normalizedText(raw.title, "title", 300),
    required: raw.required,
    validation: normalizedValidation(type, raw.validation, options.length),
    options,
    jumpRules: [],
  };
}

const answerFailure = (reason: string): AnswerResult => ({
  ok: false,
  path: "answer",
  reason,
});

export function validateAnswer(
  question: SurveyQuestion,
  candidate: unknown,
): AnswerResult {
  const missing = candidate === undefined || candidate === null;
  if (
    question.type === "multiple" &&
    Array.isArray(candidate) &&
    candidate.length === 0
  )
    return question.required
      ? answerFailure("此题为必答题")
      : { ok: true, value: null, answered: false };
  if (question.type === "text" && typeof candidate === "string") {
    const value = candidate.normalize("NFC").trim();
    if (value.length === 0)
      return question.required
        ? answerFailure("此题为必答题")
        : { ok: true, value: null, answered: false };
    const validation = question.validation as Extract<
      QuestionValidation,
      { minLength: number }
    >;
    const length = codePoints(value);
    if (length < validation.minLength || length > validation.maxLength)
      return answerFailure("文本长度不符合要求");
    if (validation.digitsOnly && !/^[0-9]+$/.test(value))
      return answerFailure("只能输入 ASCII 数字");
    return { ok: true, value, answered: true };
  }
  if (missing)
    return question.required
      ? answerFailure("此题为必答题")
      : { ok: true, value: null, answered: false };
  const allowed = new Set(question.options.map((option) => option.optionId));
  if (question.type === "single") {
    if (typeof candidate !== "string" || !allowed.has(candidate))
      return answerFailure("选项无效");
    return { ok: true, value: candidate, answered: true };
  }
  if (question.type === "multiple") {
    if (
      !Array.isArray(candidate) ||
      candidate.some((item) => typeof item !== "string")
    )
      return answerFailure("多选答案必须是选项 ID 数组");
    const values = candidate as string[];
    if (
      new Set(values).size !== values.length ||
      values.some((id) => !allowed.has(id))
    )
      return answerFailure("多选答案包含重复或无效选项");
    const validation = question.validation as Extract<
      QuestionValidation,
      { minSelections: number }
    >;
    if (
      values.length < validation.minSelections ||
      values.length > validation.maxSelections
    )
      return answerFailure("选择数量不符合要求");
    return { ok: true, value: values, answered: true };
  }
  if (question.type === "number") {
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      Math.abs(candidate) > safeMaximum
    )
      return answerFailure("必须是安全范围内的有限数值");
    const value = Object.is(candidate, -0) ? 0 : candidate;
    const validation = question.validation as Extract<
      QuestionValidation,
      { integerOnly: boolean }
    >;
    if (validation.integerOnly && !Number.isInteger(value))
      return answerFailure("必须是整数");
    if (validation.minValue !== null && value < validation.minValue)
      return answerFailure("数值小于最小值");
    if (validation.maxValue !== null && value > validation.maxValue)
      return answerFailure("数值大于最大值");
    return { ok: true, value, answered: true };
  }
  return answerFailure("答案类型错误");
}
