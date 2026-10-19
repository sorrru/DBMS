import { apiRequest } from "./auth";

export interface VersionSummary {
  id: string;
  versionNumber: number;
  title: string;
  revision: number;
}
export interface SurveySummary {
  id: string;
  publicId: string;
  internalName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: VersionSummary | null;
  draftVersion: VersionSummary | null;
}
export interface SurveyVersion {
  id: string;
  surveyId: string;
  versionNumber: number;
  status: "draft" | "published";
  revision: number;
  title: string;
  description: string;
  identityMode: "anonymous" | "identified";
  allowMultipleSubmissions: boolean;
  deadline: string | null;
  sessionDurationMinutes: number;
  questions: SurveyQuestion[];
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
export type QuestionType = "single" | "multiple" | "text" | "number";
export interface QuestionOption {
  optionId: string;
  text: string;
}
export interface SurveyQuestion {
  questionId: string;
  type: QuestionType;
  title: string;
  required: boolean;
  validation: Record<string, unknown>;
  options: QuestionOption[];
  jumpRules: unknown[];
}
export interface EditableQuestion {
  title: string;
  required: boolean;
  validation: Record<string, unknown>;
  options: Array<{ optionId?: string; text: string }>;
}
export type DraftFields = Pick<
  SurveyVersion,
  | "title"
  | "description"
  | "identityMode"
  | "allowMultipleSubmissions"
  | "deadline"
>;
export interface StoredDraft {
  revision: number;
  fields: DraftFields;
  savedAt: string;
}

const jsonPatch = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const createSurvey = (internalName: string) =>
  apiRequest<{ survey: SurveySummary }>("/api/surveys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ internalName }),
  });
export const listSurveys = (cursor?: string) =>
  apiRequest<{ items: SurveySummary[]; nextCursor: string | null }>(
    `/api/surveys?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
export const getVersion = (surveyId: string, versionId: string) =>
  apiRequest<{ version: SurveyVersion }>(
    `/api/surveys/${surveyId}/versions/${versionId}`,
  );
export const renameSurvey = (surveyId: string, internalName: string) =>
  apiRequest<{ survey: SurveySummary }>(
    `/api/surveys/${surveyId}`,
    jsonPatch({ internalName }),
  );
export const patchDraft = (
  surveyId: string,
  versionId: string,
  body: Record<string, unknown>,
) =>
  apiRequest<{ version: SurveyVersion; surveyUpdatedAt: string }>(
    `/api/surveys/${surveyId}/versions/${versionId}`,
    jsonPatch(body),
  );

export function buildQuestionPatch(
  revision: number,
  question: EditableQuestion,
): Record<string, unknown> {
  return {
    revision,
    title: question.title,
    required: question.required,
    validation: { ...question.validation },
    options: question.options.map((option) => ({
      ...(option.optionId ? { optionId: option.optionId } : {}),
      text: option.text,
    })),
  };
}

export const addQuestion = (
  surveyId: string,
  versionId: string,
  revision: number,
  type: QuestionType,
  question: EditableQuestion,
) =>
  apiRequest<{
    version: SurveyVersion;
    questionId: string;
    surveyUpdatedAt: string;
  }>(
    `/api/surveys/${surveyId}/versions/${versionId}/questions`,
    jsonRequest("POST", { type, ...buildQuestionPatch(revision, question) }),
  );

export const replaceQuestion = (
  surveyId: string,
  versionId: string,
  questionId: string,
  revision: number,
  question: EditableQuestion,
) =>
  apiRequest<{ version: SurveyVersion; surveyUpdatedAt: string }>(
    `/api/surveys/${surveyId}/versions/${versionId}/questions/${questionId}`,
    jsonPatch(buildQuestionPatch(revision, question)),
  );

export const deleteQuestion = (
  surveyId: string,
  versionId: string,
  questionId: string,
  revision: number,
) =>
  apiRequest<{ version: SurveyVersion; surveyUpdatedAt: string }>(
    `/api/surveys/${surveyId}/versions/${versionId}/questions/${questionId}`,
    jsonRequest("DELETE", { revision }),
  );

export const reorderQuestions = (
  surveyId: string,
  versionId: string,
  revision: number,
  questionIds: string[],
) =>
  apiRequest<{ version: SurveyVersion; surveyUpdatedAt: string }>(
    `/api/surveys/${surveyId}/versions/${versionId}/question-order`,
    jsonRequest("PUT", { revision, questionIds }),
  );

const prefix = (surveyId: string, versionId: string) =>
  `survey-settings-draft:${surveyId}:${versionId}:`;
export function saveSettingsDraft(
  surveyId: string,
  versionId: string,
  revision: number,
  fields: DraftFields,
): void {
  sessionStorage.setItem(
    `${prefix(surveyId, versionId)}${revision}`,
    JSON.stringify({
      revision,
      fields,
      savedAt: new Date().toISOString(),
    } satisfies StoredDraft),
  );
}
export function findSettingsDraft(
  surveyId: string,
  versionId: string,
): { key: string; draft: StoredDraft } | undefined {
  const target = prefix(surveyId, versionId);
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (!key?.startsWith(target)) continue;
    try {
      return {
        key,
        draft: JSON.parse(sessionStorage.getItem(key)!) as StoredDraft,
      };
    } catch {
      sessionStorage.removeItem(key);
    }
  }
  return undefined;
}
export function clearSettingsDraft(key: string): void {
  sessionStorage.removeItem(key);
}
export function changedDraftFields(
  original: DraftFields,
  current: DraftFields,
): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(original) as Array<keyof DraftFields>)
      .filter((key) => original[key] !== current[key])
      .map((key) => [key, current[key]]),
  );
}
