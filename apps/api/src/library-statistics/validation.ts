import { exact, object, validLibraryId } from "../library/validation.js";
import { validationError } from "../errors/api-error.js";
export interface LibraryStatisticsQuery {
  questionVersionIds: string[];
  merge: boolean;
  confirmMerge: boolean;
  boundaries: number[];
  limit: number;
  cursor?: string;
}
export function parseLibraryStatistics(body: unknown): LibraryStatisticsQuery {
  const v = object(body);
  exact(v, [
    "questionVersionIds",
    "merge",
    "confirmMerge",
    "boundaries",
    "limit",
    "cursor",
  ]);
  if (
    !Array.isArray(v.questionVersionIds) ||
    !v.questionVersionIds.length ||
    v.questionVersionIds.length > 50
  )
    throw validationError("questionVersionIds");
  const questionVersionIds = [
    ...new Set(
      v.questionVersionIds.map((id) =>
        validLibraryId(id, "questionVersionIds"),
      ),
    ),
  ].sort();
  for (const key of ["merge", "confirmMerge"])
    if (v[key] !== undefined && typeof v[key] !== "boolean")
      throw validationError(key);
  if (v.merge && questionVersionIds.length > 1 && v.confirmMerge !== true)
    throw validationError("confirmMerge", "请核对版本差异并明确确认合并");
  const boundaries = v.boundaries ?? [0, 18, 30, 45, 60, 120];
  if (
    !Array.isArray(boundaries) ||
    boundaries.length < 2 ||
    boundaries.length > 31 ||
    boundaries.some(
      (x, i) =>
        typeof x !== "number" ||
        !Number.isFinite(x) ||
        (i > 0 && x <= boundaries[i - 1]),
    )
  )
    throw validationError("boundaries");
  const limit = v.limit ?? 20;
  if (
    !Number.isInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 50
  )
    throw validationError("limit");
  if (
    v.cursor !== undefined &&
    (typeof v.cursor !== "string" || !v.cursor || v.cursor.length > 3000)
  )
    throw validationError("cursor");
  return {
    questionVersionIds,
    merge: v.merge === true,
    confirmMerge: v.confirmMerge === true,
    boundaries,
    limit: limit as number,
    ...(typeof v.cursor === "string" ? { cursor: v.cursor } : {}),
  };
}
