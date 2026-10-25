import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import mongoose, { type Schema, type SchemaType } from "mongoose";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { UserModel } from "../models/user.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { FillSessionModel } from "../models/fill-session.js";
import { SurveyResponseModel } from "../models/response.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../models/library-question.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import { QuestionShareModel } from "../models/question-share.js";
import {
  QuestionBankModel,
  QuestionBankItemModel,
} from "../models/question-bank.js";
import { Stage2DemoModel } from "../models/stage2-demo.js";
const uri =
  "mongodb://127.0.0.1:27017/survey_stage2_report_test?replicaSet=rs0&directConnection=true";
assertLocalMongoUri(uri, true);
if (process.env.NODE_ENV === "production")
  throw Error("生产环境不运行报告事实核对");
const models = [
  UserModel,
  SurveyModel,
  SurveyVersionModel,
  FillSessionModel,
  SurveyResponseModel,
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
  QuestionUsageModel,
  QuestionShareModel,
  QuestionBankModel,
  QuestionBankItemModel,
  Stage2DemoModel,
];
function fields(schema: Schema): unknown {
  return Object.fromEntries(
    Object.entries(schema.paths).map(([name, field]) => {
      const embedded = (field as SchemaType & { schema?: Schema }).schema;
      return [
        name,
        {
          type: field.instance,
          ...(embedded ? { fields: fields(embedded) } : {}),
        },
      ];
    }),
  );
}
await mongoose.connect(uri);
try {
  assert.equal(
    mongoose.connection.db!.databaseName,
    "survey_stage2_report_test",
  );
  const collections = [];
  for (const model of models) {
    await model.init();
    const actual = await model.collection.listIndexes().toArray();
    const declared = model.schema
      .indexes()
      .map(([key, options]) => ({ key, ...options }));
    for (const index of declared)
      assert(
        actual.some(
          (a) =>
            JSON.stringify(a.key) === JSON.stringify(index.key) &&
            Boolean(a.unique) === Boolean(index.unique) &&
            JSON.stringify(a.partialFilterExpression) ===
              JSON.stringify(index.partialFilterExpression) &&
            a.expireAfterSeconds === index.expireAfterSeconds,
        ),
        `索引与声明不符: ${model.collection.name}`,
      );
    assert.equal(
      actual.length,
      declared.length + 1,
      `存在额外索引: ${model.collection.name}`,
    );
    collections.push({
      collection: model.collection.name,
      documentCount: await model.collection.countDocuments(),
      fields: fields(model.schema),
      declaredIndexes: declared,
      actualIndexes: actual,
    });
  }
  const result = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    mongodbVersion: (await mongoose.connection.db!.admin().buildInfo()).version,
    database: mongoose.connection.db!.databaseName,
    collectionCount: collections.length,
    businessCollectionCount: collections.length - 1,
    declaredIndexCount: collections.reduce(
      (n, c) => n + c.declaredIndexes.length,
      0,
    ),
    actualIndexCount: collections.reduce(
      (n, c) => n + c.actualIndexes.length,
      0,
    ),
    collections,
  };
  await writeFile(
    new URL(
      "../../../../docs/experiments/STAGE2_REPORT_FACTS.json",
      import.meta.url,
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      collectionCount: result.collectionCount,
      declaredIndexCount: result.declaredIndexCount,
      actualIndexCount: result.actualIndexCount,
      mongodbVersion: result.mongodbVersion,
      documents: collections.reduce((n, c) => n + c.documentCount, 0),
    }),
  );
} finally {
  await mongoose.disconnect();
}
