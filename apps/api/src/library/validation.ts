import { validationError } from "../errors/api-error.js";
import {
  parseCreateQuestion,
  parseReplaceQuestion,
  type RawQuestionDefinition,
} from "../surveys/questions.js";
import type { QuestionType } from "@survey/survey-logic";
export const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw validationError("body");
  return v as Record<string, unknown>;
};
export function exact(v: Record<string, unknown>, keys: string[]): void {
  const bad = Object.keys(v).find((k) => !keys.includes(k));
  if (bad) throw validationError(bad, "请求包含不允许的字段");
}
export function revision(v: unknown, path = "contentRevision"): number {
  if (!Number.isSafeInteger(v) || (v as number) < 1)
    throw validationError(path);
  return v as number;
}
export function validLibraryId(v: unknown, path: string): string {
  if (typeof v !== "string" || !/^[a-f\d]{24}$/.test(v))
    throw validationError(path);
  return v;
}
const fields = ["title", "required", "validation", "options"];
export function parseLibraryCreate(
  body: unknown,
): RawQuestionDefinition & { type: QuestionType } {
  const v = object(body);
  exact(v, ["type", ...fields]);
  const parsed = parseCreateQuestion({ ...v, revision: 1 });
  return parsed;
}
export function parseLibraryEdit(
  body: unknown,
  branch = false,
): {
  contentRevision: number;
  definition: RawQuestionDefinition;
  sourceVersionId?: string;
} {
  const v = object(body);
  exact(v, [
    "contentRevision",
    ...fields,
    ...(branch ? ["sourceVersionId"] : []),
  ]);
  const { revision: _revision, ...definition } = parseReplaceQuestion({
    revision: revision(v.contentRevision),
    ...Object.fromEntries(fields.map((k) => [k, v[k]])),
  });
  return {
    contentRevision: revision(v.contentRevision),
    definition,
    ...(branch
      ? {
          sourceVersionId: validLibraryId(v.sourceVersionId, "sourceVersionId"),
        }
      : {}),
  };
}
export function parseLibraryRestore(body: unknown) {
  const v = object(body);
  exact(v, [
    "restoredFromVersionId",
    "sourceContentRevision",
    "baseVersionId",
    "baseContentRevision",
  ]);
  return {
    restoredFromVersionId: validLibraryId(
      v.restoredFromVersionId,
      "restoredFromVersionId",
    ),
    sourceContentRevision: revision(
      v.sourceContentRevision,
      "sourceContentRevision",
    ),
    baseVersionId: validLibraryId(v.baseVersionId, "baseVersionId"),
    baseContentRevision: revision(v.baseContentRevision, "baseContentRevision"),
  };
}
export function parseCopy(body: unknown): number {
  const v = object(body);
  exact(v, ["contentRevision"]);
  return revision(v.contentRevision);
}
export function parseLibraryList(query: Record<string, unknown>): {
  limit: number;
  cursor?: string;
} {
  exact(query, ["limit", "cursor"]);
  const limit =
    query.limit === undefined
      ? 20
      : typeof query.limit === "string" && /^[1-9]\d*$/.test(query.limit)
        ? Number(query.limit)
        : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw validationError("limit");
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== "string" ||
      query.cursor.length > 1500 ||
      !query.cursor)
  )
    throw validationError("cursor");
  return {
    limit,
    ...(typeof query.cursor === "string" ? { cursor: query.cursor } : {}),
  };
}

export function parseLibraryShare(body: unknown) {
  const v = object(body);
  exact(v, ["usernames", "questionVersionIds"]);
  if (
    !Array.isArray(v.usernames) ||
    v.usernames.length < 1 ||
    v.usernames.length > 50
  )
    throw validationError("usernames");
  const usernames = [
    ...new Set(
      v.usernames.map((name: unknown) => {
        if (
          typeof name !== "string" ||
          !/^[A-Za-z0-9_]{3,20}$/.test(name.trim())
        )
          throw validationError("usernames");
        return name.trim().toLowerCase();
      }),
    ),
  ];
  if (
    !Array.isArray(v.questionVersionIds) ||
    v.questionVersionIds.length < 1 ||
    v.questionVersionIds.length > 50
  )
    throw validationError("questionVersionIds");
  const questionVersionIds = [
    ...new Set(
      v.questionVersionIds.map((id: unknown) =>
        validLibraryId(id, "questionVersionIds"),
      ),
    ),
  ];
  return { usernames, questionVersionIds };
}
export function parseEmptyLibraryBody(body: unknown): void {
  exact(object(body), []);
}
