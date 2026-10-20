import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  computePath,
  computeSessionState,
  computeSurveyStatus,
  validateAnswer,
  validateForPublish,
  type AnswerIssueCode,
} from "@survey/survey-logic";
import mongoose, { isValidObjectId, Types, type ClientSession } from "mongoose";
import type { AppEnv } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
import { FillSessionModel, type FillSession } from "../models/fill-session.js";
import {
  SurveyResponseModel,
  type StoredAnswer,
  type SurveyResponse,
} from "../models/response.js";
import { SurveyModel, type Survey } from "../models/survey.js";
import {
  SurveyVersionModel,
  type SurveyVersion,
} from "../models/survey-version.js";
import type { SubmissionAnswerInput } from "./submission-validation.js";

type LeanSurvey = Survey & { _id: Types.ObjectId };
type LeanVersion = SurveyVersion & { _id: Types.ObjectId };
type LeanFillSession = FillSession & { _id: Types.ObjectId };
type LeanResponse = SurveyResponse & { _id: Types.ObjectId };

const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
const slotCount = 5;

export type SubmissionLookup = (
  surveyVersionId: Types.ObjectId,
  ownerKey: string,
) => Promise<boolean>;

export interface SubmissionTestHooks {
  afterSessionSubmitted?: () => Promise<void> | void;
  afterResponseCreated?: () => Promise<void> | void;
}

export interface SubmissionIssue {
  questionId: string;
  code: AnswerIssueCode;
  path: string;
  message: string;
}

function duplicateKeyPattern(error: unknown): Record<string, unknown> | null {
  const candidate = error as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
  };
  return candidate?.code === 11000 && candidate.keyPattern
    ? candidate.keyPattern
    : null;
}

const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const safeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

const storedSubmission = (
  response: LeanResponse,
  alreadySubmitted: boolean,
) => ({
  submission: {
    id: response._id.toString(),
    submittedAt: response.submittedAt.toISOString(),
    versionId: response.surveyVersionId.toString(),
    questionPath: response.questionPath,
    ignoredQuestionIds: response.ignoredQuestionIds,
    alreadySubmitted,
  },
});

const defaultSubmissionLookup: SubmissionLookup = async (
  surveyVersionId,
  ownerKey,
) =>
  Boolean(
    await SurveyResponseModel.exists({
      surveyVersionId,
      dedupKey: ownerKey,
    }).exec(),
  );

export function deriveOwnerKey(
  secret: string,
  surveyId: Types.ObjectId | string,
  userId: Types.ObjectId | string,
): string {
  return createHmac("sha256", secret)
    .update(`survey-owner:v1\0${surveyId.toString()}\0${userId.toString()}`)
    .digest("hex");
}

const publicQuestions = (version: LeanVersion) =>
  version.questions.map((question) => ({
    questionId: question.questionId,
    type: question.type,
    title: question.title,
    required: question.required,
    validation: question.validation,
    options: question.options.map(({ optionId, text }) => ({ optionId, text })),
    jumpRules: question.jumpRules.map(
      ({ ruleId, operator, value, targetQuestionId }) => ({
        ruleId,
        operator,
        value,
        targetQuestionId,
      }),
    ),
  }));

const publicVersion = (version: LeanVersion) => ({
  id: version._id.toString(),
  versionNumber: version.versionNumber,
  title: version.title,
  description: version.description,
  identityMode: version.identityMode,
  deadline: version.deadline?.toISOString() ?? null,
  sessionDurationMinutes: version.sessionDurationMinutes,
  questions: publicQuestions(version),
});

async function publishedSurvey(publicId: string): Promise<{
  survey: LeanSurvey;
  version: LeanVersion;
}> {
  const survey = await SurveyModel.findOne({ publicId })
    .lean<LeanSurvey>()
    .exec();
  if (!survey?.currentVersionId)
    throw new ApiError(404, "PUBLIC_SURVEY_NOT_FOUND", "公开问卷不存在");
  const version = await SurveyVersionModel.findOne({
    _id: survey.currentVersionId,
    surveyId: survey._id,
    status: "published",
  })
    .lean<LeanVersion>()
    .exec();
  if (!version)
    throw new ApiError(404, "PUBLIC_SURVEY_NOT_FOUND", "公开问卷不存在");
  return { survey, version };
}

export class FillService {
  constructor(
    private readonly env: Readonly<AppEnv>,
    private readonly clock: () => Date = () => new Date(),
    private readonly hasSubmitted: SubmissionLookup = defaultSubmissionLookup,
    private readonly submissionHooks: SubmissionTestHooks = {},
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      SurveyModel.init(),
      SurveyVersionModel.init(),
      FillSessionModel.init(),
      SurveyResponseModel.init(),
    ]);
  }

  async summary(publicId: string) {
    const { survey, version } = await publishedSurvey(publicId);
    return {
      publicId: survey.publicId,
      status: computeSurveyStatus(
        {
          currentVersionId: survey.currentVersionId?.toString() ?? null,
          manualStatus: survey.manualStatus,
        },
        version,
        this.clock(),
      ),
      title: version.title,
      description: version.description,
      identityMode: version.identityMode,
      deadline: version.deadline?.toISOString() ?? null,
      questionCount: version.questions.length,
      sessionDurationMinutes: version.sessionDurationMinutes,
    };
  }

  async create(userId: Types.ObjectId, publicId: string) {
    const now = this.clock();
    const { survey, version } = await publishedSurvey(publicId);
    const status = computeSurveyStatus(
      {
        currentVersionId: survey.currentVersionId?.toString() ?? null,
        manualStatus: survey.manualStatus,
      },
      version,
      now,
    );
    if (status === "closed")
      throw new ApiError(409, "SURVEY_CLOSED", "问卷已手工关闭");
    if (status === "expired")
      throw new ApiError(409, "SURVEY_EXPIRED", "问卷已超过截止时间");

    await this.ensureIndexes();
    const ownerKey = deriveOwnerKey(
      this.env.anonymousIdSecret,
      survey._id,
      userId,
    );
    if (
      !version.allowMultipleSubmissions &&
      (await this.hasSubmitted(version._id, ownerKey))
    )
      throw new ApiError(
        409,
        "ALREADY_SUBMITTED",
        "该账号已提交过这个问卷版本",
      );
    await this.releaseExpiredSlots(survey, ownerKey, now);

    const expiresAt = new Date(
      now.getTime() + version.sessionDurationMinutes * 60_000,
    );
    for (let activeSlot = 0; activeSlot < slotCount; activeSlot += 1) {
      const token = randomBytes(32).toString("base64url");
      const sessionId = new Types.ObjectId();
      try {
        await FillSessionModel.create({
          _id: sessionId,
          surveyId: survey._id,
          surveyVersionId: version._id,
          identityMode: version.identityMode,
          ownerKey,
          ...(version.identityMode === "identified" ? { userId } : {}),
          sessionTokenHash: tokenHash(token),
          status: "active",
          activeSlot,
          startedAt: now,
          expiresAt,
          purgeAt: new Date(expiresAt.getTime() + sevenDaysMs),
          submittedAt: null,
        });
        return {
          token,
          maxAgeSeconds: version.sessionDurationMinutes * 60,
          body: {
            session: {
              id: sessionId.toString(),
              status: "active" as const,
              expiresAt: expiresAt.toISOString(),
              serverNow: now.toISOString(),
            },
            version: publicVersion(version),
          },
        };
      } catch (error) {
        const pattern = duplicateKeyPattern(error);
        if (
          pattern?.surveyId === 1 &&
          pattern.ownerKey === 1 &&
          pattern.activeSlot === 1
        )
          continue;
        if (pattern?.sessionTokenHash === 1) {
          activeSlot -= 1;
          continue;
        }
        throw error;
      }
    }
    throw new ApiError(
      409,
      "SESSION_LIMIT_REACHED",
      "该问卷已有 5 个活动填写会话",
    );
  }

  async resume(userId: Types.ObjectId, sessionId: string, token?: string) {
    if (!token || !isValidObjectId(sessionId)) this.sessionNotFound();
    const session = await FillSessionModel.findOne({
      _id: sessionId,
      sessionTokenHash: tokenHash(token!),
    })
      .lean<LeanFillSession>()
      .exec();
    if (!session) this.sessionNotFound();
    const expectedOwnerKey = deriveOwnerKey(
      this.env.anonymousIdSecret,
      session!.surveyId,
      userId,
    );
    if (!safeEqual(session!.ownerKey, expectedOwnerKey)) this.sessionNotFound();

    const [survey, version] = await Promise.all([
      SurveyModel.findById(session!.surveyId).lean<LeanSurvey>().exec(),
      SurveyVersionModel.findOne({
        _id: session!.surveyVersionId,
        surveyId: session!.surveyId,
        status: "published",
      })
        .lean<LeanVersion>()
        .exec(),
    ]);
    if (!survey || !version) this.sessionNotFound();
    const now = this.clock();
    const state = computeSessionState(session!, survey!, version!, now);
    if (state === "closed")
      throw new ApiError(409, "SURVEY_CLOSED", "问卷已手工关闭");
    if (state === "survey_expired")
      throw new ApiError(409, "SURVEY_EXPIRED", "该填写版本已超过截止时间");
    if (state === "expired") {
      await this.expire(session!._id);
      throw new ApiError(409, "SESSION_EXPIRED", "填写会话已过期");
    }
    if (state !== "active")
      throw new ApiError(409, "ALREADY_SUBMITTED", "该会话已提交");
    return {
      session: {
        id: session!._id.toString(),
        status: "active" as const,
        expiresAt: session!.expiresAt.toISOString(),
        serverNow: now.toISOString(),
      },
      version: publicVersion(version!),
    };
  }

  async preflightSubmission(
    userId: Types.ObjectId,
    sessionId: string,
    token?: string,
  ): Promise<{ body: ReturnType<typeof storedSubmission> } | null> {
    const fillSession = await this.ownedSession(userId, sessionId, token);
    if (fillSession.status === "submitted") {
      const saved = await this.responseForSession(fillSession._id);
      return { body: storedSubmission(saved, true) };
    }
    return null;
  }

  async assertSubmissionActive(
    userId: Types.ObjectId,
    sessionId: string,
    token?: string,
  ): Promise<void> {
    const fillSession = await this.ownedSession(userId, sessionId, token);
    const [survey, version] = await this.sessionSurveyAndVersion(fillSession);
    const now = this.clock();
    const state = computeSessionState(fillSession, survey, version, now);
    if (state === "closed")
      throw new ApiError(409, "SURVEY_CLOSED", "问卷已手工关闭");
    if (state === "survey_expired")
      throw new ApiError(409, "SURVEY_EXPIRED", "该填写版本已超过截止时间");
    if (state === "expired") {
      await this.expire(fillSession._id);
      throw new ApiError(409, "SESSION_EXPIRED", "填写会话已过期");
    }
  }

  async submit(
    userId: Types.ObjectId,
    sessionId: string,
    token: string | undefined,
    inputs: SubmissionAnswerInput[],
  ): Promise<{
    created: boolean;
    body: ReturnType<typeof storedSubmission>;
  }> {
    if (!token || !isValidObjectId(sessionId)) this.sessionNotFound();
    await this.ensureIndexes();
    const databaseSession = await mongoose.startSession();
    let result:
      | { created: boolean; body: ReturnType<typeof storedSubmission> }
      | undefined;
    try {
      await databaseSession.withTransaction(async () => {
        result = undefined;
        const fillSession = await this.ownedSession(
          userId,
          sessionId,
          token,
          databaseSession,
        );
        if (fillSession.status === "submitted") {
          const saved = await this.responseForSession(
            fillSession._id,
            databaseSession,
          );
          result = { created: false, body: storedSubmission(saved, true) };
          return;
        }
        const [survey, version] = await this.sessionSurveyAndVersion(
          fillSession,
          databaseSession,
        );
        const now = this.clock();
        const state = computeSessionState(fillSession, survey, version, now);
        if (state === "closed")
          throw new ApiError(409, "SURVEY_CLOSED", "问卷已手工关闭");
        if (state === "survey_expired")
          throw new ApiError(409, "SURVEY_EXPIRED", "该填写版本已超过截止时间");
        if (state === "expired")
          throw new ApiError(409, "SESSION_EXPIRED", "填写会话已过期");

        const normalized = this.normalizeSubmission(version, inputs);
        const updated = await FillSessionModel.updateOne(
          {
            _id: fillSession._id,
            status: "active",
            expiresAt: { $gt: now },
          },
          {
            $set: {
              status: "submitted",
              submittedAt: now,
              activeSlot: null,
            },
          },
          { session: databaseSession },
        ).exec();
        if (updated.modifiedCount !== 1) {
          const current = await FillSessionModel.findById(fillSession._id)
            .session(databaseSession)
            .lean<LeanFillSession>()
            .exec();
          if (current?.status === "submitted") {
            const saved = await this.responseForSession(
              fillSession._id,
              databaseSession,
            );
            result = { created: false, body: storedSubmission(saved, true) };
            return;
          }
          throw new ApiError(409, "SESSION_EXPIRED", "填写会话已过期");
        }
        await this.submissionHooks.afterSessionSubmitted?.();

        const [created] = await SurveyResponseModel.create(
          [
            {
              surveyId: fillSession.surveyId,
              surveyVersionId: fillSession.surveyVersionId,
              fillSessionId: fillSession._id,
              ownerKey: fillSession.ownerKey,
              ...(version.allowMultipleSubmissions
                ? {}
                : { dedupKey: fillSession.ownerKey }),
              ...(fillSession.identityMode === "identified" &&
              fillSession.userId
                ? { respondentId: fillSession.userId }
                : {}),
              questionPath: normalized.questionPath,
              ignoredQuestionIds: normalized.ignoredQuestionIds,
              answers: normalized.answers,
              submittedAt: now,
            },
          ],
          { session: databaseSession },
        );
        await this.submissionHooks.afterResponseCreated?.();
        const leanCreated = created!.toObject() as LeanResponse;
        result = {
          created: true,
          body: storedSubmission(leanCreated, false),
        };
      });
    } catch (error) {
      const pattern = duplicateKeyPattern(error);
      if (pattern?.surveyVersionId === 1 && pattern.dedupKey === 1)
        throw new ApiError(
          409,
          "ALREADY_SUBMITTED",
          "该账号已提交过这个问卷版本",
        );
      if (pattern?.fillSessionId === 1) {
        const existing = await SurveyResponseModel.findOne({
          fillSessionId: sessionId,
        })
          .lean<LeanResponse>()
          .exec();
        if (existing)
          return {
            created: false,
            body: storedSubmission(existing, true),
          };
      }
      throw error;
    } finally {
      await databaseSession.endSession();
    }
    if (!result)
      throw new ApiError(500, "INTERNAL_ERROR", "回答事务未返回结果");
    return result;
  }

  private normalizeSubmission(
    version: LeanVersion,
    inputs: SubmissionAnswerInput[],
  ): {
    questionPath: string[];
    ignoredQuestionIds: string[];
    answers: StoredAnswer[];
  } {
    const structure = validateForPublish(
      version,
      new Date(0),
      this.env.jumpRuleMaxPerQuestion,
    );
    if (structure.errors.length) {
      console.error("发布版本结构损坏", {
        versionId: version._id.toString(),
        errors: structure.errors,
      });
      throw new ApiError(409, "SURVEY_VERSION_INVALID", "问卷版本结构无效");
    }
    const questionsById = new Map(
      version.questions.map((question) => [question.questionId, question]),
    );
    for (const input of inputs)
      if (!questionsById.has(input.questionId))
        throw new ApiError(400, "VALIDATION_ERROR", "题目不存在", {
          field: `answers[${input.inputIndex}].questionId`,
          path: `answers[${input.inputIndex}].questionId`,
        });

    const inputByQuestionId = new Map(
      inputs.map((input) => [input.questionId, input]),
    );
    const routingAnswers = Object.fromEntries(
      inputs.map((input) => [input.questionId, input.value]),
    );
    const path = computePath(version.questions, routingAnswers);
    if (!path.ok || path.questionIds.some((id) => !questionsById.has(id))) {
      console.error("提交时问卷路径出现循环或无效目标", {
        versionId: version._id.toString(),
        path,
      });
      throw new ApiError(409, "SURVEY_VERSION_INVALID", "问卷版本结构无效");
    }

    const issues: SubmissionIssue[] = [];
    const answers: StoredAnswer[] = [];
    for (const questionId of path.questionIds) {
      const question = questionsById.get(questionId)!;
      const input = inputByQuestionId.get(questionId);
      const checked = validateAnswer(question, input?.value);
      if (!checked.ok) {
        issues.push({
          questionId,
          code: checked.code,
          path: input ? `answers[${input.inputIndex}].value` : "",
          message: checked.reason,
        });
      } else if (checked.answered) {
        answers.push({
          questionId,
          value: checked.value as StoredAnswer["value"],
        });
      }
    }
    if (issues.length)
      throw new ApiError(
        400,
        "ANSWER_VALIDATION_FAILED",
        "部分回答不符合要求",
        { issues: issues.slice(0, 100) },
      );
    const pathSet = new Set(path.questionIds);
    const submittedIds = new Set(inputs.map((input) => input.questionId));
    return {
      questionPath: path.questionIds,
      ignoredQuestionIds: version.questions
        .map((question) => question.questionId)
        .filter(
          (questionId) =>
            submittedIds.has(questionId) && !pathSet.has(questionId),
        ),
      answers,
    };
  }

  private async ownedSession(
    userId: Types.ObjectId,
    sessionId: string,
    token?: string,
    databaseSession?: ClientSession,
  ): Promise<LeanFillSession> {
    if (!token || !isValidObjectId(sessionId)) this.sessionNotFound();
    const query = FillSessionModel.findOne({
      _id: sessionId,
      sessionTokenHash: tokenHash(token!),
    });
    if (databaseSession) query.session(databaseSession);
    const fillSession = await query.lean<LeanFillSession>().exec();
    if (!fillSession) this.sessionNotFound();
    const expectedOwnerKey = deriveOwnerKey(
      this.env.anonymousIdSecret,
      fillSession!.surveyId,
      userId,
    );
    if (!safeEqual(fillSession!.ownerKey, expectedOwnerKey))
      this.sessionNotFound();
    return fillSession!;
  }

  private async sessionSurveyAndVersion(
    fillSession: LeanFillSession,
    databaseSession?: ClientSession,
  ): Promise<[LeanSurvey, LeanVersion]> {
    const surveyQuery = SurveyModel.findById(fillSession.surveyId);
    const versionQuery = SurveyVersionModel.findOne({
      _id: fillSession.surveyVersionId,
      surveyId: fillSession.surveyId,
      status: "published",
    });
    if (databaseSession) {
      surveyQuery.session(databaseSession);
      versionQuery.session(databaseSession);
    }
    const [survey, version] = await Promise.all([
      surveyQuery.lean<LeanSurvey>().exec(),
      versionQuery.lean<LeanVersion>().exec(),
    ]);
    if (!survey || !version) {
      console.error("填写会话引用的问卷或版本不存在", {
        fillSessionId: fillSession._id.toString(),
      });
      throw new ApiError(409, "SURVEY_VERSION_INVALID", "问卷版本结构无效");
    }
    return [survey, version];
  }

  private async responseForSession(
    fillSessionId: Types.ObjectId,
    databaseSession?: ClientSession,
  ): Promise<LeanResponse> {
    const query = SurveyResponseModel.findOne({ fillSessionId });
    if (databaseSession) query.session(databaseSession);
    const response = await query.lean<LeanResponse>().exec();
    if (!response) {
      console.error("已提交会话缺少回答文档", {
        fillSessionId: fillSessionId.toString(),
      });
      throw new ApiError(409, "SURVEY_VERSION_INVALID", "提交记录结构无效");
    }
    return response;
  }

  private async releaseExpiredSlots(
    survey: LeanSurvey,
    ownerKey: string,
    now: Date,
  ): Promise<void> {
    const sessions = await FillSessionModel.find({
      surveyId: survey._id,
      ownerKey,
      status: "active",
    })
      .lean<LeanFillSession[]>()
      .exec();
    if (!sessions.length) return;
    const versionIds = [
      ...new Set(sessions.map((item) => item.surveyVersionId.toString())),
    ];
    const versions = await SurveyVersionModel.find({ _id: { $in: versionIds } })
      .lean<LeanVersion[]>()
      .exec();
    const byId = new Map(
      versions.map((version) => [version._id.toString(), version]),
    );
    await Promise.all(
      sessions.map(async (session) => {
        const version = byId.get(session.surveyVersionId.toString());
        const state = version
          ? computeSessionState(session, survey, version, now)
          : "expired";
        if (state === "expired" || state === "survey_expired")
          await this.expire(session._id);
      }),
    );
  }

  private async expire(sessionId: Types.ObjectId): Promise<void> {
    await FillSessionModel.updateOne(
      { _id: sessionId, status: "active" },
      { $set: { status: "expired", activeSlot: null } },
    ).exec();
  }

  private sessionNotFound(): never {
    throw new ApiError(404, "SESSION_NOT_FOUND", "填写会话不存在");
  }
}
