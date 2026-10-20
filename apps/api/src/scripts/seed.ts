import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { validateCredentials } from "../auth/validation.js";
import { env } from "../config/env.js";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { deriveOwnerKey } from "../fills/service.js";
import { FillSessionModel } from "../models/fill-session.js";
import { SurveyResponseModel } from "../models/response.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { UserModel } from "../models/user.js";
import { PasswordService } from "../security/password.js";
import { SurveyCursorService } from "../surveys/cursor.js";
import { SurveyService } from "../surveys/service.js";

const seedUsername = "seed_demo";
const seedRespondentUsernames = ["seed_guest_a", "seed_guest_b"] as const;
const seedUsernames = [seedUsername, ...seedRespondentUsernames];

interface SeedCounts {
  users: number;
  surveys: number;
  versions: number;
  sessions: number;
  responses: number;
}

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
): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB 尚未连接");
  const exists = await db
    .listCollections({ name }, { nameOnly: true })
    .hasNext();
  if (!exists) return 0;
  return (await db.collection(name).deleteMany(filter)).deletedCount;
}

async function cleanSeedData(): Promise<SeedCounts> {
  const users = await UserModel.find({
    usernameNormalized: { $in: seedUsernames },
  }).lean();
  const owner = users.find(
    (candidate) => candidate.usernameNormalized === seedUsername,
  );
  const surveyIds = owner
    ? ((await SurveyModel.find({ ownerId: owner._id }).distinct(
        "_id",
      )) as mongoose.Types.ObjectId[])
    : [];
  const responses = await deleteIfExists("responses", {
    surveyId: { $in: surveyIds },
  });
  const sessions = await deleteIfExists("fill_sessions", {
    surveyId: { $in: surveyIds },
  });
  const versions = (
    await SurveyVersionModel.deleteMany({ surveyId: { $in: surveyIds } })
  ).deletedCount;
  const surveys = (await SurveyModel.deleteMany({ _id: { $in: surveyIds } }))
    .deletedCount;
  const deletedUsers = (
    await UserModel.deleteMany({ usernameNormalized: { $in: seedUsernames } })
  ).deletedCount;
  return { users: deletedUsers, surveys, versions, sessions, responses };
}

async function countSeedData(): Promise<SeedCounts> {
  const users = await UserModel.find({
    usernameNormalized: { $in: seedUsernames },
  }).lean();
  const owner = users.find(
    (candidate) => candidate.usernameNormalized === seedUsername,
  );
  const surveyIds = owner
    ? ((await SurveyModel.find({ ownerId: owner._id }).distinct(
        "_id",
      )) as mongoose.Types.ObjectId[])
    : [];
  return {
    users: users.length,
    surveys: surveyIds.length,
    versions: await SurveyVersionModel.countDocuments({
      surveyId: { $in: surveyIds },
    }),
    sessions: await FillSessionModel.countDocuments({
      surveyId: { $in: surveyIds },
    }),
    responses: await SurveyResponseModel.countDocuments({
      surveyId: { $in: surveyIds },
    }),
  };
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
    SurveyResponseModel.init(),
  ]);
  const removed = await cleanSeedData();
  if (process.argv.includes("--clean")) {
    console.info(`种子数据已清理：${JSON.stringify(removed)}`);
    return;
  }
  const userInputs = [
    credentials,
    ...seedRespondentUsernames.map((username) =>
      validateCredentials({ username, password }, passwords, true),
    ),
  ];
  const createdUsers = [];
  for (const input of userInputs) {
    createdUsers.push(
      await UserModel.create({
        username: input.username,
        usernameNormalized: input.usernameNormalized,
        passwordHash: await passwords.hash(input.password),
        registeredAt: new Date(),
      }),
    );
  }
  const [user, guestA, guestB] = createdUsers;
  if (!user || !guestA || !guestB) throw new Error("种子账号创建不完整");
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
  const helpful = await addAnonymousQuestion(
    "multiple",
    "哪些内容最有帮助？",
    { minSelections: 1, maxSelections: 2 },
    [{ text: "课堂讲解" }, { text: "课程实验" }, { text: "课后讨论" }],
  );
  const contact = await addAnonymousQuestion(
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
  const createSubmittedResponse = async (input: {
    surveyId: mongoose.Types.ObjectId | string;
    versionId: mongoose.Types.ObjectId | string;
    identityMode: "anonymous" | "identified";
    respondent: typeof user;
    minutesAgo: number;
    questionPath: string[];
    ignoredQuestionIds: string[];
    answers: Array<{
      questionId: string;
      value: string | string[] | number;
    }>;
  }) => {
    const surveyId = new mongoose.Types.ObjectId(input.surveyId);
    const versionId = new mongoose.Types.ObjectId(input.versionId);
    const submittedAt = new Date(Date.now() - input.minutesAgo * 60_000);
    const fillSessionId = new mongoose.Types.ObjectId();
    const ownerKey = deriveOwnerKey(
      env.anonymousIdSecret,
      surveyId,
      input.respondent._id,
    );
    await FillSessionModel.create({
      _id: fillSessionId,
      surveyId,
      surveyVersionId: versionId,
      identityMode: input.identityMode,
      ownerKey,
      ...(input.identityMode === "identified"
        ? { userId: input.respondent._id }
        : {}),
      sessionTokenHash: createHash("sha256")
        .update(randomBytes(32))
        .digest("hex"),
      status: "submitted",
      activeSlot: null,
      startedAt: new Date(submittedAt.getTime() - 5 * 60_000),
      expiresAt: new Date(submittedAt.getTime() + 25 * 60_000),
      purgeAt: new Date(submittedAt.getTime() + 7 * 24 * 60 * 60_000),
      submittedAt,
    });
    await SurveyResponseModel.create({
      surveyId,
      surveyVersionId: versionId,
      fillSessionId,
      ownerKey,
      ...(input.identityMode === "anonymous" ? { dedupKey: ownerKey } : {}),
      ...(input.identityMode === "identified"
        ? { respondentId: input.respondent._id }
        : {}),
      questionPath: input.questionPath,
      ignoredQuestionIds: input.ignoredQuestionIds,
      answers: input.answers,
      submittedAt,
    });
  };
  const satisfied = satisfaction.options.find(
    (option) => option.text === "满意",
  )!;
  const neutral = satisfaction.options.find(
    (option) => option.text === "一般",
  )!;
  const lecture = helpful.options.find((option) => option.text === "课堂讲解")!;
  const experiment = helpful.options.find(
    (option) => option.text === "课程实验",
  )!;
  await createSubmittedResponse({
    surveyId: anonymous.id,
    versionId: anonymous.draftVersion!.id,
    identityMode: "anonymous",
    respondent: user,
    minutesAgo: 30,
    questionPath: [
      satisfaction.questionId,
      helpful.questionId,
      contact.questionId,
      studyHours.questionId,
    ],
    ignoredQuestionIds: [],
    answers: [
      { questionId: satisfaction.questionId, value: satisfied.optionId },
      {
        questionId: helpful.questionId,
        value: [lecture.optionId, experiment.optionId],
      },
      { questionId: contact.questionId, value: "13800138000" },
      { questionId: studyHours.questionId, value: 8 },
    ],
  });
  await createSubmittedResponse({
    surveyId: anonymous.id,
    versionId: anonymous.draftVersion!.id,
    identityMode: "anonymous",
    respondent: guestA,
    minutesAgo: 20,
    questionPath: [
      satisfaction.questionId,
      helpful.questionId,
      contact.questionId,
      studyHours.questionId,
    ],
    ignoredQuestionIds: [],
    answers: [
      { questionId: satisfaction.questionId, value: neutral.optionId },
      { questionId: helpful.questionId, value: [experiment.optionId] },
      { questionId: studyHours.questionId, value: 12 },
    ],
  });
  await createSubmittedResponse({
    surveyId: anonymous.id,
    versionId: anonymous.draftVersion!.id,
    identityMode: "anonymous",
    respondent: guestB,
    minutesAgo: 10,
    questionPath: [satisfaction.questionId, studyHours.questionId],
    ignoredQuestionIds: [helpful.questionId, contact.questionId],
    answers: [
      { questionId: satisfaction.questionId, value: dissatisfied.optionId },
      { questionId: studyHours.questionId, value: 6.5 },
    ],
  });
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
    { identityMode: "identified", allowMultipleSubmissions: true },
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
  const identifiedQuestionId =
    identifiedQuestion.version.questions[0]!.questionId;
  await createSubmittedResponse({
    surveyId: identified.id,
    versionId: identified.draftVersion!.id,
    identityMode: "identified",
    respondent: guestA,
    minutesAgo: 8,
    questionPath: [identifiedQuestionId],
    ignoredQuestionIds: [],
    answers: [{ questionId: identifiedQuestionId, value: "种子甲" }],
  });
  await createSubmittedResponse({
    surveyId: identified.id,
    versionId: identified.draftVersion!.id,
    identityMode: "identified",
    respondent: guestB,
    minutesAgo: 5,
    questionPath: [identifiedQuestionId],
    ignoredQuestionIds: [],
    answers: [{ questionId: identifiedQuestionId, value: "种子乙" }],
  });
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
  const counts = await countSeedData();
  console.info(
    `种子数据已创建：${seedUsernames.join("、")}；${JSON.stringify(counts)}`,
  );
  console.info(
    "匿名问卷 v1：3 份回答、两条路径；实名问卷：seed_guest_a 与 seed_guest_b 各 1 份回答；另含 v2 草稿、关闭、到期和过期旧会话。",
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "种子脚本执行失败");
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
