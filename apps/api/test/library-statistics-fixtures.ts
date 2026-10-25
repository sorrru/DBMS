import { Types } from "mongoose";
import type { QuestionType, LibraryVersionView } from "@survey/survey-logic";
import { env } from "../src/config/env.js";
import { LibraryService } from "../src/library/service.js";
import { LibraryCursor } from "../src/library/cursor.js";
import { SurveyService } from "../src/surveys/service.js";
import { SurveyCursorService } from "../src/surveys/cursor.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../src/models/library-question.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { QuestionShareModel } from "../src/models/question-share.js";
export const library = new LibraryService(new LibraryCursor(env.jwtSecret));
export const surveys = new SurveyService(
  env,
  new SurveyCursorService(env.jwtSecret),
);
export async function cleanStatisticsFixtures() {
  await Promise.all([
    SurveyResponseModel.deleteMany({}),
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    QuestionUsageModel.deleteMany({}),
    QuestionShareModel.deleteMany({}),
    LibraryOptionKeyModel.deleteMany({}),
    LibraryVersionModel.deleteMany({}),
    LibraryQuestionModel.deleteMany({}),
  ]);
}
export function createQuestion(
  user: Types.ObjectId,
  type: QuestionType = "number",
) {
  return library.create(user, {
    type,
    title: type === "number" ? "年龄" : "示例题",
    required: false,
    validation:
      type === "number"
        ? { integerOnly: false }
        : type === "multiple"
          ? { minSelections: 1, maxSelections: 2 }
          : {},
    options:
      type === "single" || type === "multiple"
        ? [{ text: "A" }, { text: "B" }]
        : [],
  });
}
export async function createSurvey(
  user: Types.ObjectId,
  versions: LibraryVersionView[],
) {
  const survey = await surveys.create(user, "统计测试问卷");
  let revision = 1;
  for (const v of versions) {
    const next = await surveys.addLibraryQuestion(
      user,
      survey.id,
      survey.draftVersion!.id,
      {
        revision,
        libraryQuestionId: v.libraryQuestionId,
        questionVersionId: v.questionVersionId,
        contentRevision: v.contentRevision,
      },
    );
    revision = next.version.revision;
  }
  await surveys.publish(
    user,
    survey.id,
    survey.draftVersion!.id,
    revision,
    true,
  );
  return {
    surveyId: survey.id,
    versionId: survey.draftVersion!.id,
    questions: (
      await surveys.getVersion(user, survey.id, survey.draftVersion!.id)
    ).questions,
  };
}
export async function addResponse(
  survey: Awaited<ReturnType<typeof createSurvey>>,
  values: (number | string | string[] | undefined)[],
  reached?: string[],
) {
  return SurveyResponseModel.create({
    surveyId: survey.surveyId,
    surveyVersionId: survey.versionId,
    fillSessionId: new Types.ObjectId(),
    ownerKey: "anon:test",
    questionPath: reached ?? survey.questions.map((q) => q.questionId),
    ignoredQuestionIds: [],
    answers: values.flatMap((value, i) =>
      value === undefined
        ? []
        : [{ questionId: survey.questions[i]!.questionId, value }],
    ),
    submittedAt: new Date("2026-10-22T10:11:12.345Z"),
  });
}
