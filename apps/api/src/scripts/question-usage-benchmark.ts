import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import mongoose, { Types, type PipelineStage } from "mongoose";
import { assertLocalMongoUri } from "../database/local-safety.js";
const uri =
  "mongodb://127.0.0.1:27017/survey_stage2_d8_test?replicaSet=rs0&directConnection=true";
assertLocalMongoUri(uri, true);
if (process.env.NODE_ENV === "production")
  throw new Error("生产环境不允许执行实验");
const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, "0"));
await mongoose.connect(uri);
const db = mongoose.connection.db!;
const surveys = db.collection("d8_surveys"),
  versions = db.collection("d8_versions"),
  usages = db.collection("d8_usages");
try {
  for (const c of [surveys, versions, usages]) await c.deleteMany({});
  const ss = [],
    vv = [],
    uu = [];
  for (let s = 0; s < 2000; s++) {
    const surveyId = id(10000 + s),
      ownerId = id(1 + (s % 20));
    ss.push({ _id: surveyId, ownerId });
    for (let v = 1; v <= 3; v++) {
      const surveyVersionId = id(100000 + s * 3 + v),
        status = v === 3 ? "draft" : "published",
        questions = [];
      for (let q = 0; q < 5; q++) {
        const libraryQuestionId = id(5000 + ((s + (q % 4)) % 40)),
          questionVersionId = id(6000 + ((s + (q % 4)) % 40) * 3 + v),
          questionId = `q_${q}`;
        questions.push({
          questionId,
          title: `Question ${q}`,
          source: { libraryQuestionId, questionVersionId },
          options: [
            { optionId: "o_a", text: "A" },
            { optionId: "o_b", text: "B" },
          ],
        });
        uu.push({
          ownerId,
          surveyId,
          surveyVersionId,
          questionId,
          libraryQuestionId,
          questionVersionId,
          status,
        });
      }
      vv.push({ _id: surveyVersionId, surveyId, status, questions });
    }
  }
  await surveys.insertMany(ss);
  await versions.insertMany(vv);
  await usages.insertMany(uu);
  await versions.createIndex({ "questions.source.libraryQuestionId": 1 });
  await versions.createIndex({ "questions.source.questionVersionId": 1 });
  await usages.createIndex({
    libraryQuestionId: 1,
    ownerId: 1,
    status: 1,
    surveyVersionId: 1,
    questionId: 1,
  });
  await usages.createIndex({ questionVersionId: 1, ownerId: 1, status: 1 });
  await usages.createIndex(
    { surveyVersionId: 1, questionId: 1 },
    { unique: true },
  );
  const target = id(5000),
    owner = id(1);
  const a: PipelineStage[] = [
    { $match: { "questions.source.libraryQuestionId": target } },
    { $unwind: "$questions" },
    { $match: { "questions.source.libraryQuestionId": target } },
    {
      $lookup: {
        from: "d8_surveys",
        localField: "surveyId",
        foreignField: "_id",
        as: "survey",
      },
    },
    { $unwind: "$survey" },
    {
      $project: {
        _id: 0,
        ownerId: "$survey.ownerId",
        surveyId: 1,
        surveyVersionId: "$_id",
        questionId: "$questions.questionId",
        questionVersionId: "$questions.source.questionVersionId",
        status: 1,
      },
    },
  ];
  const b: PipelineStage[] = [
    { $match: { libraryQuestionId: target } },
    {
      $project: {
        _id: 0,
        ownerId: 1,
        surveyId: 1,
        surveyVersionId: 1,
        questionId: 1,
        questionVersionId: 1,
        status: 1,
      },
    },
  ];
  const cases: Record<string, PipelineStage[]> = {
    ownDetails: [
      { $match: { ownerId: owner } },
      { $sort: { surveyVersionId: 1, questionId: 1 } },
      { $limit: 20 },
    ],
    othersSummary: [
      { $match: { ownerId: { $ne: owner } } },
      {
        $group: {
          _id: {
            ownerId: "$ownerId",
            questionVersionId: "$questionVersionId",
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          "_id.ownerId": 1,
          "_id.questionVersionId": 1,
          "_id.status": 1,
        },
      },
    ],
    statisticsSources: [
      { $match: { ownerId: owner, status: "published" } },
      { $sort: { surveyVersionId: 1, questionId: 1 } },
    ],
  };
  const results = [];
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object" && !(value instanceof Types.ObjectId)
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
  for (const [name, suffix] of Object.entries(cases)) {
    let expected: unknown;
    for (const [scheme, collection, base] of [
      ["A", versions, a],
      ["B", usages, b],
    ] as const) {
      const pipeline = [...base, ...suffix];
      const rows = await collection.aggregate(pipeline).toArray();
      if (expected) assert.deepEqual(stable(rows), expected, name);
      else expected = stable(rows);
      const explain = await collection
        .aggregate(pipeline)
        .explain("executionStats");
      results.push({ name, scheme, rows: rows.length, explain });
    }
  }
  await writeFile(
    new URL(
      "../../../../docs/experiments/STAGE2_D8_RESULTS.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        date: "2026-10-22",
        mongoVersion: (await db.admin().command({ buildInfo: 1 })).version,
        dataset: {
          surveys: ss.length,
          versions: vv.length,
          usages: uu.length,
          owners: 20,
          identities: 40,
          seed: "fixed modular s/v/q formulas",
        },
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      matchedAllCases: true,
      results: results.map(({ name, scheme, rows }) => ({
        name,
        scheme,
        rows,
      })),
    }),
  );
} finally {
  for (const c of [surveys, versions, usages])
    await c.drop().catch((e: { code?: number }) => {
      if (e.code !== 26) throw e;
    });
  await mongoose.disconnect();
}
