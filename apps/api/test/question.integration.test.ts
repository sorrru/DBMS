import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { SurveyModel } from "../src/models/survey.js";
import { UserModel } from "../src/models/user.js";
import { PasswordService } from "../src/security/password.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { TokenService } from "../src/security/token.js";
import type { SurveyQuestion } from "../src/surveys/questions.js";
import { assertSafeTestDatabase } from "./database-safety.js";

const origin = "http://localhost:5173";
const profile = {
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
  surveyWriteRateLimit: 1_000,
  rateLimitMaxKeys: 1_000,
};
const passwords = new PasswordService(profile, "unused");
const tokens = new TokenService(testEnv.jwtSecret);
const rateLimits = new FixedWindowStore(1_000);
let app: ReturnType<typeof createApp>;
let cookie: string[];
let surveyId: string;
let versionId: string;

const auth = (call: request.Test) =>
  call.set("Origin", origin).set("Cookie", cookie);

const add = (body: Record<string, unknown>) =>
  auth(
    request(app).post(
      `/api/surveys/${surveyId}/versions/${versionId}/questions`,
    ),
  ).send(body);

const textQuestion = (index: number): SurveyQuestion => ({
  questionId: `q_seed_${index}`,
  type: "text",
  title: `问题 ${index}`,
  required: false,
  validation: { minLength: 0, maxLength: 2_000, digitsOnly: false },
  options: [],
  jumpRules: [],
});

beforeAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  const dummy = await passwords.hash("DummyPassword123");
  app = createApp({
    env: testEnv,
    passwords: new PasswordService(profile, dummy),
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
  const registered = await request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ username: "question_owner", password: "Password123" })
    .expect(201);
  const header = registered.headers["set-cookie"]!;
  cookie = Array.isArray(header) ? header : [header];
  const created = await auth(request(app).post("/api/surveys"))
    .send({ internalName: "题目测试" })
    .expect(201);
  surveyId = created.body.survey.id;
  versionId = created.body.survey.draftVersion.id;
});

afterAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("question API", () => {
  it("allows question write methods in CORS preflight", async () => {
    const response = await request(app)
      .options(`/api/surveys/${surveyId}/versions/${versionId}/question-order`)
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "PUT")
      .expect(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["access-control-allow-methods"]).toContain(
      "DELETE",
    );
  });

  it("adds all types and persists canonical validation", async () => {
    const single = await add({
      revision: 1,
      type: "single",
      title: " 单选 ",
      validation: {},
      options: [{ text: "甲" }, { text: "乙" }],
    }).expect(201);
    expect(single.body.version.questions[0]).toMatchObject({
      type: "single",
      title: "单选",
      required: false,
      validation: {},
      jumpRules: [],
    });
    expect(JSON.stringify(single.body.version.questions)).not.toMatch(
      /"_id"|"__v"/,
    );
    const multiple = await add({
      revision: 2,
      type: "multiple",
      title: "多选",
      required: true,
      validation: {},
      options: [{ text: "甲" }, { text: "乙" }],
    }).expect(201);
    expect(multiple.body.version.questions[1].validation).toEqual({
      minSelections: 1,
      maxSelections: 2,
    });
    const text = await add({
      revision: 3,
      type: "text",
      title: "手机号",
      validation: { digitsOnly: true },
      options: [],
    }).expect(201);
    expect(text.body.version.questions[2].validation).toEqual({
      minLength: 0,
      maxLength: 2_000,
      digitsOnly: true,
    });
    const number = await add({
      revision: 4,
      type: "number",
      title: "年龄",
      validation: { integerOnly: true, minValue: 0 },
      options: [],
    }).expect(201);
    expect(number.body.version.questions[3].validation).toEqual({
      integerOnly: true,
      minValue: 0,
      maxValue: null,
    });
    expect(number.body.version.revision).toBe(5);
  });

  it("replaces by whitelist and rejects immutable or foreign option IDs", async () => {
    const created = await add({
      revision: 1,
      type: "single",
      title: "单选",
      validation: {},
      options: [{ text: "甲" }, { text: "乙" }],
    }).expect(201);
    const question = created.body.version.questions[0];
    const path = `/api/surveys/${surveyId}/versions/${versionId}/questions/${question.questionId}`;
    await auth(request(app).patch(path))
      .send({
        revision: 2,
        title: "修改",
        required: true,
        validation: {},
        options: [
          { optionId: question.options[0].optionId, text: "保留" },
          { text: "新增" },
        ],
      })
      .expect(200);
    await auth(request(app).patch(path))
      .send({
        revision: 3,
        title: "错误",
        required: true,
        validation: {},
        options: [{ optionId: "o_foreign", text: "甲" }, { text: "乙" }],
      })
      .expect(400);
    await auth(request(app).patch(path))
      .send({
        revision: 3,
        title: "重复 ID",
        required: true,
        validation: {},
        options: [
          { optionId: question.options[0].optionId, text: "甲" },
          { optionId: question.options[0].optionId, text: "乙" },
        ],
      })
      .expect(400);
    await auth(request(app).patch(path))
      .send({
        revision: 3,
        title: "缺少必答字段",
        validation: {},
        options: [],
      })
      .expect(400);
    await auth(request(app).patch(path))
      .send({
        revision: 3,
        type: "multiple",
        title: "错误",
        required: true,
        validation: {},
        options: [],
      })
      .expect(400);
  });

  it("reorders and deletes with revision in the JSON body", async () => {
    const first = await add({
      revision: 1,
      type: "text",
      title: "第一题",
      validation: {},
      options: [],
    }).expect(201);
    const firstId = first.body.questionId;
    const second = await add({
      revision: 2,
      type: "text",
      title: "第二题",
      validation: {},
      options: [],
    }).expect(201);
    const secondId = second.body.questionId;
    const reordered = await auth(
      request(app).put(
        `/api/surveys/${surveyId}/versions/${versionId}/question-order`,
      ),
    )
      .send({ revision: 3, questionIds: [secondId, firstId] })
      .expect(200);
    expect(
      reordered.body.version.questions.map(
        (item: SurveyQuestion) => item.questionId,
      ),
    ).toEqual([secondId, firstId]);
    await auth(
      request(app).delete(
        `/api/surveys/${surveyId}/versions/${versionId}/questions/${firstId}`,
      ),
    )
      .send({ revision: 4 })
      .expect(200);
  });

  it("rejects incomplete, duplicate or extra reorder sets and missing delete revision", async () => {
    const first = await add({
      revision: 1,
      type: "text",
      title: "第一题",
      validation: {},
      options: [],
    }).expect(201);
    const second = await add({
      revision: 2,
      type: "text",
      title: "第二题",
      validation: {},
      options: [],
    }).expect(201);
    const path = `/api/surveys/${surveyId}/versions/${versionId}/question-order`;
    for (const questionIds of [
      [first.body.questionId],
      [first.body.questionId, first.body.questionId],
      [first.body.questionId, second.body.questionId, "q_extra"],
    ]) {
      const response = await auth(request(app).put(path))
        .send({ revision: 3, questionIds })
        .expect(400);
      expect(response.body.error).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { path: "questionIds" },
      });
    }
    await auth(
      request(app).delete(
        `/api/surveys/${surveyId}/versions/${versionId}/questions/${first.body.questionId}`,
      ),
    )
      .send({})
      .expect(400);
  });

  it("accepts one-question and unchanged ordering as successful writes", async () => {
    const created = await add({
      revision: 1,
      type: "text",
      title: "唯一题目",
      validation: {},
      options: [],
    }).expect(201);
    const path = `/api/surveys/${surveyId}/versions/${versionId}/question-order`;
    const first = await auth(request(app).put(path))
      .send({ revision: 2, questionIds: [created.body.questionId] })
      .expect(200);
    expect(first.body.version.revision).toBe(3);
    const second = await auth(request(app).put(path))
      .send({ revision: 3, questionIds: [created.body.questionId] })
      .expect(200);
    expect(second.body.version.revision).toBe(4);
  });

  it("distinguishes malformed, missing, published and stale targets", async () => {
    await auth(
      request(app).delete(
        `/api/surveys/${surveyId}/versions/${versionId}/questions/bad`,
      ),
    )
      .send({ revision: 1 })
      .expect(400);
    const missing = await auth(
      request(app).delete(
        `/api/surveys/${surveyId}/versions/${versionId}/questions/q_missing`,
      ),
    )
      .send({ revision: 1 })
      .expect(404);
    expect(missing.body.error.code).toBe("QUESTION_NOT_FOUND");
    const stale = await auth(
      request(app).delete(
        `/api/surveys/${surveyId}/versions/${versionId}/questions/q_missing`,
      ),
    )
      .send({ revision: 99 })
      .expect(409);
    expect(stale.body.error).toMatchObject({
      code: "DRAFT_CONFLICT",
      details: { currentRevision: 1 },
    });
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { $set: { status: "published" } },
    );
    const published = await auth(
      request(app).delete(
        `/api/surveys/${surveyId}/versions/${versionId}/questions/q_missing`,
      ),
    )
      .send({ revision: 1 })
      .expect(409);
    expect(published.body.error.code).toBe("VERSION_NOT_EDITABLE");
  });

  it("allows only one concurrent add at 99 questions and enforces the limit", async () => {
    const questions = Array.from({ length: 99 }, (_value, index) =>
      textQuestion(index),
    );
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { $set: { questions, revision: 10 } },
    );
    const body = {
      revision: 10,
      type: "text",
      title: "并发题目",
      validation: {},
      options: [],
    };
    const results = await Promise.all([add(body), add(body)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      (await SurveyVersionModel.findById(versionId).lean())!.questions,
    ).toHaveLength(100);
    const response = await add({ ...body, revision: 11 }).expect(409);
    expect(response.body.error.code).toBe("QUESTION_LIMIT_REACHED");
  });

  it("stores a maximum-size question below the request limit", async () => {
    const response = await add({
      revision: 1,
      type: "single",
      title: "😀".repeat(300),
      validation: {},
      options: Array.from({ length: 50 }, (_value, index) => ({
        text: `${index.toString().padStart(2, "0")}${"😀".repeat(198)}`,
      })),
    }).expect(201);
    expect(response.body.version.questions[0].options).toHaveLength(50);
  });
});
