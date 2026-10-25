import mongoose, { Types } from "mongoose";
import request from "supertest";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { PasswordService } from "../src/security/password.js";
import { TokenService } from "../src/security/token.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../src/models/library-question.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { UserModel } from "../src/models/user.js";
import {
  LibraryService,
  freezeLibraryVersion,
} from "../src/library/service.js";
import { LibraryCursor } from "../src/library/cursor.js";
import { assertSafeTestDatabase } from "./database-safety.js";
const origin = "http://localhost:5173";
const limits = new FixedWindowStore(1000);
const profile = {
  N: 1024,
  r: 8,
  p: 1,
  maxmem: 8 * 1024 * 1024,
  saltBytes: 16,
  keyBytes: 32,
};
const tokens = new TokenService(env.jwtSecret);
let app: ReturnType<typeof createApp>,
  cookie: string[],
  otherCookie: string[],
  ownerId: Types.ObjectId;
const service = new LibraryService(new LibraryCursor(env.jwtSecret));
const base = {
  type: "single",
  title: "课程反馈",
  required: true,
  validation: {},
  options: [{ text: "满意" }, { text: "一般" }],
};
const auth = (test: request.Test, c = cookie) =>
  test.set("Origin", origin).set("Cookie", c);
const create = (body: object = base) =>
  auth(request(app).post("/api/questions")).send(body);
const definition = (v: {
  definition: {
    title: string;
    required: boolean;
    validation: unknown;
    options: unknown[];
  };
}) => ({
  title: v.definition.title,
  required: v.definition.required,
  validation: v.definition.validation,
  options: v.definition.options,
});
const path = (q: string, v: string) => `/api/questions/${q}/versions/${v}`;
async function seed() {
  const r = await create().expect(201);
  return {
    q: r.body.question.libraryQuestionId as string,
    v: r.body.version.questionVersionId as string,
    data: r.body,
  };
}
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
  const passwords = new PasswordService(profile, "unused");
  const dummy = await passwords.hash("DummyPassword123");
  app = createApp({
    env: { ...env, registerLimit: 1000, surveyWriteRateLimit: 1000 },
    passwords: new PasswordService(profile, dummy),
    tokens,
    rateLimits: limits,
  });
  await Promise.all([service.ensureIndexes(), UserModel.init()]);
});
beforeEach(async () => {
  limits.reset();
  await Promise.all([
    LibraryQuestionModel.deleteMany({}),
    LibraryVersionModel.deleteMany({}),
    LibraryOptionKeyModel.deleteMany({}),
    QuestionUsageModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
  const register = async (username: string) => {
    const r = await request(app)
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ username, password: "Password123" })
      .expect(201);
    const h = r.headers["set-cookie"]!;
    return { cookie: Array.isArray(h) ? h : [h], id: r.body.user.id as string };
  };
  const owner = await register("library_owner");
  cookie = owner.cookie;
  ownerId = new Types.ObjectId(owner.id);
  otherCookie = (await register("library_other")).cookie;
});
afterAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await Promise.all([
    LibraryQuestionModel.deleteMany({}),
    LibraryVersionModel.deleteMany({}),
    LibraryOptionKeyModel.deleteMany({}),
    QuestionUsageModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
  await mongoose.disconnect();
  limits.dispose();
});
describe("library identity and version lifecycle", () => {
  it("creates all four types with existing normalized validation and independent option keys", async () => {
    const c = await seed();
    expect(c.data.version.contentRevision).toBe(1);
    expect(c.data.version.frozenAt).toBeNull();
    expect(c.data.version.definition).not.toHaveProperty("questionId");
    expect(c.data.version.definition).not.toHaveProperty("jumpRules");
    expect(await LibraryOptionKeyModel.countDocuments()).toBe(2);
    for (const type of ["multiple", "text", "number"]) {
      const r = await create({
        ...base,
        type,
        options: type === "multiple" ? base.options : [],
      }).expect(201);
      expect(r.body.version.definition.type).toBe(type);
    }
  });
  it("rejects invalid definitions, injected fields, identities and readonly metadata", async () => {
    for (const body of [
      { ...base, ownerId: "injected" },
      { ...base, source: {} },
      { ...base, jumpRules: [] },
      { ...base, options: [{ text: "A" }, { text: "A" }] },
      {
        ...base,
        type: "number",
        options: [],
        validation: { minValue: 30, maxValue: 10 },
      },
      {
        ...base,
        options: [{ text: "A", optionId: "o_stolen" }, { text: "B" }],
      },
    ])
      await create(body).expect(400);
    await auth(request(app).get("/api/questions/not-an-id")).expect(400);
    await auth(request(app).get("/api/questions").query({ limit: "0" })).expect(
      400,
    );
    await auth(
      request(app).get("/api/questions").query({ unexpected: "1" }),
    ).expect(400);
    expect(await LibraryQuestionModel.countDocuments()).toBe(0);
  });
  it("keeps creation atomic when insertion hook fails", async () => {
    const faulty = new LibraryService(new LibraryCursor(env.jwtSecret), {
      afterVersionInserted: () => {
        throw Error("rollback");
      },
    });
    await expect(
      faulty.create(ownerId, { ...base, type: "single" }),
    ).rejects.toThrow("rollback");
    expect(await LibraryQuestionModel.countDocuments()).toBe(0);
    expect(await LibraryVersionModel.countDocuments()).toBe(0);
    expect(await LibraryOptionKeyModel.countDocuments()).toBe(0);
  });
  it("requires authentication, origin and JSON and enforces owner-only access on every route", async () => {
    await request(app).get("/api/questions").expect(401);
    await request(app)
      .post("/api/questions")
      .set("Cookie", cookie)
      .send(base)
      .expect(403);
    await auth(request(app).post("/api/questions"))
      .type("text")
      .send("x")
      .expect(415);
    const { q, v, data } = await seed();
    const d = definition(data.version);
    for (const call of [
      request(app).get(`/api/questions/${q}`),
      request(app).get(`/api/questions/${q}/versions`),
      request(app).get(path(q, v)),
      request(app)
        .patch(path(q, v))
        .send({ ...d, contentRevision: 1 }),
      request(app)
        .post(`/api/questions/${q}/versions`)
        .send({ ...d, contentRevision: 1, sourceVersionId: v }),
      request(app)
        .post(`${path(q, v)}/copy`)
        .send({ contentRevision: 1 }),
      request(app).post(`/api/questions/${q}/restore`).send({
        restoredFromVersionId: v,
        sourceContentRevision: 1,
        baseVersionId: v,
        baseContentRevision: 1,
      }),
    ])
      await auth(call, otherCookie).expect(404);
    const foreign = await create().expect(201);
    await auth(
      request(app).get(path(q, foreign.body.version.questionVersionId)),
    ).expect(404);
  });
  it("updates unused version in place and rejects stale revisions and forged option IDs", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const r = await auth(request(app).patch(path(q, v)))
      .send({ ...d, title: "修正标题", contentRevision: 1 })
      .expect(200);
    expect(r.body.version).toMatchObject({
      questionVersionId: v,
      versionNumber: 1,
      contentRevision: 2,
      frozenAt: null,
    });
    await auth(request(app).patch(path(q, v)))
      .send({ ...d, contentRevision: 1 })
      .expect(409);
    await auth(request(app).patch(path(q, v)))
      .send({ ...d, contentRevision: 2, type: "text" })
      .expect(400);
    await auth(request(app).patch(path(q, v)))
      .send({
        ...d,
        contentRevision: 2,
        options: [{ optionId: "o_external", text: "A" }, { text: "B" }],
      })
      .expect(400);
    expect(await LibraryVersionModel.countDocuments()).toBe(1);
  });
  it("creates branches from history with stable inherited option IDs and freezes ancestors permanently", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const b = await auth(request(app).post(`/api/questions/${q}/versions`))
      .send({
        ...d,
        sourceVersionId: v,
        contentRevision: 1,
        title: "v2",
        options: [data.version.definition.options[0], { text: "新选项" }],
      })
      .expect(201);
    expect(b.body.version.versionNumber).toBe(2);
    expect(b.body.version.parentVersionId).toBe(v);
    expect(b.body.version.definition.options[0].optionId).toBe(
      data.version.definition.options[0].optionId,
    );
    const c = await auth(request(app).post(`/api/questions/${q}/versions`))
      .send({ ...d, sourceVersionId: v, contentRevision: 1, title: "v3 从 v1" })
      .expect(201);
    expect(c.body.version).toMatchObject({
      versionNumber: 3,
      parentVersionId: v,
    });
    const frozen = await auth(request(app).get(path(q, v))).expect(200);
    expect(frozen.body.modificationStatus.canEditInPlace).toBe(false);
    expect(frozen.body.version.freezeReasons).toContain("derived");
    const blocked = await auth(request(app).patch(path(q, v)))
      .send({ ...d, contentRevision: 1 })
      .expect(409);
    expect(blocked.body.error.code).toBe("LIBRARY_VERSION_FROZEN");
    expect(await LibraryOptionKeyModel.countDocuments()).toBe(3);
  });
  it("restores old content as new version, preserving baseline and restoring source links", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const b = await auth(request(app).post(`/api/questions/${q}/versions`))
      .send({ ...d, title: "v2", sourceVersionId: v, contentRevision: 1 })
      .expect(201);
    const r = await auth(request(app).post(`/api/questions/${q}/restore`))
      .send({
        restoredFromVersionId: v,
        sourceContentRevision: 1,
        baseVersionId: b.body.version.questionVersionId,
        baseContentRevision: 1,
      })
      .expect(201);
    expect(r.body.version).toMatchObject({
      versionNumber: 3,
      parentVersionId: b.body.version.questionVersionId,
      restoredFromVersionId: v,
      definition: data.version.definition,
    });
    await auth(request(app).post(`/api/questions/${q}/restore`))
      .send({
        restoredFromVersionId: v,
        sourceContentRevision: 1,
        baseVersionId: b.body.version.questionVersionId,
        baseContentRevision: 1,
      })
      .expect(409);
    expect(await LibraryVersionModel.countDocuments()).toBe(3);
  });
  it("allows owner to save a new identity with new option keys and explicit source revision", async () => {
    const { q, v } = await seed();
    const r = await auth(request(app).post(`${path(q, v)}/copy`))
      .send({ contentRevision: 1 })
      .expect(201);
    expect(r.body.question.libraryQuestionId).not.toBe(q);
    expect(r.body.question.copiedFrom).toEqual({
      libraryQuestionId: q,
      questionVersionId: v,
      contentRevision: 1,
    });
    expect(r.body.version.frozenAt).toBeNull();
    expect(await LibraryOptionKeyModel.countDocuments()).toBe(4);
    const original = await service.get(ownerId, q, v);
    expect(original.version.freezeReasons).toContain("copied");
    expect(original.modificationStatus.canEditInPlace).toBe(false);
  });
  it("rolls back source freeze and child insertion when branch/copy/restore fails", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const faulty = new LibraryService(new LibraryCursor(env.jwtSecret), {
      afterVersionInserted: () => {
        throw Error("rollback");
      },
    });
    for (const operation of [
      () =>
        faulty.branch(
          ownerId,
          q,
          v,
          1,
          d as Parameters<LibraryService["branch"]>[4],
        ),
      () => faulty.copy(ownerId, q, v, 1),
      () =>
        faulty.restore(ownerId, q, {
          restoredFromVersionId: v,
          sourceContentRevision: 1,
          baseVersionId: v,
          baseContentRevision: 1,
        }),
    ]) {
      await expect(operation()).rejects.toThrow("rollback");
      expect((await service.get(ownerId, q, v)).version.frozenAt).toBeNull();
      expect(await LibraryQuestionModel.countDocuments()).toBe(1);
      expect(await LibraryVersionModel.countDocuments()).toBe(1);
      expect(await LibraryOptionKeyModel.countDocuments()).toBe(2);
    }
  });
  it("serializes concurrent edits of an unused version", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const results = await Promise.all(
      ["A", "B"].map((title) =>
        auth(request(app).patch(path(q, v))).send({
          ...d,
          title,
          contentRevision: 1,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await service.get(ownerId, q, v)).version.contentRevision).toBe(2);
  });
  it("does not allow stale content to be copied during an edit/copy race", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const results = await Promise.all([
      auth(request(app).patch(path(q, v))).send({
        ...d,
        title: "edited",
        contentRevision: 1,
      }),
      auth(request(app).post(`${path(q, v)}/copy`)).send({
        contentRevision: 1,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(
      results[0]!.status === 200 ? [200, 409] : [201, 409],
    );
    const original = await service.get(ownerId, q, v);
    if (results[1]!.status === 201) {
      expect(original.version.frozenAt).not.toBeNull();
      expect(results[1]!.body.version.definition.title).toBe(base.title);
    } else expect(original.version.contentRevision).toBe(2);
  });
  it("allocates unique consecutive version numbers for concurrent branches", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    const results = await Promise.all(
      ["A", "B"].map((title) =>
        auth(request(app).post(`/api/questions/${q}/versions`)).send({
          ...d,
          title,
          sourceVersionId: v,
          contentRevision: 1,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.map((r) => r.body.version.versionNumber).sort()).toEqual([
      2, 3,
    ]);
    expect((await service.get(ownerId, q)).question.versionCount).toBe(3);
  });
  it("binds pagination cursors to user/resource and has no missing or duplicate versions", async () => {
    const { q, v, data } = await seed(),
      d = definition(data.version);
    for (let n = 0; n < 3; n++)
      await auth(request(app).post(`/api/questions/${q}/versions`))
        .send({ ...d, sourceVersionId: v, contentRevision: 1 })
        .expect(201);
    const first = await auth(
      request(app).get(`/api/questions/${q}/versions?limit=2`),
    ).expect(200);
    const second = await auth(
      request(app)
        .get(`/api/questions/${q}/versions`)
        .query({ limit: 2, cursor: first.body.nextCursor }),
    ).expect(200);
    expect(
      [...first.body.items, ...second.body.items].map(
        (x: { versionNumber: number }) => x.versionNumber,
      ),
    ).toEqual([4, 3, 2, 1]);
    expect(second.body.nextCursor).toBeNull();
    await auth(
      request(app)
        .get("/api/questions")
        .query({ cursor: first.body.nextCursor }),
    ).expect(400);
    const other = await seed();
    await auth(
      request(app)
        .get(`/api/questions/${other.q}/versions`)
        .query({ cursor: first.body.nextCursor }),
    ).expect(400);
    const list = await auth(request(app).get("/api/questions?limit=1")).expect(
      200,
    );
    await auth(
      request(app)
        .get("/api/questions")
        .query({ cursor: list.body.nextCursor }),
      otherCookie,
    ).expect(400);
    await auth(
      request(app)
        .get("/api/questions")
        .query({ cursor: `${list.body.nextCursor}bad` }),
    ).expect(400);
  });
  it("does not expose owner IDs or internal revision pointers and reports usage counts without answer data", async () => {
    const { q, v } = await seed();
    await mongoose.connection.transaction(async (session) => {
      const version = await LibraryVersionModel.findById(v)
        .session(session)
        .lean();
      await freezeLibraryVersion(version!, 1, "adopted", session);
      await QuestionUsageModel.create(
        [
          {
            ownerId,
            surveyId: new Types.ObjectId(),
            surveyVersionId: new Types.ObjectId(),
            questionId: "q_test",
            libraryQuestionId: q,
            questionVersionId: v,
            status: "draft",
          },
        ],
        { session },
      );
    });
    const detail = await auth(request(app).get(path(q, v))).expect(200);
    expect(detail.body.modificationStatus.ownUsageCount).toBe(1);
    expect(detail.body.modificationStatus.canEditInPlace).toBe(false);
    await QuestionUsageModel.deleteMany({ questionVersionId: v });
    expect(
      (await service.get(ownerId, q, v)).modificationStatus.canEditInPlace,
    ).toBe(false); // removing last usage never unfreezes a version
    expect(JSON.stringify(detail.body)).not.toContain("ownerId");
    expect(detail.body.question).not.toHaveProperty("nextVersionNumber");
    expect(detail.body).not.toHaveProperty("answers");
  });
  it("rolls back adoption freeze when the surrounding snapshot transaction fails", async () => {
    const { q, v } = await seed();
    await expect(
      mongoose.connection.transaction(async (session) => {
        const version = await LibraryVersionModel.findById(v)
          .session(session)
          .lean();
        await freezeLibraryVersion(version!, 1, "adopted", session);
        throw Error("snapshot failed");
      }),
    ).rejects.toThrow("snapshot failed");
    expect(
      (await service.get(ownerId, q, v)).modificationStatus.canEditInPlace,
    ).toBe(true);
  });
  it("does not let a stale parent revision create a new version or restored content", async () => {
    const { q, v, data } = await seed();
    const d = definition(data.version);
    await auth(request(app).patch(path(q, v)))
      .send({ ...d, title: "revised", contentRevision: 1 })
      .expect(200);
    await auth(request(app).post(`/api/questions/${q}/versions`))
      .send({ ...d, sourceVersionId: v, contentRevision: 1 })
      .expect(409);
    await auth(request(app).post(`/api/questions/${q}/restore`))
      .send({
        restoredFromVersionId: v,
        sourceContentRevision: 1,
        baseVersionId: v,
        baseContentRevision: 2,
      })
      .expect(409);
    expect((await service.get(ownerId, q, v)).version.frozenAt).toBeNull();
    expect(await LibraryVersionModel.countDocuments()).toBe(1);
  });
  it("uses unique version and option keys as final database constraints", async () => {
    const { q, v } = await seed();
    const version = await LibraryVersionModel.findById(v).lean();
    await expect(
      LibraryVersionModel.create({ ...version, _id: new Types.ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
    const key = await LibraryOptionKeyModel.findOne({
      libraryQuestionId: q,
    }).lean();
    await expect(LibraryOptionKeyModel.create(key!)).rejects.toMatchObject({
      code: 11000,
    });
  });
});
