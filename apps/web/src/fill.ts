import {
  computePath,
  validateAnswer,
  type SurveyQuestion,
} from "@survey/survey-logic";
import { apiRequest } from "./auth";

export interface PublicSurvey {
  publicId: string;
  status: "published" | "closed" | "expired";
  title: string;
  description: string;
  identityMode: "anonymous" | "identified";
  deadline: string | null;
  questionCount: number;
  sessionDurationMinutes: number;
}

export interface PublicFillVersion {
  id: string;
  versionNumber: number;
  title: string;
  description: string;
  identityMode: "anonymous" | "identified";
  deadline: string | null;
  sessionDurationMinutes: number;
  questions: SurveyQuestion[];
}

export interface FillSessionResponse {
  session: {
    id: string;
    status: "active";
    expiresAt: string;
    serverNow: string;
  };
  version: PublicFillVersion;
}

export interface FillRoute {
  publicId: string;
  sessionId?: string;
}

export interface FillDraft {
  answers: Record<string, string | string[] | number>;
  currentQuestionId: string;
  savedAt: string;
}

const fillPath = /^\/fill\/([A-Za-z0-9_-]+)(?:\/session\/([A-Za-z0-9]+))?$/;
const maxDraftBytes = 2 * 1024 * 1024;

export function parseFillRoute(pathname: string): FillRoute | undefined {
  const match = fillPath.exec(pathname);
  if (!match) return undefined;
  return { publicId: match[1]!, ...(match[2] ? { sessionId: match[2] } : {}) };
}

export const safeFillReturnPath = (path: string): string | undefined =>
  fillPath.test(path) ? path : undefined;

export const fetchPublicSurvey = (publicId: string) =>
  apiRequest<{ survey: PublicSurvey }>(
    `/api/public/surveys/${encodeURIComponent(publicId)}`,
  );

export const createFillSession = (publicId: string) =>
  apiRequest<FillSessionResponse>(
    `/api/public/surveys/${encodeURIComponent(publicId)}/sessions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );

export const resumeFillSession = (sessionId: string) =>
  apiRequest<FillSessionResponse>(
    `/api/public/sessions/${encodeURIComponent(sessionId)}`,
  );

export const fillDraftKey = (sessionId: string, versionId: string) =>
  `fill-draft:${sessionId}:${versionId}`;

export function clearFillDraft(sessionId: string, versionId: string): void {
  sessionStorage.removeItem(fillDraftKey(sessionId, versionId));
}

export function saveFillDraft(
  sessionId: string,
  versionId: string,
  draft: FillDraft,
): void {
  const text = JSON.stringify(draft);
  if (new TextEncoder().encode(text).byteLength > maxDraftBytes)
    throw new Error("本地草稿超过 2 MiB 上限");
  sessionStorage.setItem(fillDraftKey(sessionId, versionId), text);
}

export function restoreFillDraft(
  sessionId: string,
  version: PublicFillVersion,
): FillDraft | undefined {
  const text = sessionStorage.getItem(fillDraftKey(sessionId, version.id));
  if (!text) return undefined;
  if (new TextEncoder().encode(text).byteLength > maxDraftBytes) {
    clearFillDraft(sessionId, version.id);
    return undefined;
  }
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error();
    const candidate = raw as Record<string, unknown>;
    if (
      !candidate.answers ||
      typeof candidate.answers !== "object" ||
      Array.isArray(candidate.answers) ||
      typeof candidate.currentQuestionId !== "string" ||
      typeof candidate.savedAt !== "string"
    )
      throw new Error();
    const answers: FillDraft["answers"] = {};
    for (const question of version.questions) {
      const value = (candidate.answers as Record<string, unknown>)[
        question.questionId
      ];
      if (value === undefined) continue;
      const result = validateAnswer(question, value);
      if (result.ok && result.answered && result.value !== null)
        answers[question.questionId] = result.value;
    }
    const path = computePath(version.questions, answers);
    const questionIds = path.questionIds;
    const currentQuestionId = questionIds.includes(candidate.currentQuestionId)
      ? candidate.currentQuestionId
      : questionIds.at(-1);
    if (!currentQuestionId) throw new Error();
    return {
      answers,
      currentQuestionId,
      savedAt: candidate.savedAt,
    };
  } catch {
    clearFillDraft(sessionId, version.id);
    return undefined;
  }
}
