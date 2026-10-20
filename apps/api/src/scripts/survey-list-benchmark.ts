import mongoose, { Types } from "mongoose";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { SurveyModel } from "../models/survey.js";

const uri = process.env.SURVEY_LIST_BENCHMARK_URI;
if (process.env.NODE_ENV === "production")
  throw new Error("生产环境禁止运行问卷列表基准脚本");
if (!uri) throw new Error("缺少 SURVEY_LIST_BENCHMARK_URI");
assertLocalMongoUri(uri);
const databaseName = uri
  .slice(uri.indexOf("/", "mongodb://".length) + 1)
  .split("?")[0];
if (!databaseName?.endsWith("_benchmark"))
  throw new Error("问卷列表基准数据库名必须以 _benchmark 结尾");

const count = Number(process.env.SURVEY_LIST_BENCHMARK_COUNT ?? 10_000);
if (!Number.isInteger(count) || count < 100 || count > 50_000)
  throw new Error("SURVEY_LIST_BENCHMARK_COUNT 必须是 100 至 50000 的整数");

const marker = "survey-list-benchmark-v1:";
const ownerId = new Types.ObjectId("650000000000000000000001");
const expectedIndex = { ownerId: 1, updatedAt: -1, _id: -1 } as const;

function compactExplain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactExplain).filter(Boolean);
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const keys = [
    "stage",
    "indexName",
    "direction",
    "nReturned",
    "totalDocsExamined",
    "totalKeysExamined",
    "executionTimeMillis",
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

function benchmarkId(index: number): Types.ObjectId {
  return new Types.ObjectId(`66${index.toString(16).padStart(22, "0")}`);
}

async function explainList(filter: Record<string, unknown>): Promise<unknown> {
  return compactExplain(
    await SurveyModel.collection
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(21)
      .explain("executionStats"),
  );
}

async function main(): Promise<void> {
  await mongoose.connect(uri!);
  await SurveyModel.init();
  await SurveyModel.deleteMany({ internalName: { $regex: `^${marker}` } });
  if (process.argv.includes("--clean")) {
    console.info("问卷列表基准数据已清理");
    return;
  }

  const start = Date.UTC(2027, 0, 1);
  for (let offset = 0; offset < count; offset += 1_000) {
    const batchSize = Math.min(1_000, count - offset);
    const documents = Array.from({ length: batchSize }, (_, localIndex) => {
      const index = offset + localIndex;
      const updatedAt = new Date(start + Math.floor(index / 5) * 1_000);
      return {
        _id: benchmarkId(index),
        ownerId,
        publicId: `slb_${index.toString(36).padStart(8, "0")}`,
        internalName: `${marker}${index}`,
        manualStatus: "open",
        currentVersionId: null,
        draftVersionId: null,
        createdAt: updatedAt,
        updatedAt,
      };
    });
    await SurveyModel.collection.insertMany(documents, { ordered: false });
  }

  const cursorIndex = Math.floor(count / 2);
  const cursorUpdatedAt = new Date(start + Math.floor(cursorIndex / 5) * 1_000);
  const cursorId = benchmarkId(cursorIndex);
  const evidence = {
    parameters: {
      count,
      pageSizePlusOne: 21,
      ownerId: ownerId.toString(),
      cursorIndex,
    },
    expectedIndex,
    firstPage: await explainList({ ownerId }),
    cursorPage: await explainList({
      ownerId,
      $or: [
        { updatedAt: { $lt: cursorUpdatedAt } },
        { updatedAt: cursorUpdatedAt, _id: { $lt: cursorId } },
      ],
    }),
  };
  console.info(JSON.stringify(evidence, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
