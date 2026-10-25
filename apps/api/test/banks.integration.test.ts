import { SurveyService } from "../src/surveys/service.js";
import { SurveyCursorService } from "../src/surveys/cursor.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { PasswordService } from "../src/security/password.js";
import { TokenService } from "../src/security/token.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { sessionCookieName } from "../src/http/cookies.js";
import { LibraryService } from "../src/library/service.js";
import { LibrarySharingService } from "../src/library/sharing.js";
import { LibraryCursor } from "../src/library/cursor.js";
import { BankService } from "../src/banks/service.js";
import {
  QuestionBankModel,
  QuestionBankItemModel,
} from "../src/models/question-bank.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../src/models/library-question.js";
import { QuestionShareModel } from "../src/models/question-share.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { UserModel } from "../src/models/user.js";
import { assertSafeTestDatabase } from "./database-safety.js";
const tokens = new TokenService(env.jwtSecret),
  limits = new FixedWindowStore(1000),
  cursors = new LibraryCursor(env.jwtSecret);
const app = createApp({
  env: { ...env, surveyWriteRateLimit: 1000 },
  passwords: new PasswordService(),
  tokens,
  rateLimits: limits,
});
const library = new LibraryService(cursors),
  sharing = new LibrarySharingService(cursors),
  banks = new BankService(cursors);
let owner: Types.ObjectId,
  student: Types.ObjectId,
  lib: Awaited<ReturnType<LibraryService["create"]>>,
  bank: Awaited<ReturnType<BankService["create"]>>;
const auth = (call: request.Test, user = owner) =>
  call
    .set("Origin", "http://localhost:5173")
    .set("Cookie", `${sessionCookieName}=${tokens.sign(user.toString())}`);
const input = (versionPolicy: "latest" | "pinned" = "latest") => ({
  libraryQuestionId: lib.question.libraryQuestionId,
  versionPolicy,
  questionVersionId:
    versionPolicy === "pinned" ? lib.version.questionVersionId : null,
});
async function clean() {
  await Promise.all([
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    QuestionBankItemModel.deleteMany({}),
    QuestionBankModel.deleteMany({}),
    QuestionShareModel.deleteMany({}),
    QuestionUsageModel.deleteMany({}),
    LibraryOptionKeyModel.deleteMany({}),
    LibraryVersionModel.deleteMany({}),
    LibraryQuestionModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
}
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
  await banks.ensureIndexes();
  await UserModel.init();
});
beforeEach(async () => {
  limits.reset();
  await clean();
  const users = await UserModel.create(
    ["teacher", "student"].map((name) => ({
      username: name,
      usernameNormalized: name,
      passwordHash: "unused",
      registeredAt: new Date(),
    })),
  );
  owner = users[0]!._id;
  student = users[1]!._id;
  lib = await library.create(owner, {
    type: "number",
    title: "年龄",
    required: true,
    validation: { integerOnly: true },
    options: [],
  });
  bank = await banks.create(owner, "基本信息");
});
afterAll(async () => {
  await clean();
  await mongoose.disconnect();
  limits.dispose();
});
it("validates payloads, origin, authentication and hides another user's bank", async () => {
  await request(app).get("/api/question-banks").expect(401);
  await auth(
    request(app).get(`/api/question-banks/${bank.bankId}/items`),
    student,
  ).expect(404);
  await auth(request(app).patch(`/api/question-banks/${bank.bankId}`), student)
    .send({ name: "盗改", revision: 1 })
    .expect(404);
  for (const body of [
    { name: " " },
    { name: "a".repeat(81) },
    { name: { $ne: null } },
    { name: "x", ownerId: owner.toString() },
  ])
    await auth(request(app).post("/api/question-banks")).send(body).expect(400);
  await request(app)
    .post("/api/question-banks")
    .send({ name: "x" })
    .expect(403);
  await auth(request(app).post(`/api/question-banks/${bank.bankId}/items`))
    .send({ ...input(), versionPolicy: "unknown" })
    .expect(400);
  await auth(request(app).post(`/api/question-banks/${bank.bankId}/items`))
    .send({ ...input(), questionVersionId: lib.version.questionVersionId })
    .expect(400);
});
it("renames with revision guards, paginates and binds cursors to user and bank", async () => {
  const other = await banks.create(owner, "另一个库");
  const page = await banks.list(owner, 1);
  expect(page.items[0]!.bankId).toBe(other.bankId);
  expect((await banks.list(owner, 1, page.nextCursor!)).items[0]!.bankId).toBe(
    bank.bankId,
  );
  await expect(banks.list(student, 1, page.nextCursor!)).rejects.toMatchObject({
    status: 400,
  });
  expect((await banks.rename(owner, bank.bankId, 1, "新名称")).revision).toBe(
    2,
  );
  await expect(
    banks.rename(owner, bank.bankId, 1, "旧写入"),
  ).rejects.toMatchObject({ status: 409 });
  await expect(banks.remove(owner, bank.bankId, 1)).rejects.toMatchObject({
    status: 409,
  });
});
it("allows one identity in multiple banks without freezing, copying or usages", async () => {
  const other = await banks.create(owner, "第二库");
  await banks.putMember(owner, bank.bankId, input());
  await banks.putMember(owner, other.bankId, input("pinned"));
  expect(await QuestionBankItemModel.countDocuments()).toBe(2);
  expect(await LibraryQuestionModel.countDocuments()).toBe(1);
  expect(await QuestionUsageModel.countDocuments()).toBe(0);
  expect(
    (await library.get(owner, lib.question.libraryQuestionId)).version.frozenAt,
  ).toBeNull();
  await library.edit(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    { ...lib.version.definition, title: "修订年龄" },
  );
  expect(
    (await banks.members(owner, other.bankId, 20)).items[0]!.version!.definition
      .title,
  ).toBe("修订年龄");
});
it("serializes duplicate membership creation and keeps a unique member", async () => {
  const results = await Promise.allSettled([
    banks.putMember(owner, bank.bankId, input()),
    banks.putMember(owner, bank.bankId, input()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  expect(await QuestionBankItemModel.countDocuments()).toBe(1);
});
it("follows latest and explicitly updates pinned members with a conflict guard", async () => {
  await banks.putMember(owner, bank.bankId, input("pinned"));
  const item = (await banks.members(owner, bank.bankId, 20)).items[0]!;
  const next = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    { ...lib.version.definition, title: "周岁年龄" },
  );
  expect(
    (await banks.members(owner, bank.bankId, 20)).items[0]!.version!
      .versionNumber,
  ).toBe(1);
  await banks.putMember(
    owner,
    bank.bankId,
    {
      ...input("pinned"),
      questionVersionId: next.version.questionVersionId,
      revision: item.revision,
    },
    item.itemId,
  );
  expect(
    (await banks.members(owner, bank.bankId, 20)).items[0]!.version!.definition
      .title,
  ).toBe("周岁年龄");
  await expect(
    banks.putMember(
      owner,
      bank.bankId,
      { ...input(), revision: item.revision },
      item.itemId,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await banks.putMember(
    owner,
    bank.bankId,
    { ...input(), revision: 2 },
    item.itemId,
  );
  const third = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    next.version.questionVersionId,
    1,
    { ...next.version.definition, title: "最新年龄" },
  );
  expect(
    (await banks.members(owner, bank.bankId, 20)).items[0]!.version!
      .questionVersionId,
  ).toBe(third.version.questionVersionId);
});
it("resolves shared latest to the highest granted version and marks revoked pinned unavailable", async () => {
  const mine = await banks.create(student, "共享分类");
  await sharing.grant(owner, lib.question.libraryQuestionId, {
    usernames: ["student"],
    questionVersionIds: [lib.version.questionVersionId],
  });
  await banks.putMember(student, mine.bankId, input());
  const next = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    { ...lib.version.definition, title: "未共享秘密" },
  );
  let member = (await banks.members(student, mine.bankId, 20)).items[0]!;
  expect(member.version!.versionNumber).toBe(1);
  expect(JSON.stringify(member)).not.toContain("未共享秘密");
  await expect(
    banks.putMember(
      student,
      mine.bankId,
      {
        ...input("pinned"),
        questionVersionId: next.version.questionVersionId,
        revision: 1,
      },
      member.itemId,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await sharing.grant(owner, lib.question.libraryQuestionId, {
    usernames: ["student"],
    questionVersionIds: [next.version.questionVersionId],
  });
  expect(
    (await banks.members(student, mine.bankId, 20)).items[0]!.version!
      .versionNumber,
  ).toBe(2);
  await banks.putMember(
    student,
    mine.bankId,
    { ...input("pinned"), revision: 1 },
    member.itemId,
  );
  const grants = await sharing.listGrants(
    owner,
    lib.question.libraryQuestionId,
    20,
  );
  await sharing.revoke(
    owner,
    lib.question.libraryQuestionId,
    grants.items.find((g) => g.versionNumber === 1)!.shareId,
  );
  member = (await banks.members(student, mine.bankId, 20)).items[0]!;
  expect(member.available).toBe(false);
  expect(member.version).toBeNull();
  await banks.removeMember(
    student,
    mine.bankId,
    member.itemId,
    member.revision,
  );
});
it("does not grant access to an unshared question or a version from another identity", async () => {
  const mine = await banks.create(student, "自己的库");
  await expect(
    banks.putMember(student, mine.bankId, input()),
  ).rejects.toMatchObject({ status: 404 });
  const other = await library.create(owner, {
    type: "text",
    title: "另一题",
    required: false,
    validation: {},
    options: [],
  });
  await expect(
    banks.putMember(owner, bank.bankId, {
      ...input("pinned"),
      questionVersionId: other.version.questionVersionId,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await QuestionBankItemModel.countDocuments()).toBe(0);
});
it("removes only classifications and preserves source identity and versions", async () => {
  await banks.putMember(owner, bank.bankId, input());
  const member = (await banks.members(owner, bank.bankId, 20)).items[0]!;
  await expect(
    banks.removeMember(owner, bank.bankId, member.itemId, 2),
  ).rejects.toMatchObject({ status: 409 });
  await banks.removeMember(owner, bank.bankId, member.itemId, 1);
  await banks.putMember(owner, bank.bankId, input());
  await banks.remove(owner, bank.bankId, 1);
  expect(await QuestionBankItemModel.countDocuments()).toBe(0);
  expect(await LibraryVersionModel.countDocuments()).toBe(1);
  expect(
    (await library.get(owner, lib.question.libraryQuestionId)).version.frozenAt,
  ).toBeNull();
});
it("paginates members and rejects cursors reused for another bank", async () => {
  await banks.putMember(owner, bank.bankId, input());
  const other = await library.create(owner, {
    type: "text",
    title: "姓名",
    required: true,
    validation: {},
    options: [],
  });
  await banks.putMember(owner, bank.bankId, {
    ...input(),
    libraryQuestionId: other.question.libraryQuestionId,
  });
  const first = await banks.members(owner, bank.bankId, 1);
  expect(first.items).toHaveLength(1);
  expect(
    (await banks.members(owner, bank.bankId, 1, first.nextCursor!)).items[0]!
      .itemId,
  ).not.toBe(first.items[0]!.itemId);
  const second = await banks.create(owner, "其他库");
  await expect(
    banks.members(owner, second.bankId, 1, first.nextCursor!),
  ).rejects.toMatchObject({ status: 400 });
});
it("rolls back member, parent touch and permission touch together", async () => {
  await sharing.grant(owner, lib.question.libraryQuestionId, {
    usernames: ["student"],
    questionVersionIds: [lib.version.questionVersionId],
  });
  const mine = await banks.create(student, "共享分类");
  const faulty = new BankService(cursors, {
    afterMemberWrite: () => {
      throw Error("bank rollback");
    },
  });
  await expect(faulty.putMember(student, mine.bankId, input())).rejects.toThrow(
    "bank rollback",
  );
  expect(await QuestionBankItemModel.countDocuments()).toBe(0);
  expect(
    (await QuestionBankModel.findById(mine.bankId).lean())!.membershipRevision,
  ).toBe(0);
  expect((await QuestionShareModel.findOne().lean())!.accessRevision).toBe(0);
});
it("serializes bank deletion against member insertion without orphan records", async () => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const gated = new BankService(cursors, {
    afterMemberWrite: async () => {
      entered();
      await gate;
    },
  });
  const writing = gated.putMember(owner, bank.bankId, input());
  await ready;
  const deleting = banks.remove(owner, bank.bankId, 1);
  release();
  await Promise.all([writing, deleting]);
  expect(await QuestionBankModel.countDocuments()).toBe(0);
  expect(await QuestionBankItemModel.countDocuments()).toBe(0);
});
it("exposes the complete authenticated HTTP CRUD flow", async () => {
  const path = `/api/question-banks/${bank.bankId}`;
  await auth(request(app).post(`${path}/items`))
    .send(input("pinned"))
    .expect(201);
  const page = await auth(request(app).get(`${path}/items`)).expect(200),
    member = page.body.items[0];
  await auth(request(app).put(`${path}/items/${member.itemId}`))
    .send({ ...input(), revision: 1 })
    .expect(200);
  await auth(request(app).delete(`${path}/items/${member.itemId}`))
    .send({ revision: 2 })
    .expect(204);
  const renamed = await auth(request(app).patch(path))
    .send({ name: "更新名称", revision: 1 })
    .expect(200);
  await auth(request(app).delete(path))
    .send({ revision: renamed.body.revision })
    .expect(204);
});

it("does not change survey snapshots or usage projections when a bank member updates", async () => {
  const surveys = new SurveyService(
    env,
    new SurveyCursorService(env.jwtSecret),
  );
  await surveys.ensureIndexes();
  const survey = await surveys.create(owner, "题库更新隔离检查");
  const adopted = await surveys.addLibraryQuestion(
    owner,
    survey.id,
    survey.draftVersion!.id,
    {
      revision: 1,
      libraryQuestionId: lib.question.libraryQuestionId,
      questionVersionId: lib.version.questionVersionId,
      contentRevision: 1,
    },
  );
  await banks.putMember(owner, bank.bankId, input("pinned"));
  const member = (await banks.members(owner, bank.bankId, 20)).items[0]!;
  const before = await QuestionUsageModel.find().lean();
  const next = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    { ...lib.version.definition, title: "新版本年龄" },
  );
  await banks.putMember(
    owner,
    bank.bankId,
    {
      ...input("pinned"),
      questionVersionId: next.version.questionVersionId,
      revision: member.revision,
    },
    member.itemId,
  );
  expect(
    (await surveys.getVersion(owner, survey.id, survey.draftVersion!.id))
      .questions,
  ).toEqual(adopted.version.questions);
  expect(await QuestionUsageModel.find().lean()).toEqual(before);
  await banks.remove(owner, bank.bankId, 1);
  expect(
    (
      await library.get(
        owner,
        lib.question.libraryQuestionId,
        lib.version.questionVersionId,
      )
    ).version.frozenAt,
  ).not.toBeNull();
});
