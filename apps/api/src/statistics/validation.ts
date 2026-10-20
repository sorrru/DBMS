import { validationError } from "../errors/api-error.js";

const questionIdPattern = /^q_[A-Za-z0-9_-]+$/;

export function parseStatisticsQuery(query: Record<string, unknown>): void {
  if (Object.keys(query).length)
    throw validationError("query", "统计接口不接受查询参数");
}

export function parseTextQuery(query: Record<string, unknown>): {
  questionId: string;
  limit: number;
  cursor?: string;
} {
  const allowed = new Set(["questionId", "limit", "cursor"]);
  if (Object.keys(query).some((key) => !allowed.has(key)))
    throw validationError("query", "包含未知查询参数");
  if (
    typeof query.questionId !== "string" ||
    !questionIdPattern.test(query.questionId)
  )
    throw validationError("questionId");
  const rawLimit = query.limit ?? "20";
  if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit))
    throw validationError("limit");
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw validationError("limit", "limit 必须是 1 至 50 的整数");
  if (query.cursor !== undefined && typeof query.cursor !== "string")
    throw validationError("cursor");
  return {
    questionId: query.questionId,
    limit,
    ...(typeof query.cursor === "string" ? { cursor: query.cursor } : {}),
  };
}
