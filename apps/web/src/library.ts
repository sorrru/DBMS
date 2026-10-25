import { apiRequest } from "./auth";
import type {
  LibraryDefinition,
  LibraryQuestionView,
  LibraryVersionView,
} from "@survey/survey-logic";
export type { LibraryDefinition, LibraryQuestionView, LibraryVersionView };
export interface LibraryDetail {
  access: "owner" | "shared";
  question: LibraryQuestionView;
  version: LibraryVersionView;
  modificationStatus: {
    canEditInPlace: boolean;
    ownUsageCount: number;
    otherUsageCount: number;
  };
}
export type EditableLibraryDefinition = Omit<
  LibraryDefinition,
  "validation" | "options"
> & {
  validation: Record<string, unknown>;
  options: Array<{ optionId?: string; text: string }>;
};
export type LibraryPage = {
  items: Array<Pick<LibraryDetail, "question" | "version">>;
  nextCursor: string | null;
};
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const root = (q: string) => `/api/questions/${q}`;
const versionPath = (q: string, v: string) => `${root(q)}/versions/${v}`;
export const listLibraryQuestions = (cursor?: string) =>
  apiRequest<LibraryPage>(
    `/api/questions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
export const getLibraryVersion = (q: string, v?: string) =>
  apiRequest<LibraryDetail>(v ? versionPath(q, v) : root(q));
export const listLibraryVersions = (q: string, cursor?: string) =>
  apiRequest<{ items: LibraryVersionView[]; nextCursor: string | null }>(
    `${root(q)}/versions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
export const createLibraryQuestion = (definition: EditableLibraryDefinition) =>
  apiRequest<LibraryDetail>("/api/questions", json("POST", definition));
export const editLibraryVersion = (q: string, v: string, body: unknown) =>
  apiRequest<LibraryDetail>(versionPath(q, v), json("PATCH", body));
export const branchLibraryVersion = (q: string, body: unknown) =>
  apiRequest<LibraryDetail>(`${root(q)}/versions`, json("POST", body));
export const restoreLibraryVersion = (q: string, body: unknown) =>
  apiRequest<LibraryDetail>(`${root(q)}/restore`, json("POST", body));
export const copyLibraryQuestion = (
  q: string,
  v: string,
  contentRevision: number,
) =>
  apiRequest<LibraryDetail>(
    `${versionPath(q, v)}/copy`,
    json("POST", { contentRevision }),
  );

export function describeLibraryValidation(
  type: LibraryDefinition["type"],
  v: Record<string, unknown>,
): string {
  if (type === "single") return "单选，无附加限制";
  if (type === "multiple")
    return `选择 ${v.minSelections} 至 ${v.maxSelections} 项`;
  if (type === "text")
    return `${v.minLength} 至 ${v.maxLength} 字${v.digitsOnly ? "，仅 ASCII 数字" : ""}`;
  return `${v.integerOnly ? "仅整数" : "允许小数"}，最小值 ${v.minValue ?? "不限"}，最大值 ${v.maxValue ?? "不限"}`;
}

export function editableLibraryDefinition(
  d: LibraryDefinition,
): EditableLibraryDefinition {
  return {
    type: d.type,
    title: d.title,
    required: d.required,
    validation: { ...d.validation },
    options: d.options.map((o) => ({ ...o })),
  };
}

export const listSharedQuestions = (cursor?: string) =>
  apiRequest<LibraryPage>(
    `/api/questions/shared?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
export interface LibraryOwnUsage {
  surveyId: string;
  surveyVersionId: string;
  questionId: string;
  internalName: string;
  surveyVersionNumber: number;
  questionVersionNumber: number;
  status: "draft" | "published";
}
export interface LibraryOtherUsage {
  username: string;
  versionNumber: number;
  status: "draft" | "published";
  count: number;
}
export interface LibraryGrant {
  shareId: string;
  username: string;
  versionNumber: number;
}
const pageQuery = (cursor?: string) =>
  `?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
export const grantLibraryVersions = (
  q: string,
  usernames: string[],
  questionVersionIds: string[],
) =>
  apiRequest<{ accepted: boolean }>(
    `${root(q)}/shares`,
    json("POST", { usernames, questionVersionIds }),
  );
export const listLibraryGrants = (q: string, cursor?: string) =>
  apiRequest<{ items: LibraryGrant[]; nextCursor: string | null }>(
    `${root(q)}/shares${pageQuery(cursor)}`,
  );
export const revokeLibraryGrant = (q: string, shareId: string) =>
  apiRequest<void>(`${root(q)}/shares/${shareId}`, json("DELETE", {}));
export const listOwnLibraryUsages = (q: string, cursor?: string) =>
  apiRequest<{ items: LibraryOwnUsage[]; nextCursor: string | null }>(
    `${root(q)}/usages${pageQuery(cursor)}`,
  );
export const listOtherLibraryUsages = (q: string, cursor?: string) =>
  apiRequest<{ items: LibraryOtherUsage[]; nextCursor: string | null }>(
    `${root(q)}/usages/others${pageQuery(cursor)}`,
  );
