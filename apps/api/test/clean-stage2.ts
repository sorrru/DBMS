import mongoose from "mongoose";
import { assertSafeTestDatabase } from "./database-safety.js";
export const stage2Collections = [
  "responses",
  "fill_sessions",
  "question_usages",
  "question_shares",
  "question_bank_items",
  "question_banks",
  "library_option_keys",
  "question_versions",
  "questions",
  "survey_versions",
  "surveys",
  "users",
  "stage2_demo_manifest",
] as const;
export async function cleanStage2Database(uri: string) {
  assertSafeTestDatabase(uri);
  const database = mongoose.connection.db;
  if (!database || mongoose.connection.readyState !== 1)
    throw Error("测试清理要求已连接数据库");
  assertSafeTestDatabase(`mongodb://127.0.0.1/${database.databaseName}`);
  const requested = uri.slice(uri.lastIndexOf("/") + 1).split("?")[0];
  if (requested !== database.databaseName)
    throw Error("当前连接与声明测试库不同，拒绝清理");
  for (const name of stage2Collections)
    await database.collection(name).deleteMany({});
}
