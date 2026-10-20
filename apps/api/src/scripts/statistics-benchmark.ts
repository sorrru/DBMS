import mongoose, { Types } from "mongoose";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { SurveyResponseModel } from "../models/response.js";
import {
  buildStatisticsPipelines,
  buildTextResponsePipeline,
} from "../statistics/pipelines.js";

const uri = process.env.STATISTICS_BENCHMARK_URI;
if (process.env.NODE_ENV === "production")
  throw new Error("生产环境禁止运行统计基准脚本");
if (!uri) throw new Error("缺少 STATISTICS_BENCHMARK_URI");
assertLocalMongoUri(uri);
const databaseName = uri
  .slice(uri.indexOf("/", "mongodb://".length) + 1)
  .split("?")[0];
if (!databaseName?.endsWith("_benchmark"))
  throw new Error("统计基准数据库名必须以 _benchmark 结尾");

const count = Number(process.env.STATISTICS_BENCHMARK_COUNT ?? 50_000);
const seed = Number(process.env.STATISTICS_BENCHMARK_SEED ?? 20261020);
if (!Number.isInteger(count) || count < 1 || count > 100_000)
  throw new Error("STATISTICS_BENCHMARK_COUNT 必须是 1 至 100000 的整数");
if (!Number.isInteger(seed))
  throw new Error("STATISTICS_BENCHMARK_SEED 必须是整数");

let state = seed >>> 0;
function random(): number {
  state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return state / 2 ** 32;
}

function compactExplain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactExplain).filter(Boolean);
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const keys = [
    "stage",
    "indexName",
    "nReturned",
    "totalDocsExamined",
    "totalKeysExamined",
    "executionTimeMillis",
    "executionTimeMillisEstimate",
  ];
  const own = Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  const children = Object.entries(source)
    .filter(([key, child]) => !keys.includes(key) && typeof child === "object")
    .map(([key, child]) => [key, compactExplain(child)] as const)
    .filter(([, child]) =>
      Array.isArray(child)
        ? child.length > 0
        : Boolean(child && Object.keys(child as object).length),
    );
  return { ...own, ...Object.fromEntries(children) };
}

async function main(): Promise<void> {
  await mongoose.connect(uri!);
  await SurveyResponseModel.init();
  const marker = "statistics-benchmark-v1";
  await SurveyResponseModel.deleteMany({ ownerKey: { $regex: `^${marker}:` } });
  if (process.argv.includes("--clean")) {
    console.info("统计基准数据已清理");
    return;
  }
  const surveyId = new Types.ObjectId();
  const versionId = new Types.ObjectId();
  const start = Date.UTC(2027, 0, 1);
  for (let offset = 0; offset < count; offset += 1_000) {
    const batchSize = Math.min(1_000, count - offset);
    const documents = Array.from({ length: batchSize }, (_, localIndex) => {
      const index = offset + localIndex;
      const reachesText = random() < 0.7;
      const answers = [
        { questionId: "q_single", value: random() < 0.6 ? "o_a" : "o_b" },
        {
          questionId: "q_multiple",
          value: random() < 0.5 ? ["o_x"] : ["o_x", "o_y"],
        },
        { questionId: "q_number", value: Math.floor(random() * 101) },
        ...(reachesText
          ? [{ questionId: "q_text", value: `固定种子文本回答 ${index}` }]
          : []),
      ];
      return {
        surveyId,
        surveyVersionId: versionId,
        fillSessionId: new Types.ObjectId(),
        ownerKey: `${marker}:${index}`,
        questionPath: [
          "q_single",
          "q_multiple",
          "q_number",
          ...(reachesText ? ["q_text"] : []),
        ],
        ignoredQuestionIds: reachesText ? [] : ["q_text"],
        answers,
        submittedAt: new Date(start + index * 1_000),
      };
    });
    await SurveyResponseModel.insertMany(documents, { ordered: false });
  }
  const pipelines = buildStatisticsPipelines(
    versionId,
    ["q_single", "q_multiple"],
    ["q_number"],
  );
  const evidence: Record<string, unknown> = {
    parameters: {
      count,
      seed,
      surveyId: surveyId.toString(),
      versionId: versionId.toString(),
    },
  };
  for (const [name, pipeline] of Object.entries(pipelines)) {
    evidence[name] = compactExplain(
      await SurveyResponseModel.collection
        .aggregate(pipeline, { maxTimeMS: 60_000 })
        .explain("executionStats"),
    );
  }
  evidence.textResponses = compactExplain(
    await SurveyResponseModel.collection
      .aggregate(buildTextResponsePipeline(versionId, "q_text", 20), {
        hint: { surveyVersionId: 1, submittedAt: -1, _id: -1 },
        maxTimeMS: 60_000,
      })
      .explain("executionStats"),
  );
  console.info(JSON.stringify(evidence, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
