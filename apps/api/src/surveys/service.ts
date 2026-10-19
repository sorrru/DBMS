import { randomBytes } from "node:crypto";
import mongoose, { Types, type ClientSession } from "mongoose";
import type { AppEnv } from "../config/env.js";
import { ApiError, validationError } from "../errors/api-error.js";
import { SurveyModel, type Survey } from "../models/survey.js";
import {
  SurveyVersionModel,
  type SurveyVersion,
} from "../models/survey-version.js";
import type { SurveyCursorService } from "./cursor.js";
import type { DraftChanges } from "./validation.js";
import {
  normalizeQuestion,
  type RawCreateQuestion,
  type RawReplaceQuestion,
  type SurveyQuestion,
} from "./questions.js";

interface VersionSummary {
  id: string;
  versionNumber: number;
  title: string;
  revision: number;
}
export interface SurveySummary {
  id: string;
  publicId: string;
  internalName: string;
  status: "draft" | "open" | "closed" | "expired";
  createdAt: string;
  updatedAt: string;
  currentVersion: VersionSummary | null;
  draftVersion: VersionSummary | null;
}

export interface PublicVersion {
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

class ConditionalUpdateFailed extends Error {}

type LeanSurvey = Survey & { _id: Types.ObjectId };
type LeanVersion = SurveyVersion & { _id: Types.ObjectId };

const versionSummary = (version?: LeanVersion): VersionSummary | null =>
  version
    ? {
        id: version._id.toString(),
        versionNumber: version.versionNumber,
        title: version.title,
        revision: version.revision,
      }
    : null;

export function publicVersion(version: LeanVersion): PublicVersion {
  return {
    id: version._id.toString(),
    surveyId: version.surveyId.toString(),
    versionNumber: version.versionNumber,
    status: version.status,
    revision: version.revision,
    title: version.title,
    description: version.description,
    identityMode: version.identityMode,
    allowMultipleSubmissions: version.allowMultipleSubmissions,
    deadline: version.deadline?.toISOString() ?? null,
    sessionDurationMinutes: version.sessionDurationMinutes,
    questions: version.questions,
    schemaVersion: version.schemaVersion,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  };
}

export class SurveyService {
  constructor(
    private readonly env: Readonly<AppEnv>,
    private readonly cursors: SurveyCursorService,
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([SurveyModel.init(), SurveyVersionModel.init()]);
  }

  async create(
    ownerId: Types.ObjectId,
    internalName: string,
  ): Promise<SurveySummary> {
    if (
      (await SurveyModel.countDocuments({ ownerId })) >=
      this.env.surveyMaxPerUser
    )
      throw new ApiError(
        409,
        "SURVEY_LIMIT_REACHED",
        "已达到可创建的问卷数量上限",
      );
    await this.ensureIndexes();
    const surveyId = new Types.ObjectId();
    const versionId = new Types.ObjectId();
    const publicId = randomBytes(16).toString("base64url");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await SurveyModel.create(
          [
            {
              _id: surveyId,
              ownerId,
              publicId,
              internalName,
              manualStatus: "open",
              currentVersionId: null,
              draftVersionId: versionId,
            },
          ],
          { session },
        );
        await SurveyVersionModel.create(
          [
            {
              _id: versionId,
              surveyId,
              versionNumber: 1,
              status: "draft",
              revision: 1,
              title: internalName,
              description: "",
              identityMode: "anonymous",
              allowMultipleSubmissions: false,
              deadline: null,
              sessionDurationMinutes: 30,
              questions: [],
              schemaVersion: 1,
              publishedAt: null,
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    return this.get(ownerId, surveyId.toString());
  }

  async list(
    ownerId: Types.ObjectId,
    limit: number,
    cursorText?: string,
  ): Promise<{ items: SurveySummary[]; nextCursor: string | null }> {
    const cursor = cursorText ? this.cursors.decode(cursorText) : undefined;
    const filter: Record<string, unknown> = { ownerId };
    if (cursor)
      filter.$or = [
        { updatedAt: { $lt: cursor.updatedAt } },
        {
          updatedAt: cursor.updatedAt,
          _id: { $lt: new Types.ObjectId(cursor.id) },
        },
      ];
    const rows = (await SurveyModel.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec()) as LeanSurvey[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await this.summaries(page);
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              updatedAt: last.updatedAt,
              id: last._id.toString(),
            })
          : null,
    };
  }

  async get(ownerId: Types.ObjectId, surveyId: string): Promise<SurveySummary> {
    const survey = (await SurveyModel.findOne({ _id: surveyId, ownerId })
      .lean()
      .exec()) as LeanSurvey | null;
    if (!survey) throw this.notFound();
    return (await this.summaries([survey]))[0]!;
  }

  async rename(
    ownerId: Types.ObjectId,
    surveyId: string,
    internalName: string,
  ): Promise<SurveySummary> {
    const survey = await SurveyModel.findOneAndUpdate(
      { _id: surveyId, ownerId },
      { $set: { internalName, updatedAt: new Date() } },
      { returnDocument: "after" },
    )
      .lean()
      .exec();
    if (!survey) throw this.notFound();
    return (await this.summaries([survey as LeanSurvey]))[0]!;
  }

  async getVersion(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
  ): Promise<PublicVersion> {
    const survey = await SurveyModel.exists({ _id: surveyId, ownerId });
    if (!survey) throw this.notFound();
    const version = (await SurveyVersionModel.findOne({
      _id: versionId,
      surveyId,
    })
      .lean()
      .exec()) as LeanVersion | null;
    if (!version) throw this.notFound();
    return publicVersion(version);
  }

  async patchDraft(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    revision: number,
    changes: DraftChanges,
  ): Promise<{ version: PublicVersion; surveyUpdatedAt: string }> {
    await this.ensureIndexes();
    const session = await mongoose.startSession();
    const now = new Date();
    let updated: LeanVersion | null = null;
    try {
      await session.withTransaction(async () => {
        const survey = await SurveyModel.findOne({ _id: surveyId, ownerId })
          .session(session)
          .lean()
          .exec();
        if (!survey) throw new ConditionalUpdateFailed();
        updated = (await SurveyVersionModel.findOneAndUpdate(
          { _id: versionId, surveyId, status: "draft", revision },
          { $set: { ...changes, updatedAt: now }, $inc: { revision: 1 } },
          { returnDocument: "after", session, timestamps: false },
        )
          .lean()
          .exec()) as LeanVersion | null;
        if (!updated) throw new ConditionalUpdateFailed();
        const result = await SurveyModel.updateOne(
          { _id: surveyId, ownerId },
          { $set: { updatedAt: now } },
          { session, timestamps: false },
        );
        if (result.matchedCount !== 1) throw new ConditionalUpdateFailed();
      });
    } catch (error) {
      if (error instanceof ConditionalUpdateFailed)
        await this.diagnosePatch(ownerId, surveyId, versionId);
      throw error;
    } finally {
      await session.endSession();
    }
    if (!updated) throw new ApiError(500, "INTERNAL_ERROR", "服务器内部错误");
    return {
      version: publicVersion(updated),
      surveyUpdatedAt: now.toISOString(),
    };
  }

  async addQuestion(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    input: RawCreateQuestion,
  ): Promise<{
    version: PublicVersion;
    questionId: string;
    surveyUpdatedAt: string;
  }> {
    let questionId = "";
    const result = await this.mutateQuestions(
      ownerId,
      surveyId,
      versionId,
      input.revision,
      undefined,
      (questions) => {
        if (questions.length >= 100)
          throw new ApiError(
            409,
            "QUESTION_LIMIT_REACHED",
            "草稿已经达到 100 道题上限",
          );
        const question = normalizeQuestion(
          input.type,
          input,
          undefined,
          questions,
        );
        questionId = question.questionId;
        return [...questions, question];
      },
    );
    return { ...result, questionId };
  }

  replaceQuestion(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    questionId: string,
    input: RawReplaceQuestion,
  ): Promise<{ version: PublicVersion; surveyUpdatedAt: string }> {
    return this.mutateQuestions(
      ownerId,
      surveyId,
      versionId,
      input.revision,
      questionId,
      (questions, index) => {
        const current = questions[index!];
        const replacement = normalizeQuestion(
          current!.type,
          input,
          current,
          questions,
        );
        return questions.map((question, position) =>
          position === index ? replacement : question,
        );
      },
    );
  }

  deleteQuestion(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    questionId: string,
    revision: number,
  ): Promise<{ version: PublicVersion; surveyUpdatedAt: string }> {
    return this.mutateQuestions(
      ownerId,
      surveyId,
      versionId,
      revision,
      questionId,
      (questions, index) =>
        questions.filter((_question, position) => position !== index),
    );
  }

  reorderQuestions(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    revision: number,
    questionIds: string[],
  ): Promise<{ version: PublicVersion; surveyUpdatedAt: string }> {
    return this.mutateQuestions(
      ownerId,
      surveyId,
      versionId,
      revision,
      undefined,
      (questions) => {
        const unique = new Set(questionIds);
        const byId = new Map(
          questions.map((question) => [question.questionId, question]),
        );
        if (
          unique.size !== questionIds.length ||
          questionIds.length !== questions.length ||
          questionIds.some((id) => !byId.has(id))
        )
          throw validationError(
            "questionIds",
            "排序必须包含全部且不重复的题目 ID",
          );
        return questionIds.map((id) => byId.get(id)!);
      },
    );
  }

  private async mutateQuestions(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
    revision: number,
    questionId: string | undefined,
    mutation: (questions: SurveyQuestion[], index?: number) => SurveyQuestion[],
  ): Promise<{ version: PublicVersion; surveyUpdatedAt: string }> {
    await this.ensureIndexes();
    const session = await mongoose.startSession();
    const now = new Date();
    let updated: LeanVersion | null = null;
    try {
      await session.withTransaction(async () => {
        const survey = await SurveyModel.findOne({ _id: surveyId, ownerId })
          .session(session)
          .lean()
          .exec();
        if (!survey) throw new ConditionalUpdateFailed();
        const version = (await SurveyVersionModel.findOne({
          _id: versionId,
          surveyId,
        })
          .session(session)
          .lean()
          .exec()) as LeanVersion | null;
        if (!version) throw new ConditionalUpdateFailed();
        if (version.status !== "draft")
          throw new ApiError(409, "VERSION_NOT_EDITABLE", "目标版本不可编辑");
        if (version.revision !== revision) throw new ConditionalUpdateFailed();
        const questions = version.questions as SurveyQuestion[];
        const index = questionId
          ? questions.findIndex(
              (question) => question.questionId === questionId,
            )
          : undefined;
        if (questionId && index === -1)
          throw new ApiError(404, "QUESTION_NOT_FOUND", "题目不存在");
        const next = mutation(questions, index);
        updated = (await SurveyVersionModel.findOneAndUpdate(
          { _id: versionId, surveyId, status: "draft", revision },
          {
            $set: { questions: next, updatedAt: now },
            $inc: { revision: 1 },
          },
          { returnDocument: "after", session, timestamps: false },
        )
          .lean()
          .exec()) as LeanVersion | null;
        if (!updated) throw new ConditionalUpdateFailed();
        const result = await SurveyModel.updateOne(
          { _id: surveyId, ownerId },
          { $set: { updatedAt: now } },
          { session, timestamps: false },
        );
        if (result.matchedCount !== 1) throw new ConditionalUpdateFailed();
      });
    } catch (error) {
      if (error instanceof ConditionalUpdateFailed)
        await this.diagnosePatch(ownerId, surveyId, versionId);
      throw error;
    } finally {
      await session.endSession();
    }
    if (!updated) throw new ApiError(500, "INTERNAL_ERROR", "服务器内部错误");
    return {
      version: publicVersion(updated),
      surveyUpdatedAt: now.toISOString(),
    };
  }

  private async diagnosePatch(
    ownerId: Types.ObjectId,
    surveyId: string,
    versionId: string,
  ): Promise<never> {
    if (!(await SurveyModel.exists({ _id: surveyId, ownerId })))
      throw this.notFound();
    const version = await SurveyVersionModel.findOne({
      _id: versionId,
      surveyId,
    })
      .select({ status: 1, revision: 1 })
      .lean()
      .exec();
    if (!version) throw this.notFound();
    if (version.status !== "draft")
      throw new ApiError(409, "VERSION_NOT_EDITABLE", "目标版本不可编辑");
    throw new ApiError(409, "DRAFT_CONFLICT", "草稿已在其他页面修改", {
      currentRevision: version.revision,
    });
  }

  private async summaries(surveys: LeanSurvey[]): Promise<SurveySummary[]> {
    const ids = [
      ...new Set(
        surveys.flatMap((survey) =>
          [survey.draftVersionId, survey.currentVersionId]
            .filter(Boolean)
            .map(String),
        ),
      ),
    ];
    const versions = ids.length
      ? ((await SurveyVersionModel.find({ _id: { $in: ids } })
          .lean()
          .exec()) as LeanVersion[])
      : [];
    const byId = new Map(
      versions.map((version) => [version._id.toString(), version]),
    );
    return surveys.map((survey) => {
      const current = survey.currentVersionId
        ? byId.get(survey.currentVersionId.toString())
        : undefined;
      const status = !current
        ? "draft"
        : survey.manualStatus === "closed"
          ? "closed"
          : current.deadline && current.deadline <= new Date()
            ? "expired"
            : "open";
      return {
        id: survey._id.toString(),
        publicId: survey.publicId,
        internalName: survey.internalName,
        status,
        createdAt: survey.createdAt.toISOString(),
        updatedAt: survey.updatedAt.toISOString(),
        currentVersion: versionSummary(current),
        draftVersion: versionSummary(
          survey.draftVersionId
            ? byId.get(survey.draftVersionId.toString())
            : undefined,
        ),
      };
    });
  }

  private notFound(): ApiError {
    return new ApiError(404, "SURVEY_NOT_FOUND", "问卷不存在");
  }
}
