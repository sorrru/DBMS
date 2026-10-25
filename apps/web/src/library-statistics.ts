import { apiRequest } from "./auth";
import type { LibraryDefinition } from "./library";
export interface StatisticsProfile {
  questionVersionId: string;
  versionNumber: number;
  definition: LibraryDefinition;
  sourceCount: number;
  surveyCount: number;
}
export interface StatisticsCatalog {
  libraryQuestionId: string;
  versions: StatisticsProfile[];
  sourceCount: number;
  scope: "own-published-surveys";
}
export interface StatisticsGroup {
  groupId: string;
  questionVersionIds: string[];
  opportunityCount: number;
  reachedCount: number;
  answeredCount: number;
  notReachedCount: number;
  unansweredReachedCount: number;
  reachRate: number;
  answerRate: number;
  sourceCount: number;
  surveyCount: number;
  options: {
    optionId: string;
    labels: string[];
    count: number;
    percentageOfAnswered: number;
  }[];
  number: {
    count: number;
    sum: number;
    average: number | null;
    minimum: number | null;
    maximum: number | null;
    buckets: { lower: number | null; upper: number | null; count: number }[];
  } | null;
}
export interface LibraryStatisticsResult {
  libraryQuestionId: string;
  merged: boolean;
  versions: StatisticsProfile[];
  groups: StatisticsGroup[];
  text: {
    items: {
      value: string;
      submittedDate: string;
      questionVersionId: string;
    }[];
    nextCursor: string | null;
  } | null;
  generatedAt: string;
}
export interface StatisticsInput {
  questionVersionIds: string[];
  merge: boolean;
  confirmMerge: boolean;
  boundaries: number[];
  limit?: number;
  cursor?: string;
}
const root = (id: string) => `/api/questions/${id}/statistics`;
export const libraryStatisticsCatalog = (id: string) =>
  apiRequest<StatisticsCatalog>(`${root(id)}/sources`);
export const queryLibraryStatistics = (id: string, input: StatisticsInput) =>
  apiRequest<LibraryStatisticsResult>(`${root(id)}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
