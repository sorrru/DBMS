import mongoose from "mongoose";
import { validateCredentials } from "../auth/validation.js";
import { env } from "../config/env.js";
import { assertLocalMongoUri } from "../database/local-safety.js";
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
  await surveys.create(user._id, "匿名课程反馈（种子）");
  const identified = await surveys.create(user._id, "实名活动报名（种子）");
  await surveys.patchDraft(
    user._id,
    identified.id,
    identified.draftVersion!.id,
    1,
    { identityMode: "identified" },
  );
  console.info(`种子数据已创建：${seedUsername}，2 份 v1 草稿`);
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "种子脚本执行失败");
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
