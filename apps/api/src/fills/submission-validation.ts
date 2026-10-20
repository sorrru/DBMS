import { ApiError } from "../errors/api-error.js";

export type SubmissionValue = string | string[] | number | null;

export interface SubmissionAnswerInput {
  questionId: string;
  value: SubmissionValue;
  inputIndex: number;
}

const questionIdPattern = /^q_[A-Za-z0-9_-]+$/;

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

function invalid(path: string, message: string): never {
  throw new ApiError(400, "VALIDATION_ERROR", message, { path, field: path });
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown)
    invalid(path ? `${path}.${unknown}` : unknown, "请求包含未知字段");
}

export function parseSubmissionBody(body: unknown): SubmissionAnswerInput[] {
  if (!plainObject(body)) invalid("", "请求体必须是 JSON 对象");
  exactKeys(body, ["answers"], "");
  if (!Array.isArray(body.answers)) invalid("answers", "answers 必须是数组");
  if (body.answers.length > 100) invalid("answers", "answers 最多包含 100 项");

  const seen = new Set<string>();
  return body.answers.map((candidate, inputIndex) => {
    const base = `answers[${inputIndex}]`;
    if (!plainObject(candidate)) invalid(base, "答案项必须是 JSON 对象");
    exactKeys(candidate, ["questionId", "value"], base);
    if (
      typeof candidate.questionId !== "string" ||
      !questionIdPattern.test(candidate.questionId)
    )
      invalid(`${base}.questionId`, "questionId 格式无效");
    if (seen.has(candidate.questionId))
      invalid(`${base}.questionId`, "questionId 不能重复");
    seen.add(candidate.questionId);
    if (!("value" in candidate)) invalid(`${base}.value`, "缺少 value");
    const value = candidate.value;
    const valid =
      value === null ||
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (Array.isArray(value) &&
        value.length <= 50 &&
        value.every((item) => typeof item === "string"));
    if (!valid)
      invalid(
        `${base}.value`,
        "value 必须是字符串、有限数值、最多 50 项的字符串数组或 null",
      );
    return {
      questionId: candidate.questionId,
      value: value as SubmissionValue,
      inputIndex,
    };
  });
}
