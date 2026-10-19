import { validationError } from "../errors/api-error.js";

const nameControl = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const descriptionControl =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/i;

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw validationError();
  return body as Record<string, unknown>;
}

function exactKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) throw validationError(unknown, "请求包含不允许的字段");
}

function text(
  value: unknown,
  field: string,
  max: number,
  allowNewlines = false,
): string {
  if (typeof value !== "string") throw validationError(field);
  const normalized = value.normalize("NFC").trim();
  const length = Array.from(normalized).length;
  if (
    length < 1 ||
    length > max ||
    (allowNewlines ? descriptionControl : nameControl).test(normalized)
  )
    throw validationError(field);
  return normalized;
}

export function validateCreateSurvey(body: unknown): { internalName: string } {
  const value = objectBody(body);
  exactKeys(value, new Set(["internalName"]));
  return { internalName: text(value.internalName, "internalName", 80) };
}

export function validateRenameSurvey(body: unknown): { internalName: string } {
  return validateCreateSurvey(body);
}

export interface DraftChanges {
  title?: string;
  description?: string;
  identityMode?: "anonymous" | "identified";
  allowMultipleSubmissions?: boolean;
  deadline?: Date | null;
}

export function validateDraftPatch(
  body: unknown,
  now = new Date(),
): { revision: number; changes: DraftChanges } {
  const value = objectBody(body);
  const allowed = new Set([
    "revision",
    "title",
    "description",
    "identityMode",
    "allowMultipleSubmissions",
    "deadline",
  ]);
  exactKeys(value, allowed);
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1)
    throw validationError("revision");
  const changes: DraftChanges = {};
  if ("title" in value) changes.title = text(value.title, "title", 120);
  if ("description" in value) {
    if (
      typeof value.description !== "string" ||
      Array.from(
        value.description.normalize("NFC").replace(/\r\n?/g, "\n").trim(),
      ).length > 2_000 ||
      descriptionControl.test(
        value.description.normalize("NFC").replace(/\r\n?/g, "\n").trim(),
      )
    )
      throw validationError("description");
    changes.description = value.description
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .trim();
  }
  if ("identityMode" in value) {
    if (
      value.identityMode !== "anonymous" &&
      value.identityMode !== "identified"
    )
      throw validationError("identityMode");
    changes.identityMode = value.identityMode;
  }
  if ("allowMultipleSubmissions" in value) {
    if (typeof value.allowMultipleSubmissions !== "boolean")
      throw validationError("allowMultipleSubmissions");
    changes.allowMultipleSubmissions = value.allowMultipleSubmissions;
  }
  if ("deadline" in value) {
    if (value.deadline === null) changes.deadline = null;
    else {
      if (
        typeof value.deadline !== "string" ||
        !hasTimezone.test(value.deadline)
      )
        throw validationError("deadline");
      const deadline = new Date(value.deadline);
      const maximum = new Date(now);
      maximum.setUTCFullYear(maximum.getUTCFullYear() + 5);
      if (
        Number.isNaN(deadline.getTime()) ||
        deadline <= now ||
        deadline > maximum
      )
        throw validationError("deadline");
      changes.deadline = deadline;
    }
  }
  if (Object.keys(changes).length === 0)
    throw validationError(undefined, "至少提交一个需要修改的字段");
  return { revision: value.revision as number, changes };
}

export function validateListQuery(
  limitValue: unknown,
  cursorValue: unknown,
): { limit: number; cursor?: string } {
  let limit = 20;
  if (limitValue !== undefined) {
    if (typeof limitValue !== "string" || !/^\d+$/.test(limitValue))
      throw validationError("limit");
    limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw validationError("limit");
  }
  if (
    cursorValue !== undefined &&
    (typeof cursorValue !== "string" ||
      cursorValue.length > 1_024 ||
      cursorValue.length === 0)
  )
    throw validationError("cursor");
  return {
    limit,
    ...(cursorValue === undefined ? {} : { cursor: cursorValue as string }),
  };
}
