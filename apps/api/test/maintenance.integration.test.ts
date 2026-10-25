import mongoose, { Types } from "mongoose";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { env } from "../src/config/env.js";
import { UsageMaintenance } from "../src/maintenance/usages.js";
import { cleanStage2Database, stage2Collections } from "./clean-stage2.js";
import { assertSafeTestDatabase } from "./database-safety.js";
import {
  createQuestion,
  createSurvey,
  addResponse,
  library,
  surveys,
} from "./library-statistics-fixtures.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { LibraryVersionModel } from "../src/models/library-question.js";
const tool = new UsageMaintenance(),
  user = new Types.ObjectId();
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
  await surveys.ensureIndexes();
  await SurveyResponseModel.init();
});
beforeEach(() => cleanStage2Database(env.mongoUri));
afterAll(async () => {
  await cleanStage2Database(env.mongoUri);
  await mongoose.disconnect();
});
it("cleans all known first/second stage collections and rejects another database name", async () => {
  for (const name of stage2Collections)
    await mongoose.connection
      .db!.collection(name)
      .insertOne({ testMarker: "cleanup" });
  await expect(
    cleanStage2Database("mongodb://127.0.0.1/another_test"),
  ).rejects.toThrow("当前连接");
  await expect(
    cleanStage2Database("mongodb://127.0.0.1/real_data"),
  ).rejects.toThrow("_test");
  await cleanStage2Database(env.mongoUri);
  for (const name of stage2Collections)
    expect(
      await mongoose.connection.db!.collection(name).countDocuments(),
    ).toBe(0);
});
it("audits missing, changed and extra usages then repairs only the named survey without touching snapshots or answers", async () => {
  const lib = await createQuestion(user),
    first = await createSurvey(user, [lib.version, lib.version, lib.version]);
  const foreign = await createSurvey(new Types.ObjectId(), [lib.version]).catch(
    () => null,
  );
  expect(foreign).toBeNull();
  const other = await createSurvey(user, [lib.version]);
  await addResponse(first, [18, 30, 60]);
  const snapshot = await SurveyVersionModel.findById(first.versionId).lean(),
    answers = await SurveyResponseModel.find().lean(),
    unaffected = await QuestionUsageModel.find({
      surveyId: other.surveyId,
    }).lean();
  const rows = await QuestionUsageModel.find({
    surveyId: first.surveyId,
  }).lean();
  await QuestionUsageModel.deleteOne({ _id: rows[0]!._id });
  await QuestionUsageModel.updateOne(
    { _id: rows[1]!._id },
    { $set: { ownerId: new Types.ObjectId(), status: "draft" } },
  );
  await QuestionUsageModel.create({
    ...rows[2],
    _id: new Types.ObjectId(),
    questionId: "q_extra",
  });
  const plan = await tool.check(user.toString(), first.surveyId);
  expect(plan).toMatchObject({
    missing: 1,
    changed: 1,
    extra: 1,
    clean: false,
    blockers: [],
  });
  expect(
    (await tool.repair(user.toString(), first.surveyId, plan.planHash))
      .repaired,
  ).toBe(true);
  expect((await tool.check(user.toString(), first.surveyId)).clean).toBe(true);
  expect(await SurveyVersionModel.findById(first.versionId).lean()).toEqual(
    snapshot,
  );
  expect(await SurveyResponseModel.find().lean()).toEqual(answers);
  expect(
    await QuestionUsageModel.find({ surveyId: other.surveyId }).lean(),
  ).toEqual(unaffected);
});
it("rejects stale plans, invalid owner IDs and missing confirmation hashes", async () => {
  const lib = await createQuestion(user),
    s = await createSurvey(user, [lib.version]);
  const plan = await tool.check(user.toString(), s.surveyId);
  await QuestionUsageModel.deleteMany({ surveyId: s.surveyId });
  await expect(
    tool.repair(user.toString(), s.surveyId, plan.planHash),
  ).rejects.toThrow("过期");
  await expect(tool.repair(user.toString(), s.surveyId, "")).rejects.toThrow(
    "planHash",
  );
  await expect(
    tool.check(new Types.ObjectId().toString(), s.surveyId),
  ).rejects.toThrow("ownerId");
});
it("does not thaw frozen versions or repair corrupted source definitions", async () => {
  const lib = await createQuestion(user),
    s = await createSurvey(user, [lib.version]);
  await QuestionUsageModel.deleteMany({ surveyId: s.surveyId });
  await LibraryVersionModel.updateOne(
    { _id: lib.version.questionVersionId },
    { $set: { frozenAt: null } },
  );
  const plan = await tool.check(user.toString(), s.surveyId);
  expect(plan.blockers.join()).toContain("unstable-library-version");
  await expect(
    tool.repair(user.toString(), s.surveyId, plan.planHash),
  ).rejects.toThrow("不能自动修复");
  expect(await QuestionUsageModel.countDocuments()).toBe(0);
});
it("rolls back a repair failure and serializes draft changes against a checked plan", async () => {
  const lib = await createQuestion(user),
    draft = await surveys.create(user, "修复竞争");
  await surveys.addLibraryQuestion(user, draft.id, draft.draftVersion!.id, {
    revision: 1,
    libraryQuestionId: lib.question.libraryQuestionId,
    questionVersionId: lib.version.questionVersionId,
    contentRevision: 1,
  });
  await QuestionUsageModel.deleteMany({});
  const plan = await tool.check(user.toString(), draft.id);
  const broken = new UsageMaintenance({
    afterWrite: () => {
      throw Error("repair failure");
    },
  });
  await expect(
    broken.repair(user.toString(), draft.id, plan.planHash),
  ).rejects.toThrow("repair failure");
  expect(await QuestionUsageModel.countDocuments()).toBe(0);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  let once = false;
  const gated = new UsageMaintenance({
    beforeWrite: async () => {
      if (!once) {
        once = true;
        entered();
        await gate;
      }
    },
  });
  const repairing = gated.repair(user.toString(), draft.id, plan.planHash);
  const rejected = expect(repairing).rejects.toThrow("过期");
  await ready;
  const q = (await surveys.getVersion(user, draft.id, draft.draftVersion!.id))
    .questions[0]!;
  await surveys.detachLibraryQuestion(
    user,
    draft.id,
    draft.draftVersion!.id,
    q.questionId,
    2,
  );
  release();
  await rejected;
  expect(await QuestionUsageModel.countDocuments()).toBe(0);
});
it("treats legacy source-free snapshots as clean and idempotent without changing survey metadata", async () => {
  const s = await surveys.create(user, "第一阶段兼容");
  await surveys.addQuestion(user, s.id, s.draftVersion!.id, {
    revision: 1,
    type: "number",
    title: "旧年龄",
    required: false,
    validation: {},
    options: [],
  });
  const before = await SurveyModel.findById(s.id).lean(),
    version = await SurveyVersionModel.findById(s.draftVersion!.id).lean();
  const plan = await tool.check(user.toString(), s.id);
  expect(plan).toMatchObject({ clean: true, expectedCount: 0 });
  expect(
    (await tool.repair(user.toString(), s.id, plan.planHash)).repaired,
  ).toBe(false);
  expect(await SurveyModel.findById(s.id).lean()).toEqual(before);
  expect(await SurveyVersionModel.findById(s.draftVersion!.id).lean()).toEqual(
    version,
  );
  expect(version!.schemaVersion).toBe(1);
});
