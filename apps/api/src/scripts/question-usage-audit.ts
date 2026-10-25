import mongoose from "mongoose";
import { env } from "../config/env.js";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { UsageMaintenance } from "../maintenance/usages.js";
import { SurveyModel } from "../models/survey.js";
import { QuestionUsageModel } from "../models/question-usage.js";
const args = process.argv.slice(2),
  allowed = new Set([
    "--all",
    "--apply",
    "--ownerId",
    "--surveyId",
    "--planHash",
  ]);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (!allowed.has(arg) || values.has(arg)) throw Error("未知或重复参数");
  if (arg === "--all" || arg === "--apply") values.set(arg, "true");
  else {
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error(`缺少 ${arg} 参数`);
    values.set(arg, value);
  }
}
if (process.env.NODE_ENV === "production")
  throw Error("生产环境不允许运行本地维护脚本");
assertLocalMongoUri(env.mongoUri);
const all = values.has("--all"),
  apply = values.has("--apply"),
  owner = values.get("--ownerId"),
  survey = values.get("--surveyId"),
  hash = values.get("--planHash");
if (
  all
    ? apply || values.size !== 1
    : !owner ||
      !survey ||
      !/^[a-f\d]{24}$/.test(owner) ||
      !/^[a-f\d]{24}$/.test(survey) ||
      (apply ? !hash || !/^[a-f\d]{64}$/.test(hash) : !!hash)
)
  throw Error(
    "检查用 --all 或 --ownerId ID --surveyId ID；修复另加 --apply --planHash HASH，不支持全库修复",
  );
await mongoose.connect(env.mongoUri);
try {
  const service = new UsageMaintenance();
  if (all) {
    for await (const s of SurveyModel.find()
      .select({ _id: 1, ownerId: 1 })
      .cursor())
      console.log(
        JSON.stringify(
          await service.check(s.ownerId.toString(), s._id.toString()),
        ),
      );
    const orphan = await QuestionUsageModel.aggregate([
      {
        $lookup: {
          from: "surveys",
          localField: "surveyId",
          foreignField: "_id",
          as: "survey",
        },
      },
      { $match: { "survey.0": { $exists: false } } },
      { $count: "count" },
    ]);
    console.log(
      JSON.stringify({
        orphanSurveyUsages: orphan[0]?.count ?? 0,
        note: "孤立问卷记录只报告，不自动删除",
      }),
    );
  } else
    console.log(
      JSON.stringify(
        apply
          ? await service.repair(owner!, survey!, hash!)
          : await service.check(owner!, survey!),
      ),
    );
} finally {
  await mongoose.disconnect();
}
