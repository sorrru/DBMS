import mongoose from "mongoose";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { UserModel } from "../src/models/user.js";
import { PasswordService } from "../src/security/password.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { TokenService } from "../src/security/token.js";
import { SurveyCursorService } from "../src/surveys/cursor.js";
import { SurveyService } from "../src/surveys/service.js";
import { assertSafeTestDatabase } from "./database-safety.js";

const origin = "http://localhost:5173";
const testProfile = {
  N: 1_024,
  r: 8,
  p: 1,
  maxmem: 8 * 1024 * 1024,
  saltBytes: 16,
  keyBytes: 32,
};
const testEnv = {
  ...env,
  registerLimit: 1_000,
  loginAccountLimit: 1_000,
  loginIpLimit: 1_000,
  surveyMaxPerUser: 100,
  surveyWriteRateLimit: 1_000,
  rateLimitMaxKeys: 1_000,
};
const passwords = new PasswordService(testProfile, "unused");
const tokens = new TokenService(testEnv.jwtSecret);
const rateLimits = new FixedWindowStore(1_000);
let app: ReturnType<typeof createApp>;
let cookie: string[];
let otherCookie: string[];

async function register(username: string): Promise<string[]> {
  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ username, password: "Password123" })
    .expect(201);
  const value = response.headers["set-cookie"]!;
  return Array.isArray(value) ? value : [value];
}

const createSurvey = (name = "课程反馈") =>
  request(app)
    .post("/api/surveys")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ internalName: name });

beforeAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  const dummy = await passwords.hash("DummyPassword123");
  app = createApp({
    env: testEnv,
    passwords: new PasswordService(testProfile, dummy),
    tokens,
    rateLimits,
  });
  await mongoose.connect(testEnv.mongoUri);
  await Promise.all([
    UserModel.init(),
    SurveyModel.init(),
    SurveyVersionModel.init(),
  ]);
});

beforeEach(async () => {
  rateLimits.reset();
  await Promise.all([
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
  cookie = await register("owner_user");
  otherCookie = await register("other_user");
});

afterAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("survey draft API", () => {
  it("creates a survey and v1 draft atomically with fixed public fields", async () => {
    const response = await createSurvey().expect(201);
    expect(response.body.survey).toMatchObject({
      internalName: "课程反馈",
      status: "draft",
      currentVersion: null,
      draftVersion: { versionNumber: 1, title: "课程反馈", revision: 1 },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/ownerId|__v/);
    const survey = await SurveyModel.findById(response.body.survey.id).lean();
    const version = await SurveyVersionModel.findById(
      response.body.survey.draftVersion.id,
    ).lean();
    expect(survey?.draftVersionId?.toString()).toBe(version?._id.toString());
    expect(version?.surveyId.toString()).toBe(survey?._id.toString());
    expect(version).toMatchObject({
      identityMode: "anonymous",
      allowMultipleSubmissions: false,
      deadline: null,
      revision: 1,
    });
  });

  it("rolls back when the second transaction insert fails", async () => {
    const create = vi
      .spyOn(SurveyVersionModel, "create")
      .mockRejectedValueOnce(new Error("forced failure"));
    await createSurvey("失败样例").expect(500);
    create.mockRestore();
    expect(await SurveyModel.countDocuments({ internalName: "失败样例" })).toBe(
      0,
    );
  });

  it("updates only changed draft fields and refreshes both timestamps", async () => {
    const created = await createSurvey().expect(201);
    const { id } = created.body.survey;
    const versionId = created.body.survey.draftVersion.id;
    const before = await SurveyVersionModel.findById(versionId).lean();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await request(app)
      .patch(`/api/surveys/${id}/versions/${versionId}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, title: "新标题", deadline: null })
      .expect(200);
    expect(response.body.version).toMatchObject({
      title: "新标题",
      revision: 2,
      deadline: null,
    });
    expect(new Date(response.body.version.updatedAt).getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    expect(response.body.surveyUpdatedAt).toBe(response.body.version.updatedAt);
  });

  it("renames the private management label without changing the public title", async () => {
    const created = await createSurvey("原名称").expect(201);
    const response = await request(app)
      .patch(`/api/surveys/${created.body.survey.id}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ internalName: "新管理名称" })
      .expect(200);
    expect(response.body.survey.internalName).toBe("新管理名称");
    expect(response.body.survey.draftVersion.title).toBe("原名称");
  });

  it("allows exactly one of two concurrent patches with the same revision", async () => {
    const created = await createSurvey().expect(201);
    const id = created.body.survey.id;
    const versionId = created.body.survey.draftVersion.id;
    const patch = (title: string) =>
      request(app)
        .patch(`/api/surveys/${id}/versions/${versionId}`)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ revision: 1, title });
    const results = await Promise.all([patch("标题一"), patch("标题二")]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const conflict = results.find((result) => result.status === 409)!;
    expect(conflict.body).toMatchObject({
      error: { code: "DRAFT_CONFLICT", details: { currentRevision: 2 } },
    });
  });

  it("hides another owner's survey and rejects internal or malformed fields", async () => {
    const created = await createSurvey().expect(201);
    await request(app)
      .get(`/api/surveys/${created.body.survey.id}`)
      .set("Cookie", otherCookie)
      .expect(404);
    await request(app)
      .post("/api/surveys")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ internalName: "x", ownerId: new mongoose.Types.ObjectId() })
      .expect(400);
    await request(app)
      .patch(
        `/api/surveys/${created.body.survey.id}/versions/${created.body.survey.draftVersion.id}`,
      )
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, deadline: { $gt: "2027-01-01" } })
      .expect(400);
  });

  it("validates pagination and rejects a tampered cursor", async () => {
    await Promise.all([createSurvey("一"), createSurvey("二")]);
    await request(app)
      .get("/api/surveys?limit=0")
      .set("Cookie", cookie)
      .expect(400);
    await request(app)
      .get("/api/surveys?limit=51")
      .set("Cookie", cookie)
      .expect(400);
    const first = await request(app)
      .get("/api/surveys?limit=1")
      .set("Cookie", cookie)
      .expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    await request(app)
      .get(
        `/api/surveys?cursor=${encodeURIComponent(`${first.body.nextCursor}x`)}`,
      )
      .set("Cookie", cookie)
      .expect(400);
  });

  it("loads all version summaries with one batch query", async () => {
    await Promise.all([createSurvey("一"), createSurvey("二")]);
    const find = vi.spyOn(SurveyVersionModel, "find");
    const response = await request(app)
      .get("/api/surveys")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body.items).toHaveLength(2);
    expect(find).toHaveBeenCalledTimes(1);
    find.mockRestore();
  });

  it("requires JSON for every body-bearing survey endpoint", async () => {
    await request(app)
      .post("/api/surveys")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .type("text")
      .send("x")
      .expect(415);
  });

  it("distinguishes a published version from a missing survey", async () => {
    const created = await createSurvey().expect(201);
    const versionId = created.body.survey.draftVersion.id;
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { $set: { status: "published" } },
    );
    const response = await request(app)
      .patch(`/api/surveys/${created.body.survey.id}/versions/${versionId}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, title: "不能修改" })
      .expect(409);
    expect(response.body.error.code).toBe("VERSION_NOT_EDITABLE");
  });

  it("enforces the configurable survey quantity limit", async () => {
    const limitedApp = createApp({
      env: { ...testEnv, surveyMaxPerUser: 1 },
      passwords,
      tokens,
      rateLimits: new FixedWindowStore(100),
    });
    await request(limitedApp)
      .post("/api/surveys")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ internalName: "第一份" })
      .expect(201);
    const response = await request(limitedApp)
      .post("/api/surveys")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ internalName: "第二份" })
      .expect(409);
    expect(response.body.error.code).toBe("SURVEY_LIMIT_REACHED");
  });

  it("rate limits survey writes per authenticated user", async () => {
    const limitedApp = createApp({
      env: { ...testEnv, surveyWriteRateLimit: 1 },
      passwords,
      tokens,
      rateLimits: new FixedWindowStore(100),
    });
    const created = await request(limitedApp)
      .post("/api/surveys")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ internalName: "第一写入" })
      .expect(201);
    const response = await request(limitedApp)
      .patch(`/api/surveys/${created.body.survey.id}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ internalName: "第二写入" })
      .expect(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
  });

  it("keeps create-version and discard error ordering reachable", async () => {
    const created = await createSurvey().expect(201);
    const { id, draftVersion } = created.body.survey;
    const createResponse = await request(app)
      .post(`/api/surveys/${id}/versions`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ sourceVersionId: draftVersion.id })
      .expect(409);
    expect(createResponse.body.error.code).toBe("SURVEY_NOT_PUBLISHED");
    const discardResponse = await request(app)
      .delete(`/api/surveys/${id}/versions/${draftVersion.id}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1 })
      .expect(409);
    expect(discardResponse.body.error).toMatchObject({
      code: "SURVEY_NOT_PUBLISHED",
      message: "初始草稿不能放弃",
    });
  });

  it("blocks empty publication and requires explicit warning acknowledgement", async () => {
    const created = await createSurvey().expect(201);
    const { id, draftVersion } = created.body.survey;
    await request(app)
      .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1 })
      .expect(400);
    const blocked = await request(app)
      .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, acknowledgeWarnings: false })
      .expect(409);
    expect(blocked.body.error.code).toBe("PUBLISH_BLOCKED");
    expect(blocked.body.error.details.check).toMatchObject({
      revision: 1,
      valid: false,
      errors: [expect.objectContaining({ code: "EMPTY_SURVEY" })],
    });
    await SurveyVersionModel.updateOne(
      { _id: draftVersion.id },
      {
        $set: {
          questions: [
            {
              questionId: "q_cycle_1",
              type: "text",
              title: "第一题",
              required: false,
              validation: {
                minLength: 0,
                maxLength: 2_000,
                digitsOnly: false,
              },
              options: [],
              jumpRules: [],
            },
            {
              questionId: "q_cycle_2",
              type: "number",
              title: "第二题",
              required: false,
              validation: {
                integerOnly: false,
                minValue: null,
                maxValue: null,
              },
              options: [],
              jumpRules: [
                {
                  ruleId: "r_cycle",
                  operator: "equals",
                  value: 1,
                  targetQuestionId: "q_cycle_1",
                },
              ],
            },
          ],
        },
      },
    );
    const cycle = await request(app)
      .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, acknowledgeWarnings: false })
      .expect(409);
    expect(cycle.body.error.details.check.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "JUMP_CYCLE" })]),
    );
  });

  it("publishes v1, creates and discards v2, lists history and changes status", async () => {
    const created = await createSurvey().expect(201);
    const { id, draftVersion } = created.body.survey;
    await SurveyVersionModel.updateOne(
      { _id: draftVersion.id },
      {
        $set: {
          questions: [
            {
              questionId: "q_publish",
              type: "text",
              title: "反馈",
              required: false,
              validation: {
                minLength: 0,
                maxLength: 2_000,
                digitsOnly: false,
              },
              options: [],
              jumpRules: [],
            },
          ],
        },
      },
    );
    const published = await request(app)
      .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, acknowledgeWarnings: false })
      .expect(200);
    expect(published.body.survey).toMatchObject({
      status: "published",
      currentVersion: { id: draftVersion.id, deadline: null },
      draftVersion: null,
    });
    expect(published.body.version).toMatchObject({
      status: "published",
      revision: 1,
    });

    const next = await request(app)
      .post(`/api/surveys/${id}/versions`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ sourceVersionId: draftVersion.id })
      .expect(201);
    expect(next.body.version).toMatchObject({
      versionNumber: 2,
      status: "draft",
      revision: 1,
    });
    expect(next.body.version.questions[0].questionId).toBe("q_publish");
    const v1Before = await SurveyVersionModel.findById(draftVersion.id).lean();
    await SurveyVersionModel.updateOne(
      { _id: next.body.version.id },
      {
        $set: {
          title: "只修改 v2",
          "questions.0.title": "只修改 v2 的题目",
          "questions.0.jumpRules": [],
        },
      },
    );
    expect(await SurveyVersionModel.findById(draftVersion.id).lean()).toEqual(
      v1Before,
    );

    const history = await request(app)
      .get(`/api/surveys/${id}/versions?limit=1`)
      .set("Cookie", cookie)
      .expect(200);
    expect(history.body.items[0]).toMatchObject({
      versionNumber: 2,
      questionCount: 1,
      isDraft: true,
    });
    expect(history.body.nextCursor).toEqual(expect.any(String));
    await request(app)
      .get(`/api/surveys?cursor=${encodeURIComponent(history.body.nextCursor)}`)
      .set("Cookie", cookie)
      .expect(400);

    const closed = await request(app)
      .patch(`/api/surveys/${id}/status`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ manualStatus: "closed" })
      .expect(200);
    expect(closed.body.survey.status).toBe("closed");
    const closedAt = closed.body.survey.updatedAt;
    const idempotent = await request(app)
      .patch(`/api/surveys/${id}/status`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ manualStatus: "closed" })
      .expect(200);
    expect(idempotent.body.survey.updatedAt).toBe(closedAt);
    const staleDiscard = await request(app)
      .delete(`/api/surveys/${id}/versions/${next.body.version.id}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 999 })
      .expect(409);
    expect(staleDiscard.body.error.code).toBe("DRAFT_CONFLICT");
    await request(app)
      .delete(`/api/surveys/${id}/versions/${next.body.version.id}`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1 })
      .expect(200);
    const recreated = await request(app)
      .post(`/api/surveys/${id}/versions`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ sourceVersionId: draftVersion.id })
      .expect(201);
    expect(recreated.body.version.versionNumber).toBe(2);
  });

  it("hides every lifecycle endpoint from another owner", async () => {
    const created = await createSurvey().expect(201);
    const { id, draftVersion } = created.body.survey;
    const calls = [
      request(app)
        .get(`/api/surveys/${id}/versions`)
        .set("Cookie", otherCookie),
      request(app)
        .post(`/api/surveys/${id}/versions`)
        .set("Origin", origin)
        .set("Cookie", otherCookie)
        .send({ sourceVersionId: draftVersion.id }),
      request(app)
        .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
        .set("Origin", origin)
        .set("Cookie", otherCookie)
        .send({ revision: 1, acknowledgeWarnings: false }),
      request(app)
        .delete(`/api/surveys/${id}/versions/${draftVersion.id}`)
        .set("Origin", origin)
        .set("Cookie", otherCookie)
        .send({ revision: 1 }),
      request(app)
        .patch(`/api/surveys/${id}/status`)
        .set("Origin", origin)
        .set("Cookie", otherCookie)
        .send({ manualStatus: "closed" }),
    ];
    const results = await Promise.all(calls);
    expect(results.map((result) => result.status)).toEqual([
      404, 404, 404, 404, 404,
    ]);
  });

  it("creates the partial unique single-draft index in MongoDB", async () => {
    const indexes = await SurveyVersionModel.collection.listIndexes().toArray();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { surveyId: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: "draft" },
        }),
      ]),
    );
  });

  it("rolls back both publish failure points and the draft-copy failure point", async () => {
    const owner = await UserModel.findOne({
      usernameNormalized: "owner_user",
    }).lean();
    expect(owner).not.toBeNull();
    const question = {
      questionId: "q_rollback",
      type: "text",
      title: "回滚测试",
      required: false,
      validation: { minLength: 0, maxLength: 2_000, digitsOnly: false },
      options: [],
      jumpRules: [],
    };
    for (const hook of [
      "afterVersionPublished",
      "afterSurveyPublished",
    ] as const) {
      const created = await createSurvey(`发布回滚-${hook}`).expect(201);
      const surveyId = created.body.survey.id;
      const versionId = created.body.survey.draftVersion.id;
      await SurveyVersionModel.updateOne(
        { _id: versionId },
        { $set: { questions: [question] } },
      );
      const service = new SurveyService(
        testEnv,
        new SurveyCursorService(testEnv.jwtSecret),
        () => new Date("2026-10-19T12:00:00.000Z"),
        { [hook]: () => Promise.reject(new Error("forced rollback")) },
      );
      await expect(
        service.publish(owner!._id, surveyId, versionId, 1, false),
      ).rejects.toThrow("forced rollback");
      expect(await SurveyVersionModel.findById(versionId).lean()).toMatchObject(
        {
          status: "draft",
          publishedAt: null,
          revision: 1,
        },
      );
      expect(await SurveyModel.findById(surveyId).lean()).toMatchObject({
        currentVersionId: null,
        draftVersionId: new mongoose.Types.ObjectId(versionId),
      });
    }

    const created = await createSurvey("复制回滚").expect(201);
    const surveyId = created.body.survey.id;
    const versionId = created.body.survey.draftVersion.id;
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { $set: { questions: [question] } },
    );
    const normal = new SurveyService(
      testEnv,
      new SurveyCursorService(testEnv.jwtSecret),
    );
    await normal.publish(owner!._id, surveyId, versionId, 1, false);
    const failingCopy = new SurveyService(
      testEnv,
      new SurveyCursorService(testEnv.jwtSecret),
      undefined,
      { afterVersionCreated: () => Promise.reject(new Error("forced copy")) },
    );
    await expect(
      failingCopy.createNextVersion(owner!._id, surveyId, versionId),
    ).rejects.toThrow("forced copy");
    expect(await SurveyVersionModel.countDocuments({ surveyId })).toBe(1);
    expect(await SurveyModel.findById(surveyId).lean()).toMatchObject({
      currentVersionId: new mongoose.Types.ObjectId(versionId),
      draftVersionId: null,
    });
  });

  it("requires a second request to acknowledge content warnings", async () => {
    const created = await createSurvey("警告确认").expect(201);
    const { id, draftVersion } = created.body.survey;
    await SurveyVersionModel.updateOne(
      { _id: draftVersion.id },
      {
        $set: {
          questions: [
            {
              questionId: "q_warning_1",
              type: "single",
              title: "选择",
              required: false,
              validation: {},
              options: [
                { optionId: "o_warning_a", text: "甲" },
                { optionId: "o_warning_b", text: "乙" },
              ],
              jumpRules: [
                {
                  ruleId: "r_warning_1",
                  operator: "equals",
                  value: "o_warning_a",
                  targetQuestionId: "q_warning_2",
                },
                {
                  ruleId: "r_warning_2",
                  operator: "equals",
                  value: "o_warning_a",
                  targetQuestionId: "q_warning_2",
                },
              ],
            },
            {
              questionId: "q_warning_2",
              type: "text",
              title: "补充",
              required: false,
              validation: {
                minLength: 0,
                maxLength: 2_000,
                digitsOnly: false,
              },
              options: [],
              jumpRules: [],
            },
          ],
        },
      },
    );
    const unconfirmed = await request(app)
      .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, acknowledgeWarnings: false })
      .expect(409);
    expect(unconfirmed.body.error).toMatchObject({
      code: "PUBLISH_WARNINGS_UNCONFIRMED",
      details: {
        check: {
          valid: true,
          warnings: [expect.objectContaining({ code: "SHADOWED_RULE" })],
        },
      },
    });
    await request(app)
      .post(`/api/surveys/${id}/versions/${draftVersion.id}/publish`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, acknowledgeWarnings: true })
      .expect(200);
  });

  it("blocks a deadline exactly equal to the injected transaction time", async () => {
    const created = await createSurvey("时间边界").expect(201);
    const { id, draftVersion } = created.body.survey;
    const now = new Date("2027-06-30T15:59:00.000Z");
    await SurveyVersionModel.updateOne(
      { _id: draftVersion.id },
      {
        $set: {
          deadline: now,
          questions: [
            {
              questionId: "q_deadline",
              type: "text",
              title: "截止时间",
              required: false,
              validation: {
                minLength: 0,
                maxLength: 2_000,
                digitsOnly: false,
              },
              options: [],
              jumpRules: [],
            },
          ],
        },
      },
    );
    const owner = await UserModel.findOne({
      usernameNormalized: "owner_user",
    }).lean();
    const service = new SurveyService(
      testEnv,
      new SurveyCursorService(testEnv.jwtSecret),
      () => now,
    );
    await expect(
      service.publish(owner!._id, id, draftVersion.id, 1, false),
    ).rejects.toMatchObject({
      code: "PUBLISH_BLOCKED",
      details: {
        check: {
          errors: [expect.objectContaining({ code: "DEADLINE_PASSED" })],
        },
      },
    });
  });

  it("serializes concurrent publish, editing, draft creation and discard", async () => {
    const makePublishable = async (name: string) => {
      const created = await createSurvey(name).expect(201);
      await SurveyVersionModel.updateOne(
        { _id: created.body.survey.draftVersion.id },
        {
          $set: {
            questions: [
              {
                questionId: `q_${created.body.survey.id}`,
                type: "text",
                title: "并发",
                required: false,
                validation: {
                  minLength: 0,
                  maxLength: 2_000,
                  digitsOnly: false,
                },
                options: [],
                jumpRules: [],
              },
            ],
          },
        },
      );
      return created.body.survey;
    };
    const first = await makePublishable("并发发布");
    const publish = () =>
      request(app)
        .post(
          `/api/surveys/${first.id}/versions/${first.draftVersion.id}/publish`,
        )
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ revision: 1, acknowledgeWarnings: false });
    const publishResults = await Promise.all([publish(), publish()]);
    expect(publishResults.map((item) => item.status).sort()).toEqual([
      200, 409,
    ]);

    const second = await makePublishable("发布编辑");
    const competition = await Promise.all([
      request(app)
        .post(
          `/api/surveys/${second.id}/versions/${second.draftVersion.id}/publish`,
        )
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ revision: 1, acknowledgeWarnings: false }),
      request(app)
        .patch(`/api/surveys/${second.id}/versions/${second.draftVersion.id}`)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ revision: 1, title: "并发修改" }),
    ]);
    expect(competition.map((item) => item.status).sort()).toEqual([200, 409]);

    const third = await makePublishable("创建竞争");
    await request(app)
      .post(
        `/api/surveys/${third.id}/versions/${third.draftVersion.id}/publish`,
      )
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ revision: 1, acknowledgeWarnings: false })
      .expect(200);
    const createDraft = () =>
      request(app)
        .post(`/api/surveys/${third.id}/versions`)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ sourceVersionId: third.draftVersion.id });
    const createResults = await Promise.all([createDraft(), createDraft()]);
    expect(createResults.map((item) => item.status).sort()).toEqual([201, 409]);
    const draft = createResults.find((item) => item.status === 201)!.body
      .version;
    const publishOrDiscard = await Promise.all([
      request(app)
        .post(`/api/surveys/${third.id}/versions/${draft.id}/publish`)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ revision: 1, acknowledgeWarnings: false }),
      request(app)
        .delete(`/api/surveys/${third.id}/versions/${draft.id}`)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send({ revision: 1 }),
    ]);
    expect(publishOrDiscard.filter((item) => item.status === 200)).toHaveLength(
      1,
    );
    expect([404, 409]).toContain(
      publishOrDiscard.find((item) => item.status !== 200)!.status,
    );
  });
});
