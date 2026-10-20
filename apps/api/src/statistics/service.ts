import mongoose, {
  Types,
  type ClientSession,
  type PipelineStage,
} from "mongoose";
import type { AppEnv } from "../config/env.js";
import { ApiError, validationError } from "../errors/api-error.js";
import { SurveyResponseModel } from "../models/response.js";
import { SurveyModel } from "../models/survey.js";
import {
  SurveyVersionModel,
  type SurveyVersion,
} from "../models/survey-version.js";
import { UserModel } from "../models/user.js";
import { StatisticsCursorService } from "./cursor.js";
import {
  buildStatisticsPipelines,
  buildTextResponsePipeline,
  type StatisticsPipelineName,
} from "./pipelines.js";

export interface StatisticsHooks {
  afterPipeline?: (name: StatisticsPipelineName) => Promise<void> | void;
}

interface CountRow {
  _id: string | null;
  count: number;
}
interface SelectionRow {
  _id: { questionId: string; optionId: string };
  count: number;
}
interface NumberRow {
  _id: string;
  count: number;
  average: number;
  minimum: number;
  maximum: number;
}

const id = (value: Types.ObjectId | string) => new Types.ObjectId(value);
const rate = (part: number, total: number) => (total === 0 ? 0 : part / total);

function statisticsUnavailable(error: unknown): never {
  console.error(
    "统计查询不可用",
    error instanceof Error ? error.message : "unknown",
  );
  throw new ApiError(
    503,
    "STATISTICS_UNAVAILABLE",
    "统计暂时不可用，请稍后重试",
  );
}

function isTransactionUnavailable(error: unknown): boolean {
  const value = error as {
    code?: unknown;
    codeName?: unknown;
    errorLabels?: unknown;
  };
  return (
    value.code === 50 ||
    value.codeName === "MaxTimeMSExpired" ||
    (Array.isArray(value.errorLabels) &&
      value.errorLabels.includes("TransientTransactionError"))
  );
}

export class StatisticsService {
  constructor(
    private readonly env: Readonly<AppEnv>,
    private readonly cursors: StatisticsCursorService,
    private readonly hooks: StatisticsHooks = {},
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async ownedPublishedVersion(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
  ): Promise<{ version: SurveyVersion & { _id: Types.ObjectId } }> {
    const survey = await SurveyModel.findOne({ _id: surveyId, ownerId })
      .select({ _id: 1 })
      .lean();
    if (!survey) throw new ApiError(404, "SURVEY_NOT_FOUND", "问卷不存在");
    const version = await SurveyVersionModel.findOne({
      _id: versionId,
      surveyId,
    }).lean();
    if (!version) throw new ApiError(404, "SURVEY_NOT_FOUND", "问卷版本不存在");
    if (version.status !== "published")
      throw new ApiError(
        409,
        "VERSION_NOT_PUBLISHED",
        "只有已发布版本可以查看统计",
      );
    return { version: version as SurveyVersion & { _id: Types.ObjectId } };
  }

  private aggregate<T>(
    pipeline: PipelineStage[],
    session: ClientSession,
  ): Promise<T[]> {
    return SurveyResponseModel.aggregate<T>(pipeline)
      .session(session)
      .option({ maxTimeMS: this.env.statisticsMaxTimeMs })
      .exec();
  }

  async statistics(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    onAuthorized?: () => void,
  ) {
    const { version } = await this.ownedPublishedVersion(
      ownerId,
      surveyId,
      versionId,
    );
    onAuthorized?.();
    const versionObjectId = id(versionId);
    const selectionIds = version.questions
      .filter((q) => q.type === "single" || q.type === "multiple")
      .map((q) => q.questionId);
    const numberIds = version.questions
      .filter((q) => q.type === "number")
      .map((q) => q.questionId);
    const pipelines = buildStatisticsPipelines(
      versionObjectId,
      selectionIds,
      numberIds,
    );
    try {
      const results = await mongoose.connection.transaction(
        async (session) => {
          const totalRows = await this.aggregate<CountRow>(
            pipelines.total,
            session,
          );
          await this.hooks.afterPipeline?.("total");
          const reachedRows = await this.aggregate<CountRow>(
            pipelines.reached,
            session,
          );
          await this.hooks.afterPipeline?.("reached");
          const answeredRows = await this.aggregate<CountRow>(
            pipelines.answered,
            session,
          );
          await this.hooks.afterPipeline?.("answered");
          const selectionRows = selectionIds.length
            ? await this.aggregate<SelectionRow>(pipelines.selections, session)
            : [];
          await this.hooks.afterPipeline?.("selections");
          const numberRows = numberIds.length
            ? await this.aggregate<NumberRow>(pipelines.numbers, session)
            : [];
          await this.hooks.afterPipeline?.("numbers");
          return {
            totalRows,
            reachedRows,
            answeredRows,
            selectionRows,
            numberRows,
          };
        },
        { readConcern: { level: "snapshot" } },
      );
      const submissionCount = results.totalRows[0]?.count ?? 0;
      const reached = new Map(
        results.reachedRows.map((row) => [row._id, row.count]),
      );
      const answered = new Map(
        results.answeredRows.map((row) => [row._id, row.count]),
      );
      const selections = new Map(
        results.selectionRows.map((row) => [
          `${row._id.questionId}\u0000${row._id.optionId}`,
          row.count,
        ]),
      );
      const numbers = new Map(results.numberRows.map((row) => [row._id, row]));
      const questions = version.questions.map((question) => {
        const reachedCount = reached.get(question.questionId) ?? 0;
        const answeredCount = answered.get(question.questionId) ?? 0;
        const common = {
          questionId: question.questionId,
          type: question.type,
          title: question.title,
          required: question.required,
          reachedCount,
          answeredCount,
          notReachedCount: submissionCount - reachedCount,
          unansweredReachedCount: reachedCount - answeredCount,
          reachRate: rate(reachedCount, submissionCount),
          answerRate: rate(answeredCount, reachedCount),
        };
        if (question.type === "single" || question.type === "multiple")
          return {
            ...common,
            options: question.options.map((option) => {
              const count =
                selections.get(
                  `${question.questionId}\u0000${option.optionId}`,
                ) ?? 0;
              return {
                optionId: option.optionId,
                text: option.text,
                count,
                percentageOfAnswered: rate(count, answeredCount),
              };
            }),
          };
        if (question.type === "number") {
          const row = numbers.get(question.questionId);
          return {
            ...common,
            number: {
              count: row?.count ?? 0,
              average: row?.average ?? null,
              minimum: row?.minimum ?? null,
              maximum: row?.maximum ?? null,
            },
          };
        }
        return common;
      });
      const broken = questions.some((question) => {
        if (
          question.answeredCount > question.reachedCount ||
          question.reachedCount > submissionCount
        )
          return true;
        if (question.type === "single" && "options" in question)
          return (
            question.options.reduce((sum, option) => sum + option.count, 0) !==
            question.answeredCount
          );
        if (question.type === "multiple" && "options" in question)
          return question.options.some(
            (option) => option.count > question.answeredCount,
          );
        if (question.type === "number" && "number" in question)
          return question.number.count !== question.answeredCount;
        return false;
      });
      if (broken)
        console.error("统计数据不变量被破坏", { surveyId, versionId });
      return {
        surveyId,
        versionId,
        versionNumber: version.versionNumber,
        title: version.title,
        submissionCount,
        generatedAt: this.clock().toISOString(),
        questions,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isTransactionUnavailable(error)) statisticsUnavailable(error);
      throw error;
    }
  }

  async textResponses(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    questionId: string,
    limit: number,
    cursor?: string,
    onAuthorized?: () => void,
  ) {
    const { version } = await this.ownedPublishedVersion(
      ownerId,
      surveyId,
      versionId,
    );
    const question = version.questions.find(
      (item) => item.questionId === questionId,
    );
    if (!question) throw new ApiError(404, "QUESTION_NOT_FOUND", "题目不存在");
    if (question.type !== "text")
      throw validationError("questionId", "只有文本题支持查看逐条回答");
    onAuthorized?.();
    const decoded = cursor
      ? this.cursors.decode(cursor, { surveyId, versionId, questionId })
      : undefined;
    try {
      const rows = await SurveyResponseModel.aggregate<{
        _id: Types.ObjectId;
        submittedAt: Date;
        respondentId?: Types.ObjectId;
        value: string;
      }>(
        buildTextResponsePipeline(
          id(versionId),
          questionId,
          limit,
          decoded
            ? { submittedAt: new Date(decoded.submittedAt), id: id(decoded.id) }
            : undefined,
        ),
      )
        .hint({ surveyVersionId: 1, submittedAt: -1, _id: -1 })
        .option({ maxTimeMS: this.env.statisticsMaxTimeMs })
        .exec();
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      let users = new Map<string, { id: string; username: string }>();
      if (version.identityMode === "identified") {
        const userIds = page.flatMap((row) =>
          row.respondentId ? [row.respondentId] : [],
        );
        const documents = await UserModel.find({ _id: { $in: userIds } })
          .select({ username: 1 })
          .lean();
        users = new Map(
          documents.map((user) => [
            user._id.toString(),
            { id: user._id.toString(), username: user.username },
          ]),
        );
      }
      const items = page.map((row) =>
        version.identityMode === "anonymous"
          ? {
              value: row.value,
              submittedDate: row.submittedAt.toISOString().slice(0, 10),
            }
          : {
              value: row.value,
              submittedAt: row.submittedAt.toISOString(),
              respondent: row.respondentId
                ? (users.get(row.respondentId.toString()) ?? null)
                : null,
            },
      );
      const last = hasMore ? page.at(-1) : undefined;
      return {
        question: {
          questionId: question.questionId,
          title: question.title,
          required: question.required,
        },
        identityMode: version.identityMode,
        items,
        nextCursor: last
          ? this.cursors.encode({
              surveyId,
              versionId,
              questionId,
              submittedAt: last.submittedAt.toISOString(),
              id: last._id.toString(),
            })
          : null,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isTransactionUnavailable(error)) statisticsUnavailable(error);
      throw error;
    }
  }
}
