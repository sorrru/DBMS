import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { validateCredentials } from "../auth/validation.js";
import { env } from "../config/env.js";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { deriveOwnerKey } from "../fills/service.js";
import { FillSessionModel } from "../models/fill-session.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { UserModel } from "../models/user.js";
import { PasswordService } from "../security/password.js";
import { SurveyCursorService } from "../surveys/cursor.js";
import { SurveyService } from "../surveys/service.js";

const seedUsername = "seed_demo";

function assertSeedEnvironment(): string {
  if (process.env.NODE_ENV === "production")
    throw new Error("生产环境禁止运行种子脚本");
  assertLocalMongoUri(env.mongoUri);
  const password = process.env.SEED_USER_PASSWORD;
  if (!password)
    throw new Error("缺少 SEED_USER_PASSWORD；请提供满足正式规则的种子密码");
  return password;
}

async function deleteIfExists(
  name: string,
  filter: Record<string, unknown>,
): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB 尚未连接");
  const exists = await db
    .listCollections({ name }, { nameOnly: true })
    .hasNext();
  if (exists) await db.collection(name).deleteMany(filter);
}

async function cleanSeedData(): Promise<void> {
  const user = await UserModel.findOne({
    usernameNormalized: seedUsername,
  }).lean();
  if (!user) return;
  const surveyIds = (await SurveyModel.find({ ownerId: user._id }).distinct(
    "_id",
  )) as mongoose.Types.ObjectId[];
  await deleteIfExists("responses", { surveyId: { $in: surveyIds } });
  await deleteIfExists("fill_sessions", { surveyId: { $in: surveyIds } });
  await SurveyVersionModel.deleteMany({ surveyId: { $in: surveyIds } });
  await SurveyModel.deleteMany({ _id: { $in: surveyIds } });
  await UserModel.deleteOne({ _id: user._id });
}

async function main(): Promise<void> {
  const password = assertSeedEnvironment();
  const passwords = new PasswordService();
  const credentials = validateCredentials(
    { username: seedUsername, password },
    passwords,
    true,
  );
  await mongoose.connect(env.mongoUri);
  await Promise.all([
    UserModel.init(),
    SurveyModel.init(),
    SurveyVersionModel.init(),
    FillSessionModel.init(),
  ]);
  await cleanSeedData();
  if (process.argv.includes("--clean")) {
    console.info("种子数据已清理");
    return;
  }
  const user = await UserModel.create({
    username: credentials.username,
    usernameNormalized: credentials.usernameNormalized,
    passwordHash: await passwords.hash(credentials.password),
    registeredAt: new Date(),
  });
  const surveys = new SurveyService(
    env,
    new SurveyCursorService(env.jwtSecret),
  );
  const anonymous = await surveys.create(user._id, "匿名课程反馈（种子）");
  let anonymousRevision = 1;
  const addAnonymousQuestion = async (
    type: "single" | "multiple" | "text" | "number",
    title: string,
    validation: Record<string, unknown>,
    options: Array<{ text: string }>,
    required = false,
  ) => {
    const result = await surveys.addQuestion(
      user._id,
      anonymous.id,
      anonymous.draftVersion!.id,
      {
        revision: anonymousRevision,
        type,
        title,
        required,
        validation,
        options,
      },
    );
    anonymousRevision = result.version.revision;
    return result.version.questions.at(-1)!;
  };
  const satisfaction = await addAnonymousQuestion(
    "single",
    "你对课程整体满意吗？",
    {},
    [{ text: "满意" }, { text: "一般" }, { text: "不满意" }],
    true,
  );
  await addAnonymousQuestion(
    "multiple",
    "哪些内容最有帮助？",
    { minSelections: 1, maxSelections: 2 },
    [{ text: "课堂讲解" }, { text: "课程实验" }, { text: "课后讨论" }],
  );
  await addAnonymousQuestion(
    "text",
    "联系电话（仅 ASCII 数字）",
    { minLength: 7, maxLength: 20, digitsOnly: true },
    [],
  );
  const studyHours = await addAnonymousQuestion(
    "number",
    "每周学习时长（小时）",
    { integerOnly: false, minValue: 0, maxValue: 168 },
    [],
  );
  const dissatisfied = satisfaction.options.find(
    (option) => option.text === "不满意",
  )!;
  const branched = await surveys.updateJumpRules(
    user._id,
    anonymous.id,
    anonymous.draftVersion!.id,
    satisfaction.questionId,
    anonymousRevision,
    [
      {
        operator: "equals",
        value: dissatisfied.optionId,
        targetQuestionId: studyHours.questionId,
      },
    ],
  );
  anonymousRevision = branched.version.revision;
  await surveys.publish(
    user._id,
    anonymous.id,
    anonymous.draftVersion!.id,
    anonymousRevision,
    true,
  );
  await surveys.createNextVersion(
    user._id,
    anonymous.id,
    anonymous.draftVersion!.id,
  );
  const oldSessionStartedAt = new Date(Date.now() - 45 * 60_000);
  const oldSessionExpiresAt = new Date(Date.now() - 15 * 60_000);
  await FillSessionModel.create({
    surveyId: anonymous.id,
    surveyVersionId: anonymous.draftVersion!.id,
    identityMode: "anonymous",
    ownerKey: deriveOwnerKey(env.anonymousIdSecret, anonymous.id, user._id),
    sessionTokenHash: createHash("sha256")
      .update(randomBytes(32))
      .digest("hex"),
    status: "active",
    activeSlot: 0,
    startedAt: oldSessionStartedAt,
    expiresAt: oldSessionExpiresAt,
    purgeAt: new Date(oldSessionExpiresAt.getTime() + 7 * 24 * 60 * 60_000),
    submittedAt: null,
  });
  const identified = await surveys.create(user._id, "实名活动报名（种子）");
  const identifiedSettings = await surveys.patchDraft(
    user._id,
    identified.id,
    identified.draftVersion!.id,
    1,
    { identityMode: "identified" },
  );
  const identifiedQuestion = await surveys.addQuestion(
    user._id,
    identified.id,
    identified.draftVersion!.id,
    {
      revision: identifiedSettings.version.revision,
      type: "text",
      title: "姓名",
      required: true,
      validation: { minLength: 1, maxLength: 80 },
      options: [],
    },
  );
  await surveys.publish(
    user._id,
    identified.id,
    identified.draftVersion!.id,
    identifiedQuestion.version.revision,
    false,
  );
  await surveys.setStatus(user._id, identified.id, "closed");

  const expired = await surveys.create(user._id, "已到期问卷（种子）");
  const expiredQuestion = await surveys.addQuestion(
    user._id,
    expired.id,
    expired.draftVersion!.id,
    {
      revision: 1,
      type: "text",
      title: "历史反馈",
      required: false,
      validation: {},
      options: [],
    },
  );
  await surveys.publish(
    user._id,
    expired.id,
    expired.draftVersion!.id,
    expiredQuestion.version.revision,
    false,
  );
  await SurveyVersionModel.updateOne(
    { _id: expired.draftVersion!.id },
    { $set: { deadline: new Date("2020-01-01T00:00:00.000Z") } },
  );
  console.info(
    `种子数据已创建：${seedUsername}，包含匿名、实名、已发布 v1 + 草稿 v2、关闭、到期、旧版本会话、四种题型和有效分支`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "种子脚本执行失败");
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
