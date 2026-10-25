import mongoose, { Types } from "mongoose";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { env } from "../src/config/env.js";
import { Stage2Demo, demoNames } from "../src/maintenance/stage2-demo.js";
import { UsageMaintenance } from "../src/maintenance/usages.js";
import { assertLegacySeedSafe } from "../src/maintenance/seed-safety.js";
import { PasswordService } from "../src/security/password.js";
import { UserModel } from "../src/models/user.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { Stage2DemoModel } from "../src/models/stage2-demo.js";
import { QuestionShareModel } from "../src/models/question-share.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { LibraryQuestionModel } from "../src/models/library-question.js";
import { LibraryStatisticsService } from "../src/library-statistics/service.js";
import { LibrarySharingService } from "../src/library/sharing.js";
import { LibraryService } from "../src/library/service.js";
import { LibraryCursor } from "../src/library/cursor.js";
import { BankService } from "../src/banks/service.js";
import { StatisticsService } from "../src/statistics/service.js";
import { StatisticsCursorService } from "../src/statistics/cursor.js";
import { cleanStage2Database } from "./clean-stage2.js";
import { assertSafeTestDatabase } from "./database-safety.js";
const passwords = new PasswordService(
    { N: 1024, r: 8, p: 1, maxmem: 8388608, saltBytes: 16, keyBytes: 32 },
    "unused",
  ),
  demo = new Stage2Demo(env, passwords),
  pass = "M6DisposableTest2026!";
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
});
beforeEach(() => cleanStage2Database(env.mongoUri));
afterAll(async () => {
  await cleanStage2Database(env.mongoUri);
  await mongoose.disconnect();
});
it("creates a complete four-type demo, verifies usage projections and preserves existing accounts on repeated runs", async () => {
  const unrelated = await UserModel.create({
    username: "keep_me",
    usernameNormalized: "keep_me",
    passwordHash: "must-not-change",
    registeredAt: new Date(),
  });
  const created = await demo.create(pass);
  expect(created.created).toBe(true);
  expect(created.counts).toEqual({
    users: 3,
    surveys: 4,
    questions: 5,
    banks: 3,
  });
  expect(created.teacherAge).toMatchObject({ count: 3, sum: 108, average: 36 });
  expect(created.studentAge).toMatchObject({ count: 1, sum: 88 });
  const before = await UserModel.find({
    usernameNormalized: { $in: [...demoNames] },
  }).lean();
  expect((await demo.create()).created).toBe(false);
  expect(
    await UserModel.find({
      usernameNormalized: { $in: [...demoNames] },
    }).lean(),
  ).toEqual(before);
  for (const s of await SurveyModel.find().lean())
    expect(
      (
        await new UsageMaintenance().check(
          s.ownerId.toString(),
          s._id.toString(),
        )
      ).clean,
    ).toBe(true);
  const teacher = before.find((u) => u.usernameNormalized === demoNames[0])!,
    student = before.find((u) => u.usernameNormalized === demoNames[1])!;
  const sharing = new LibrarySharingService(new LibraryCursor(env.jwtSecret)),
    lib = await LibraryQuestionModel.findOne({
      ownerId: teacher._id,
      type: "number",
    }).lean();
  expect(
    (
      await sharing.otherUsages(teacher._id, lib!._id.toString(), 20)
    ).items.some((r) => r.username === demoNames[1]),
  ).toBe(true);
  const bankService = new BankService(new LibraryCursor(env.jwtSecret)),
    banks = await bankService.list(student._id, 20),
    members = await bankService.members(
      student._id,
      banks.items[0]!.bankId,
      20,
    );
  expect(members.items.filter((r) => !r.available)).toHaveLength(1);
  const stats = new LibraryStatisticsService(env.jwtSecret, 10000);
  expect(
    (await stats.catalog(teacher._id, lib!._id.toString())).versions.map(
      (v) => v.versionNumber,
    ),
  ).toEqual([2, 1]);
  expect(await SurveyResponseModel.countDocuments()).toBe(4);
  expect(await UserModel.findById(unrelated._id).lean()).toMatchObject({
    passwordHash: "must-not-change",
  });
});
it("cleans and recreates only manifest-owned fixtures, with idempotent second cleanup", async () => {
  const old = await UserModel.create({
    username: "seed_demo",
    usernameNormalized: "seed_demo",
    passwordHash: "preserve-original",
    registeredAt: new Date(),
  });
  await demo.create(pass);
  expect((await demo.clean()).removed).toBe(true);
  expect((await demo.clean()).removed).toBe(false);
  expect(await UserModel.findById(old._id).lean()).toMatchObject({
    passwordHash: "preserve-original",
  });
  expect(await QuestionUsageModel.countDocuments()).toBe(0);
  expect(await LibraryQuestionModel.countDocuments()).toBe(0);
  expect((await demo.create(pass)).teacherAge!.sum).toBe(108);
});
it("refuses username collisions, missing passwords and incomplete fixtures without deleting anything", async () => {
  await expect(demo.create()).rejects.toThrow("SEED_USER_PASSWORD");
  const occupied = await UserModel.create({
    username: demoNames[0],
    usernameNormalized: demoNames[0],
    passwordHash: "keep",
    registeredAt: new Date(),
  });
  await expect(demo.create(pass)).rejects.toThrow("被占用");
  expect(await Stage2DemoModel.countDocuments()).toBe(0);
  expect(await UserModel.findById(occupied._id).lean()).toMatchObject({
    passwordHash: "keep",
  });
  await Stage2DemoModel.create({
    _id: "stage2-m6-v1",
    userIds: [occupied._id],
    state: "building",
  });
  await expect(demo.create(pass)).rejects.toThrow("未完成");
});
it("blocks demo cleanup when another account has been authorized and retains every fixture", async () => {
  await demo.create(pass);
  const teacher = await UserModel.findOne({
      usernameNormalized: demoNames[0],
    }).lean(),
    lib = await LibraryQuestionModel.findOne({
      ownerId: teacher!._id,
      type: "number",
    }).lean();
  await QuestionShareModel.create({
    libraryQuestionId: lib!._id,
    questionVersionId: lib!.latestVersionId,
    recipientId: new Types.ObjectId(),
  });
  await expect(demo.clean()).rejects.toThrow("非演示账号");
  expect(await Stage2DemoModel.countDocuments()).toBe(1);
  expect(await SurveyResponseModel.countDocuments()).toBe(4);
});
it("protects original seed cleanup after stage-two use but allows source-free legacy data", async () => {
  const owner = new Types.ObjectId();
  await expect(assertLegacySeedSafe([owner], [])).resolves.toBeUndefined();
  const library = new LibraryService(new LibraryCursor(env.jwtSecret));
  await library.create(owner, {
    type: "number",
    title: "手工创建年龄",
    required: false,
    validation: {},
    options: [],
  });
  await expect(assertLegacySeedSafe([owner], [])).rejects.toThrow(
    "拒绝重建或清理",
  );
  expect(await LibraryQuestionModel.countDocuments()).toBe(1);
});
it("does not rewrite source-free published snapshots, historic answers or their original statistics", async () => {
  const owner = new Types.ObjectId(),
    survey = await SurveyModel.create({
      ownerId: owner,
      publicId: "legacy-probe",
      internalName: "旧问卷",
      manualStatus: "open",
    });
  const version = await SurveyVersionModel.create({
    surveyId: survey._id,
    versionNumber: 1,
    status: "published",
    revision: 7,
    title: "旧问卷",
    identityMode: "anonymous",
    allowMultipleSubmissions: false,
    sessionDurationMinutes: 30,
    schemaVersion: 1,
    publishedAt: new Date("2026-10-20T00:00:00Z"),
    questions: [
      {
        questionId: "q_old",
        type: "number",
        title: "旧年龄",
        required: true,
        validation: { integerOnly: false, minValue: null, maxValue: null },
        options: [],
        jumpRules: [],
      },
    ],
  });
  await SurveyResponseModel.create({
    surveyId: survey._id,
    surveyVersionId: version._id,
    fillSessionId: new Types.ObjectId(),
    ownerKey: "anon:legacy",
    questionPath: ["q_old"],
    ignoredQuestionIds: [],
    answers: [{ questionId: "q_old", value: 25 }],
    submittedAt: new Date("2026-10-20T01:00:00Z"),
  });
  const snapshots = await SurveyVersionModel.findById(version._id).lean(),
    answers = await SurveyResponseModel.find({ surveyId: survey._id }).lean();
  await demo.create(pass);
  expect(await SurveyVersionModel.findById(version._id).lean()).toEqual(
    snapshots,
  );
  expect(
    await SurveyResponseModel.find({ surveyId: survey._id }).lean(),
  ).toEqual(answers);
  const result = await new StatisticsService(
    env,
    new StatisticsCursorService(env.jwtSecret),
  ).statistics(owner, survey._id.toString(), version._id.toString());
  expect(result.submissionCount).toBe(1);
  expect(result.questions[0]).toMatchObject({
    questionId: "q_old",
    number: { count: 1, average: 25, minimum: 25, maximum: 25 },
  });
});
