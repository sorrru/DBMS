import type { Types } from "mongoose";
import { LibraryQuestionModel } from "../models/library-question.js";
import { QuestionBankModel } from "../models/question-bank.js";
import { QuestionShareModel } from "../models/question-share.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import { SurveyVersionModel } from "../models/survey-version.js";
export async function assertLegacySeedSafe(
  userIds: Types.ObjectId[],
  surveyIds: Types.ObjectId[],
) {
  const found = await Promise.all([
    LibraryQuestionModel.exists({ ownerId: { $in: userIds } }),
    QuestionBankModel.exists({ ownerId: { $in: userIds } }),
    QuestionShareModel.exists({ recipientId: { $in: userIds } }),
    QuestionUsageModel.exists({
      $or: [{ ownerId: { $in: userIds } }, { surveyId: { $in: surveyIds } }],
    }),
    SurveyVersionModel.exists({
      surveyId: { $in: surveyIds },
      "questions.source": { $exists: true },
    }),
  ]);
  if (found.some(Boolean))
    throw Error(
      "原 seed 账号已有第二阶段题目、题库、共享或来源数据，拒绝重建或清理。请保留现有账号，另用 seed:stage2 生成隔离演示数据。",
    );
}
