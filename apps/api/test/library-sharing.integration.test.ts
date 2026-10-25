import mongoose, { Types } from "mongoose";
import request from "supertest";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { PasswordService } from "../src/security/password.js";
import { TokenService } from "../src/security/token.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { sessionCookieName } from "../src/http/cookies.js";
import { LibraryService } from "../src/library/service.js";
import { LibrarySharingService } from "../src/library/sharing.js";
import { LibraryCursor } from "../src/library/cursor.js";
import { SurveyService } from "../src/surveys/service.js";
import { SurveyCursorService } from "../src/surveys/cursor.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../src/models/library-question.js";
import { QuestionShareModel } from "../src/models/question-share.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { UserModel } from "../src/models/user.js";
import { assertSafeTestDatabase } from "./database-safety.js";
const origin = "http://localhost:5173",
  tokens = new TokenService(env.jwtSecret),
  limits = new FixedWindowStore(1000);
const app = createApp({
  env: { ...env, surveyWriteRateLimit: 1000 },
  passwords: new PasswordService(),
  tokens,
  rateLimits: limits,
});
const library = new LibraryService(new LibraryCursor(env.jwtSecret)),
  sharing = new LibrarySharingService(new LibraryCursor(env.jwtSecret)),
  surveys = new SurveyService(env, new SurveyCursorService(env.jwtSecret));
let owner: Types.ObjectId,
  student: Types.ObjectId,
  third: Types.ObjectId,
  lib: Awaited<ReturnType<LibraryService["create"]>>;
const auth = (test: request.Test, user = owner) =>
  test
    .set("Origin", origin)
    .set("Cookie", `${sessionCookieName}=${tokens.sign(user.toString())}`);
const id = () => lib.question.libraryQuestionId,
  vid = () => lib.version.questionVersionId;
async function grant(names = ["student", "third"], versions = [vid()]) {
  return auth(request(app).post(`/api/questions/${id()}/shares`))
    .send({ usernames: names, questionVersionIds: versions })
    .expect(202);
}
async function draft(user = student) {
  const s = await surveys.create(user, "不应向他人公开的问卷名");
  return { s, v: s.draftVersion!.id };
}
async function adopt(user = student) {
  const d = await draft(user);
  const a = await surveys.addLibraryQuestion(user, d.s.id, d.v, {
    revision: 1,
    libraryQuestionId: id(),
    questionVersionId: vid(),
    contentRevision: 1,
  });
  return { ...d, ...a };
}
async function clean() {
  await Promise.all([
    QuestionShareModel.deleteMany({}),
    QuestionUsageModel.deleteMany({}),
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    LibraryOptionKeyModel.deleteMany({}),
    LibraryVersionModel.deleteMany({}),
    LibraryQuestionModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
}
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
  await Promise.all([
    surveys.ensureIndexes(),
    library.ensureIndexes(),
    UserModel.init(),
  ]);
});
beforeEach(async () => {
  limits.reset();
  await clean();
  const users = await UserModel.create(
    ["teacher", "student", "third"].map((name) => ({
      username: name,
      usernameNormalized: name,
      passwordHash: "unused",
      registeredAt: new Date(),
    })),
  );
  [owner, student, third] = users.map((u) => u._id) as [
    Types.ObjectId,
    Types.ObjectId,
    Types.ObjectId,
  ];
  lib = await library.create(owner, {
    type: "number",
    title: "年龄",
    required: true,
    validation: { integerOnly: true, minValue: 0, maxValue: 120 },
    options: [],
  });
});
afterAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await clean();
  await mongoose.disconnect();
  limits.dispose();
});
describe("version-scoped sharing and usage privacy", () => {
  it("bulk grants selected versions with uniform results, normalization, deduplication and no self grant", async () => {
    const a = await grant(["Student", "student", "missing_user", "teacher"]);
    const b = await grant(["another_missing"]);
    expect(a.body).toEqual({ accepted: true });
    expect(b.body).toEqual(a.body);
    expect(await QuestionShareModel.countDocuments()).toBe(1);
    const r = await auth(
      request(app).get(`/api/questions/${id()}/shares`),
    ).expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({
      username: "student",
      versionNumber: 1,
    });
    expect(r.body.items[0]).not.toHaveProperty("recipientId");
  });
  it("rejects unknown fields, NoSQL usernames, batch overflow and mixed foreign versions atomically", async () => {
    const other = await library.create(third, {
      type: "text",
      title: "私有题",
      required: false,
      validation: {},
      options: [],
    });
    for (const body of [
      { usernames: [{ $ne: null }], questionVersionIds: [vid()] },
      { usernames: ["student"], questionVersionIds: Array(51).fill(vid()) },
      { usernames: Array(51).fill("student"), questionVersionIds: [vid()] },
      { usernames: ["student"], questionVersionIds: [vid()], public: true },
    ])
      await auth(request(app).post(`/api/questions/${id()}/shares`))
        .send(body)
        .expect(400);
    await auth(request(app).post(`/api/questions/${id()}/shares`))
      .send({
        usernames: ["student"],
        questionVersionIds: [vid(), other.version.questionVersionId],
      })
      .expect(404);
    expect(await QuestionShareModel.countDocuments()).toBe(0);
  });
  it("shows only authorized versions and redacts private ancestors, counts and latest pointers", async () => {
    const v2 = await library.branch(owner, id(), vid(), 1, {
      ...lib.version.definition,
      title: "可共享 v2",
    });
    await library.branch(owner, id(), v2.version.questionVersionId, 1, {
      ...lib.version.definition,
      title: "未完成私有 v3",
    });
    await grant(["student"], [v2.version.questionVersionId]);
    const detail = await auth(
      request(app).get(`/api/questions/${id()}`),
      student,
    ).expect(200);
    expect(detail.body.access).toBe("shared");
    expect(detail.body.version.versionNumber).toBe(2);
    expect(detail.body.question.versionCount).toBe(1);
    expect(detail.body.question.latestVersionId).toBe(
      v2.version.questionVersionId,
    );
    expect(detail.body.version.parentVersionId).toBeNull();
    expect(detail.body.version.parentUnavailable).toBe(true);
    expect(detail.body.modificationStatus.canEditInPlace).toBe(false);
    const history = await auth(
      request(app).get(`/api/questions/${id()}/versions`),
      student,
    ).expect(200);
    expect(
      history.body.items.map((v: { versionNumber: number }) => v.versionNumber),
    ).toEqual([2]);
    await auth(
      request(app).get(`/api/questions/${id()}/versions/${vid()}`),
      student,
    ).expect(404);
    expect(JSON.stringify(detail.body)).not.toContain("私有 v3");
  });
  it("does not automatically share new versions and blocks unrelated accounts", async () => {
    await grant(["student"]);
    await library.branch(owner, id(), vid(), 1, {
      ...lib.version.definition,
      title: "私有新版",
    });
    const list = await auth(
      request(app).get("/api/questions/shared"),
      student,
    ).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].version.versionNumber).toBe(1);
    expect(list.body.items[0].question.versionCount).toBe(1);
    await auth(request(app).get(`/api/questions/${id()}`), third).expect(404);
  });
  it("lets a recipient adopt the same identity/version and save an independent owned copy", async () => {
    await grant(["student"]);
    const adopted = await adopt();
    expect(adopted.version.questions[0]!.source!.libraryQuestionId).toBe(id());
    expect(adopted.version.questions[0]!.source!.questionVersionId).toBe(vid());
    const copied = await auth(
      request(app).post(`/api/questions/${id()}/versions/${vid()}/copy`),
      student,
    )
      .send({ contentRevision: 1 })
      .expect(201);
    expect(copied.body.access).toBe("owner");
    expect(copied.body.question.libraryQuestionId).not.toBe(id());
    expect(copied.body.question.copiedFrom.questionVersionId).toBe(vid());
    await auth(
      request(app).patch(
        `/api/questions/${copied.body.question.libraryQuestionId}/versions/${copied.body.version.questionVersionId}`,
      ),
      student,
    )
      .send({
        ...lib.version.definition,
        type: undefined,
        contentRevision: 1,
        title: "我的独立题",
      })
      .expect(200);
    expect((await library.get(owner, id())).version.definition.title).toBe(
      "年龄",
    );
  });
  it("denies recipient edits, branch/restore, re-grants and management of original authorizations", async () => {
    await grant(["student"]);
    const body = {
      ...lib.version.definition,
      type: undefined,
      contentRevision: 1,
    };
    for (const call of [
      request(app).patch(`/api/questions/${id()}/versions/${vid()}`).send(body),
      request(app)
        .post(`/api/questions/${id()}/versions`)
        .send({ ...body, sourceVersionId: vid() }),
      request(app).post(`/api/questions/${id()}/restore`).send({
        restoredFromVersionId: vid(),
        sourceContentRevision: 1,
        baseVersionId: vid(),
        baseContentRevision: 1,
      }),
      request(app)
        .post(`/api/questions/${id()}/shares`)
        .send({ usernames: ["third"], questionVersionIds: [vid()] }),
      request(app).get(`/api/questions/${id()}/shares`),
      request(app).get(`/api/questions/${id()}/usages/others`),
    ])
      await auth(call, student).expect(404);
  });
  it("revokes future reads/adoptions/copies but keeps existing draft/published snapshots and next drafts usable", async () => {
    await grant(["student"]);
    const a = await adopt();
    const shares = await sharing.listGrants(owner, id(), 20);
    const sid = shares.items[0]!.shareId;
    await auth(request(app).delete(`/api/questions/${id()}/shares/${sid}`))
      .send({})
      .expect(204);
    await auth(request(app).delete(`/api/questions/${id()}/shares/${sid}`))
      .send({})
      .expect(204);
    await auth(request(app).get(`/api/questions/${id()}`), student).expect(404);
    await auth(
      request(app).post(`/api/questions/${id()}/versions/${vid()}/copy`),
      student,
    )
      .send({ contentRevision: 1 })
      .expect(404);
    const d = await draft();
    await expect(
      surveys.addLibraryQuestion(student, d.s.id, d.v, {
        revision: 1,
        libraryQuestionId: id(),
        questionVersionId: vid(),
        contentRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await surveys.publish(student, a.s.id, a.v, a.version.revision, true);
    const next = await surveys.createNextVersion(student, a.s.id, a.v);
    expect(next.version.questions).toEqual(a.version.questions);
    expect((await surveys.getVersion(student, a.s.id, a.v)).status).toBe(
      "published",
    );
  });
  it("revokes a single version without removing a different granted version", async () => {
    const v2 = await library.branch(
      owner,
      id(),
      vid(),
      1,
      lib.version.definition,
    );
    await grant(["student"], [vid(), v2.version.questionVersionId]);
    const shares = await sharing.listGrants(owner, id(), 20);
    await sharing.revoke(
      owner,
      id(),
      shares.items.find((g) => g.versionNumber === 2)!.shareId,
    );
    const history = await library.history(student, id(), 20);
    expect(history.items.map((v) => v.versionNumber)).toEqual([1]);
    await expect(
      library.get(student, id(), v2.version.questionVersionId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("returns own survey details but only username/version/count/status for others, including after revocation", async () => {
    await grant();
    const a = await adopt(),
      b = await adopt(third);
    await surveys.publish(third, b.s.id, b.v, b.version.revision, true);
    const mine = await auth(
      request(app).get(`/api/questions/${id()}/usages`),
      student,
    ).expect(200);
    expect(mine.body.items[0]).toMatchObject({
      surveyId: a.s.id,
      internalName: "不应向他人公开的问卷名",
      status: "draft",
    });
    const others = await auth(
      request(app).get(`/api/questions/${id()}/usages/others`),
    ).expect(200);
    expect(others.body.items).toHaveLength(2);
    for (const row of others.body.items)
      expect(Object.keys(row).sort()).toEqual([
        "count",
        "status",
        "username",
        "versionNumber",
      ]);
    expect(JSON.stringify(others.body)).not.toContain("不应向他人公开");
    expect(JSON.stringify(others.body)).not.toContain(a.s.id);
    const detail = await library.get(student, id());
    expect(detail.modificationStatus).toMatchObject({
      ownUsageCount: 1,
      otherUsageCount: 0,
    });
    await auth(
      request(app).get(`/api/surveys/${b.s.id}/versions/${b.v}/statistics`),
    ).expect(404);
    const shares = await sharing.listGrants(owner, id(), 20);
    for (const g of shares.items) await sharing.revoke(owner, id(), g.shareId);
    expect((await sharing.otherUsages(owner, id(), 20)).items).toHaveLength(2);
  });
  it("supports encrypted summary pagination, cursor binding, and own usage pagination", async () => {
    await grant();
    await adopt();
    await adopt();
    await adopt(third);
    const first = await sharing.otherUsages(owner, id(), 1);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor!.split(".")).toHaveLength(3);
    expect(first.nextCursor).not.toContain(student.toString());
    const second = await sharing.otherUsages(owner, id(), 1, first.nextCursor!);
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((r) => r.username)).size,
    ).toBe(2);
    await expect(
      sharing.otherUsages(owner, id(), 1, `${first.nextCursor}bad`),
    ).rejects.toMatchObject({ status: 400 });
    const own = await sharing.ownUsages(student, id(), 1);
    expect(
      (await sharing.ownUsages(student, id(), 1, own.nextCursor!)).items,
    ).toHaveLength(1);
    await expect(
      sharing.listGrants(owner, id(), 1, own.nextCursor!),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("paginates shared identities without exposing unshared latest versions", async () => {
    await grant(["student"]);
    const other = await library.create(owner, {
      type: "text",
      title: "另一共享题",
      required: false,
      validation: {},
      options: [],
    });
    await sharing.grant(owner, other.question.libraryQuestionId, {
      usernames: ["student"],
      questionVersionIds: [other.version.questionVersionId],
    });
    const page = await library.listShared(student, 1),
      next = await library.listShared(student, 1, page.nextCursor!);
    expect(
      new Set(
        [...page.items, ...next.items].map((r) => r.question.libraryQuestionId),
      ).size,
    ).toBe(2);
    expect(next.nextCursor).toBeNull();
    await expect(
      library.listShared(third, 1, page.nextCursor!),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("serializes duplicate grant requests with one unique authorization row", async () => {
    const input = { usernames: ["student"], questionVersionIds: [vid()] };
    await Promise.all([
      sharing.grant(owner, id(), input),
      sharing.grant(owner, id(), input),
    ]);
    expect(await QuestionShareModel.countDocuments()).toBe(1);
  });
  it("lets an already authorized transaction commit before a competing revoke, then denies later use", async () => {
    await grant(["student"]);
    const g = (await sharing.listGrants(owner, id(), 20)).items[0]!,
      d = await draft();
    let release!: () => void, entered!: () => void;
    const acquired = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const service = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
      undefined,
      {
        afterLibraryAccess: async () => {
          entered();
          await gate;
        },
      },
    );
    const adopting = service.addLibraryQuestion(student, d.s.id, d.v, {
      revision: 1,
      libraryQuestionId: id(),
      questionVersionId: vid(),
      contentRevision: 1,
    });
    await acquired;
    const revoking = sharing.revoke(owner, id(), g.shareId);
    release();
    const [result] = await Promise.all([adopting, revoking]);
    expect(result.version.questions).toHaveLength(1);
    expect(await QuestionShareModel.countDocuments()).toBe(0);
    expect(await QuestionUsageModel.countDocuments()).toBe(1);
    await expect(library.copy(student, id(), vid(), 1)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects use when revocation commits first without freezing or orphan records", async () => {
    await grant(["student"]);
    const g = (await sharing.listGrants(owner, id(), 20)).items[0]!;
    await sharing.revoke(owner, id(), g.shareId);
    const d = await draft();
    await expect(
      surveys.addLibraryQuestion(student, d.s.id, d.v, {
        revision: 1,
        libraryQuestionId: id(),
        questionVersionId: vid(),
        contentRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await library.get(owner, id())).version.frozenAt).toBeNull();
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
  });
  it("rolls back authorization touch, source freeze and copy if later work fails", async () => {
    await grant(["student"]);
    const faulty = new LibraryService(new LibraryCursor(env.jwtSecret), {
      afterFreeze: () => {
        throw Error("copy rollback");
      },
    });
    await expect(faulty.copy(student, id(), vid(), 1)).rejects.toThrow(
      "copy rollback",
    );
    expect((await QuestionShareModel.findOne().lean())!.accessRevision).toBe(0);
    expect((await library.get(owner, id())).version.frozenAt).toBeNull();
    expect(await LibraryQuestionModel.countDocuments()).toBe(1);
  });
  it("rate limits uniform grant results rather than revealing account matches", async () => {
    for (let i = 0; i < 20; i++) await grant(["missing_user"]);
    await auth(request(app).post(`/api/questions/${id()}/shares`))
      .send({ usernames: ["student"], questionVersionIds: [vid()] })
      .expect(429);
    expect(await QuestionShareModel.countDocuments()).toBe(0);
  });
});
