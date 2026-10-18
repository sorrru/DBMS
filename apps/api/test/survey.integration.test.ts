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
});
