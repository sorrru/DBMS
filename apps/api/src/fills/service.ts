import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { computeSessionState, computeSurveyStatus } from "@survey/survey-logic";
import { isValidObjectId, Types } from "mongoose";
import type { AppEnv } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
import { FillSessionModel, type FillSession } from "../models/fill-session.js";
import { SurveyModel, type Survey } from "../models/survey.js";
import {
  SurveyVersionModel,
  type SurveyVersion,
} from "../models/survey-version.js";

type LeanSurvey = Survey & { _id: Types.ObjectId };
type LeanVersion = SurveyVersion & { _id: Types.ObjectId };
type LeanFillSession = FillSession & { _id: Types.ObjectId };

const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
const slotCount = 5;

export type SubmissionLookup = (
  surveyVersionId: Types.ObjectId,
  ownerKey: string,
) => Promise<boolean>;

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
    private readonly hasSubmitted: SubmissionLookup = async () => false,
  ) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      SurveyModel.init(),
      SurveyVersionModel.init(),
      FillSessionModel.init(),
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
