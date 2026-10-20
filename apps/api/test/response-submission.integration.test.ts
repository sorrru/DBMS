import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { FillService } from "../src/fills/service.js";
import {
  fillSessionCookieName,
  sessionCookieName,
} from "../src/http/cookies.js";
import { FillSessionModel } from "../src/models/fill-session.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { UserModel } from "../src/models/user.js";
import { PasswordService } from "../src/security/password.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { TokenService } from "../src/security/token.js";
import { assertSafeTestDatabase } from "./database-safety.js";

const origin = "http://localhost:5173";
const testEnv = {
  ...env,
  mongoUri: process.env.MONGODB_URI!,
  production: false,
  rateLimitMaxKeys: 1_000,
  submissionAccountMax: 100,
  submissionSessionMax: 100,
};
const tokens = new TokenService(testEnv.jwtSecret);
const rateLimits = new FixedWindowStore(testEnv.rateLimitMaxKeys);
let now = new Date("2027-01-01T00:00:00.000Z");
const app = createApp(
  {
    env: testEnv,
    passwords: new PasswordService(
      {
        N: 1_024,
        r: 8,
        p: 1,
        maxmem: 8 * 1024 * 1024,
        saltBytes: 16,
        keyBytes: 32,
      },
      "",
    ),
    tokens,
    rateLimits,
  },
  () => new Date(now),
);

const authCookie = (userId: Types.ObjectId) =>
  `${sessionCookieName}=${tokens.sign(userId.toString())}`;
const firstCookie = (value: string) => value.split(";", 1)[0]!;
const tokenFromCookie = (cookie: string) =>
  decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));

async function user(username: string) {
  return UserModel.create({
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: "unused",
    registeredAt: now,
  });
}

async function fixture(
  ownerId: Types.ObjectId,
  options: {
    identityMode?: "anonymous" | "identified";
    allowMultipleSubmissions?: boolean;
  } = {},
) {
  const surveyId = new Types.ObjectId();
  const versionId = new Types.ObjectId();
  const publicId = `submit_${surveyId.toString()}`;
  await SurveyModel.create({
    _id: surveyId,
    ownerId,
    publicId,
    internalName: "提交测试",
    manualStatus: "open",
    currentVersionId: versionId,
    draftVersionId: null,
  });
  await SurveyVersionModel.create({
    _id: versionId,
    surveyId,
    versionNumber: 1,
    status: "published",
    revision: 5,
    title: "提交测试",
    description: "",
    identityMode: options.identityMode ?? "anonymous",
    allowMultipleSubmissions: options.allowMultipleSubmissions ?? false,
    deadline: new Date("2027-02-01T00:00:00.000Z"),
    sessionDurationMinutes: 30,
    questions: [
      {
        questionId: "q_1",
        type: "single",
        title: "选择路径",
        required: true,
        validation: {},
        options: [
          { optionId: "o_a", text: "经过第二题" },
          { optionId: "o_b", text: "跳过第二题" },
        ],
        jumpRules: [
          {
            ruleId: "r_skip",
            operator: "equals",
            value: "o_b",
            targetQuestionId: "q_3",
          },
        ],
      },
      {
        questionId: "q_2",
        type: "text",
        title: "必答文本",
        required: true,
        validation: { minLength: 2, maxLength: 20, digitsOnly: false },
        options: [],
        jumpRules: [],
      },
      {
        questionId: "q_3",
        type: "multiple",
        title: "多选",
        required: false,
        validation: { minSelections: 1, maxSelections: 2 },
        options: [
          { optionId: "o_x", text: "X" },
          { optionId: "o_y", text: "Y" },
        ],
        jumpRules: [],
      },
    ],
    schemaVersion: 1,
    publishedAt: now,
  });
  return { surveyId, versionId, publicId };
}

async function start(publicId: string, respondentId: Types.ObjectId) {
  const response = await request(app)
    .post(`/api/public/surveys/${publicId}/sessions`)
    .set("Origin", origin)
    .set("Content-Type", "application/json")
    .set("Cookie", authCookie(respondentId))
    .send({})
    .expect(201);
  return {
    sessionId: response.body.session.id as string,
    fillCookie: firstCookie(
      (response.headers["set-cookie"] as unknown as string[])[0]!,
    ),
  };
}

function submit(
  sessionId: string,
  respondentId: Types.ObjectId,
  fillCookie: string,
  body: object,
) {
  return request(app)
    .post(`/api/public/sessions/${sessionId}/submit`)
    .set("Origin", origin)
    .set("Content-Type", "application/json")
    .set("Cookie", [authCookie(respondentId), fillCookie])
    .send(body);
}

beforeAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  await mongoose.connect(testEnv.mongoUri);
  await Promise.all([
    UserModel.init(),
    SurveyModel.init(),
    SurveyVersionModel.init(),
    FillSessionModel.init(),
    SurveyResponseModel.init(),
  ]);
});

beforeEach(async () => {
  now = new Date("2027-01-01T00:00:00.000Z");
  rateLimits.reset();
  await Promise.all([
    SurveyResponseModel.deleteMany({}),
    FillSessionModel.deleteMany({}),
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  rateLimits.dispose();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("response submission", () => {
  it("creates all permanent response indexes", async () => {
    const indexes = await SurveyResponseModel.collection.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { fillSessionId: 1 }, unique: true }),
        expect.objectContaining({
          key: { surveyVersionId: 1, dedupKey: 1 },
          unique: true,
          partialFilterExpression: { dedupKey: { $type: "string" } },
        }),
        expect.objectContaining({
          key: { surveyVersionId: 1, submittedAt: -1, _id: -1 },
        }),
      ]),
    );
  });

  it("stores canonical path answers and clears the exact fill cookie", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await fixture(owner._id);
    const session = await start(survey.publicId, respondent._id);
    const response = await submit(
      session.sessionId,
      respondent._id,
      session.fillCookie,
      {
        answers: [
          { questionId: "q_1", value: "o_a" },
          { questionId: "q_2", value: "  正常回答  " },
          { questionId: "q_3", value: ["o_y", "o_x"] },
        ],
      },
    ).expect(201);
    expect(response.body.submission).toMatchObject({
      versionId: survey.versionId.toString(),
      questionPath: ["q_1", "q_2", "q_3"],
      ignoredQuestionIds: [],
      alreadySubmitted: false,
    });
    expect(response.body.submission).not.toHaveProperty("answers");
    const clearCookie = (
      response.headers["set-cookie"] as unknown as string[]
    ).find((item) => item.startsWith(`${fillSessionCookieName}=`))!;
    expect(clearCookie).toContain("Max-Age=0");
    expect(clearCookie).toContain(
      `Path=/api/public/sessions/${session.sessionId}`,
    );
    const saved = await SurveyResponseModel.findOne({
      fillSessionId: session.sessionId,
    }).lean();
    expect(saved?.answers).toEqual([
      { questionId: "q_1", value: "o_a" },
      { questionId: "q_2", value: "正常回答" },
      { questionId: "q_3", value: ["o_x", "o_y"] },
    ]);
    expect(saved).not.toHaveProperty("respondentId");
    expect(saved?.dedupKey).toBe(saved?.ownerKey);
    expect(
      await FillSessionModel.findById(session.sessionId).lean(),
    ).toMatchObject({ status: "submitted", activeSlot: null });
  });

  it("ignores business-invalid off-path values but rejects unknown IDs", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await fixture(owner._id);
    const session = await start(survey.publicId, respondent._id);
    const response = await submit(
      session.sessionId,
      respondent._id,
      session.fillCookie,
      {
        answers: [
          { questionId: "q_1", value: "o_b" },
          { questionId: "q_2", value: 7 },
          { questionId: "q_3", value: null },
        ],
      },
    ).expect(201);
    expect(response.body.submission).toMatchObject({
      questionPath: ["q_1", "q_3"],
      ignoredQuestionIds: ["q_2"],
    });

    const another = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const next = await start(another.publicId, respondent._id);
    const invalid = await submit(
      next.sessionId,
      respondent._id,
      next.fillCookie,
      { answers: [{ questionId: "q_unknown", value: "x" }] },
    ).expect(400);
    expect(invalid.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { path: "answers[0].questionId" },
    });
  });

  it("returns stable path-ordered validation issues", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await fixture(owner._id);
    const session = await start(survey.publicId, respondent._id);
    const response = await submit(
      session.sessionId,
      respondent._id,
      session.fillCookie,
      {
        answers: [
          { questionId: "q_1", value: "o_a" },
          { questionId: "q_3", value: ["o_x", "o_x"] },
        ],
      },
    ).expect(400);
    expect(response.body.error).toMatchObject({
      code: "ANSWER_VALIDATION_FAILED",
      details: {
        issues: [
          { questionId: "q_2", code: "REQUIRED", path: "" },
          {
            questionId: "q_3",
            code: "DUPLICATE_SELECTION",
            path: "answers[1].value",
          },
        ],
      },
    });
  });

  it("returns the original submission before state checks or body parsing", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await fixture(owner._id);
    const session = await start(survey.publicId, respondent._id);
    const first = await submit(
      session.sessionId,
      respondent._id,
      session.fillCookie,
      {
        answers: [
          { questionId: "q_1", value: "o_b" },
          { questionId: "q_3", value: null },
        ],
      },
    ).expect(201);
    now = new Date("2027-03-01T00:00:00.000Z");
    await SurveyModel.updateOne(
      { _id: survey.surveyId },
      { $set: { manualStatus: "closed" } },
    );
    const retried = await request(app)
      .post(`/api/public/sessions/${session.sessionId}/submit`)
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .set("Cookie", [authCookie(respondent._id), session.fillCookie])
      .send("{this is not json")
      .expect(200);
    expect(retried.body.submission).toMatchObject({
      id: first.body.submission.id,
      alreadySubmitted: true,
    });
  });

  it("authenticates before the dedicated large-body parser", async () => {
    const missing = new Types.ObjectId().toString();
    const response = await request(app)
      .post(`/api/public/sessions/${missing}/submit`)
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .send({ answers: [], padding: "x".repeat(300_000) })
      .expect(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("uses a 4 MiB limit only after ownership checks", async () => {
    const owner = await user("OwnerLarge");
    const respondent = await user("RespondentLarge");
    const survey = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const started = await start(survey.publicId, respondent._id);
    const response = await request(app)
      .post(`/api/public/sessions/${started.sessionId}/submit`)
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .set("Cookie", [authCookie(respondent._id), started.fillCookie])
      .send({ answers: [], padding: "x".repeat(4 * 1024 * 1024) })
      .expect(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("accepts a maximum-count large valid answer set", async () => {
    const owner = await user("OwnerMaximum");
    const respondent = await user("RespondentMaximum");
    const survey = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const questions = Array.from({ length: 100 }, (_, index) => ({
      questionId: `q_${index}`,
      type: "text" as const,
      title: `题目 ${index + 1}`,
      required: false,
      validation: { minLength: 0, maxLength: 2_000, digitsOnly: false },
      options: [],
      jumpRules: [],
    }));
    await SurveyVersionModel.updateOne(
      { _id: survey.versionId },
      { $set: { questions } },
    );
    const started = await start(survey.publicId, respondent._id);
    await submit(started.sessionId, respondent._id, started.fillCookie, {
      answers: questions.map((question) => ({
        questionId: question.questionId,
        value: "😀".repeat(2_000),
      })),
    }).expect(201);
    const saved = await SurveyResponseModel.findOne({
      fillSessionId: started.sessionId,
    }).lean();
    expect(saved?.answers).toHaveLength(100);
  });

  it("limits active submission attempts per account and session", async () => {
    const owner = await user("OwnerLimited");
    const respondent = await user("RespondentLimited");
    const survey = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const started = await start(survey.publicId, respondent._id);
    const limitedStore = new FixedWindowStore(100);
    const limitedApp = createApp(
      {
        env: {
          ...testEnv,
          submissionAccountMax: 1,
          submissionSessionMax: 1,
        },
        passwords: new PasswordService(
          {
            N: 1_024,
            r: 8,
            p: 1,
            maxmem: 8 * 1024 * 1024,
            saltBytes: 16,
            keyBytes: 32,
          },
          "",
        ),
        tokens,
        rateLimits: limitedStore,
      },
      () => new Date(now),
    );
    const activeRequest = () =>
      request(limitedApp)
        .post(`/api/public/sessions/${started.sessionId}/submit`)
        .set("Origin", origin)
        .set("Content-Type", "application/json")
        .set("Cookie", [authCookie(respondent._id), started.fillCookie])
        .send({ answers: [] });
    await activeRequest().expect(400);
    const limited = await activeRequest().expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeTruthy();
    limitedStore.dispose();
  });

  it("rejects closed, version-expired and session-expired active sessions", async () => {
    const owner = await user("OwnerStates");
    const respondent = await user("RespondentStates");

    const closed = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const closedSession = await start(closed.publicId, respondent._id);
    await SurveyModel.updateOne(
      { _id: closed.surveyId },
      { $set: { manualStatus: "closed" } },
    );
    expect(
      (
        await submit(
          closedSession.sessionId,
          respondent._id,
          closedSession.fillCookie,
          { answers: [] },
        ).expect(409)
      ).body.error.code,
    ).toBe("SURVEY_CLOSED");

    const expired = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const expiredSession = await start(expired.publicId, respondent._id);
    await SurveyVersionModel.updateOne(
      { _id: expired.versionId },
      { $set: { deadline: now } },
    );
    expect(
      (
        await submit(
          expiredSession.sessionId,
          respondent._id,
          expiredSession.fillCookie,
          { answers: [] },
        ).expect(409)
      ).body.error.code,
    ).toBe("SURVEY_EXPIRED");

    const timedOut = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const timedOutSession = await start(timedOut.publicId, respondent._id);
    await FillSessionModel.updateOne(
      { _id: timedOutSession.sessionId },
      { $set: { expiresAt: now } },
    );
    expect(
      (
        await submit(
          timedOutSession.sessionId,
          respondent._id,
          timedOutSession.fillCookie,
          { answers: [] },
        ).expect(409)
      ).body.error.code,
    ).toBe("SESSION_EXPIRED");
  });

  it("prevents a new session after a non-repeat response exists", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await fixture(owner._id);
    const session = await start(survey.publicId, respondent._id);
    await submit(session.sessionId, respondent._id, session.fillCookie, {
      answers: [
        { questionId: "q_1", value: "o_b" },
        { questionId: "q_3", value: null },
      ],
    }).expect(201);
    const duplicate = await request(app)
      .post(`/api/public/surveys/${survey.publicId}/sessions`)
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .set("Cookie", authCookie(respondent._id))
      .send({})
      .expect(409);
    expect(duplicate.body.error.code).toBe("ALREADY_SUBMITTED");
  });

  it("allows separate identified sessions when repeats are enabled", async () => {
    const owner = await user("OwnerIdentified");
    const respondent = await user("RespondentIdentified");
    const survey = await fixture(owner._id, {
      identityMode: "identified",
      allowMultipleSubmissions: true,
    });
    const first = await start(survey.publicId, respondent._id);
    const second = await start(survey.publicId, respondent._id);
    const body = {
      answers: [
        { questionId: "q_1", value: "o_b" },
        { questionId: "q_3", value: null },
      ],
    };
    await submit(
      first.sessionId,
      respondent._id,
      first.fillCookie,
      body,
    ).expect(201);
    await submit(
      second.sessionId,
      respondent._id,
      second.fillCookie,
      body,
    ).expect(201);
    const saved = await SurveyResponseModel.find({
      surveyVersionId: survey.versionId,
    }).lean();
    expect(saved).toHaveLength(2);
    expect(saved.every((item) => item.dedupKey === undefined)).toBe(true);
    expect(
      saved.every(
        (item) => item.respondentId?.toString() === respondent._id.toString(),
      ),
    ).toBe(true);
  });

  it("allows the same ownerKey to submit once to each version", async () => {
    const owner = await user("OwnerVersions");
    const respondent = await user("RespondentVersions");
    const survey = await fixture(owner._id);
    const firstVersionSession = await start(survey.publicId, respondent._id);
    const firstVersion = await SurveyVersionModel.findById(
      survey.versionId,
    ).lean();
    const secondVersionId = new Types.ObjectId();
    await SurveyVersionModel.create({
      ...firstVersion,
      _id: secondVersionId,
      versionNumber: 2,
      revision: 1,
      createdAt: undefined,
      updatedAt: undefined,
      publishedAt: now,
    });
    await SurveyModel.updateOne(
      { _id: survey.surveyId },
      { $set: { currentVersionId: secondVersionId } },
    );
    const secondVersionSession = await start(survey.publicId, respondent._id);
    const body = {
      answers: [
        { questionId: "q_1", value: "o_b" },
        { questionId: "q_3", value: null },
      ],
    };
    await submit(
      firstVersionSession.sessionId,
      respondent._id,
      firstVersionSession.fillCookie,
      body,
    ).expect(201);
    await submit(
      secondVersionSession.sessionId,
      respondent._id,
      secondVersionSession.fillCookie,
      body,
    ).expect(201);
    const saved = await SurveyResponseModel.find({
      surveyId: survey.surveyId,
    }).lean();
    expect(saved).toHaveLength(2);
    expect(
      new Set(saved.map((item) => item.surveyVersionId.toString())),
    ).toEqual(
      new Set([survey.versionId.toString(), secondVersionId.toString()]),
    );
    expect(new Set(saved.map((item) => item.ownerKey)).size).toBe(1);
  });

  it.each(["afterSessionSubmitted", "afterResponseCreated"] as const)(
    "fully rolls back a failure injected at %s",
    async (hook) => {
      const owner = await user(`Owner_${hook}`);
      const respondent = await user(`Respondent_${hook}`);
      const survey = await fixture(owner._id, {
        allowMultipleSubmissions: true,
      });
      const started = await start(survey.publicId, respondent._id);
      const service = new FillService(
        testEnv,
        () => new Date(now),
        async () => false,
        { [hook]: () => Promise.reject(new Error("injected failure")) },
      );
      await expect(
        service.submit(
          respondent._id,
          started.sessionId,
          tokenFromCookie(started.fillCookie),
          [
            { questionId: "q_1", value: "o_b", inputIndex: 0 },
            { questionId: "q_3", value: null, inputIndex: 1 },
          ],
        ),
      ).rejects.toThrow("injected failure");
      expect(
        await FillSessionModel.findById(started.sessionId).lean(),
      ).toMatchObject({ status: "active", activeSlot: 0, submittedAt: null });
      expect(
        await SurveyResponseModel.countDocuments({
          fillSessionId: started.sessionId,
        }),
      ).toBe(0);
    },
  );

  it("makes concurrent same-session retries converge on one response", async () => {
    const owner = await user("OwnerConcurrent");
    const respondent = await user("RespondentConcurrent");
    const survey = await fixture(owner._id, {
      allowMultipleSubmissions: true,
    });
    const started = await start(survey.publicId, respondent._id);
    const attempts = await Promise.all([
      submit(started.sessionId, respondent._id, started.fillCookie, {
        answers: [
          { questionId: "q_1", value: "o_b" },
          { questionId: "q_3", value: null },
        ],
      }),
      submit(started.sessionId, respondent._id, started.fillCookie, {
        answers: [
          { questionId: "q_1", value: "o_b" },
          { questionId: "q_3", value: null },
        ],
      }),
    ]);
    expect(attempts.map((item) => item.status).sort()).toEqual([200, 201]);
    expect(attempts[0]!.body.submission.id).toBe(
      attempts[1]!.body.submission.id,
    );
    expect(
      await SurveyResponseModel.countDocuments({
        fillSessionId: started.sessionId,
      }),
    ).toBe(1);
  });

  it("rolls back the losing session when two sessions race the dedup index", async () => {
    const owner = await user("OwnerDedup");
    const respondent = await user("RespondentDedup");
    const survey = await fixture(owner._id);
    const first = await start(survey.publicId, respondent._id);
    const second = await start(survey.publicId, respondent._id);
    const body = {
      answers: [
        { questionId: "q_1", value: "o_b" },
        { questionId: "q_3", value: null },
      ],
    };
    const attempts = await Promise.all([
      submit(first.sessionId, respondent._id, first.fillCookie, body),
      submit(second.sessionId, respondent._id, second.fillCookie, body),
    ]);
    expect(attempts.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(attempts.find((item) => item.status === 409)!.body.error.code).toBe(
      "ALREADY_SUBMITTED",
    );
    expect(await SurveyResponseModel.countDocuments({})).toBe(1);
    const losingSessionId =
      attempts[0]!.status === 409 ? first.sessionId : second.sessionId;
    expect(
      await FillSessionModel.findById(losingSessionId).lean(),
    ).toMatchObject({ status: "active", submittedAt: null });
  });
});
