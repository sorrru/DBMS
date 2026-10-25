import { Types, type ClientSession } from "mongoose";
import type { SurveyQuestion } from "@survey/survey-logic";
import {
  QuestionUsageModel,
  type QuestionUsage,
} from "../models/question-usage.js";
interface Context {
  ownerId: Types.ObjectId;
  surveyId: string;
  versionId: string;
  status: "draft" | "published";
}
export function questionUsageRecords(
  context: Context,
  questions: SurveyQuestion[],
): QuestionUsage[] {
  return questions.flatMap((q) =>
    q.source
      ? [
          {
            ownerId: context.ownerId,
            surveyId: new Types.ObjectId(context.surveyId),
            surveyVersionId: new Types.ObjectId(context.versionId),
            questionId: q.questionId,
            libraryQuestionId: new Types.ObjectId(q.source.libraryQuestionId),
            questionVersionId: new Types.ObjectId(q.source.questionVersionId),
            status: context.status,
          },
        ]
      : [],
  );
}
export async function syncQuestionUsages(
  context: Context,
  before: SurveyQuestion[],
  after: SurveyQuestion[],
  session: ClientSession,
): Promise<void> {
  const previous = new Map(
    questionUsageRecords(context, before).map((r) => [r.questionId, r]),
  );
  const next = new Map(
    questionUsageRecords(context, after).map((r) => [r.questionId, r]),
  );
  const same = (a: QuestionUsage, b: QuestionUsage) =>
    a.libraryQuestionId.equals(b.libraryQuestionId) &&
    a.questionVersionId.equals(b.questionVersionId);
  const removed = [...previous.values()]
    .filter((r) => !next.has(r.questionId) || !same(r, next.get(r.questionId)!))
    .map((r) => r.questionId);
  if (removed.length)
    await QuestionUsageModel.deleteMany(
      { surveyVersionId: context.versionId, questionId: { $in: removed } },
      { session },
    );
  const added = [...next.values()].filter(
    (r) => !previous.has(r.questionId) || !same(r, previous.get(r.questionId)!),
  );
  if (added.length) await QuestionUsageModel.insertMany(added, { session });
}
