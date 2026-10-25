import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import mongoose, { Types } from "mongoose";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { SurveyResponseModel } from "../models/response.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import { LibraryStatisticsService } from "../library-statistics/service.js";
import { parseLibraryStatistics } from "../library-statistics/validation.js";
import {
  summaryPipeline,
  type StatisticsSource,
} from "../library-statistics/pipelines.js";
const uri =
  "mongodb://127.0.0.1:27017/survey_stage2_statistics_benchmark_test?replicaSet=rs0&directConnection=true";
assertLocalMongoUri(uri, true);
if (process.env.NODE_ENV === "production") throw Error("生产环境禁止实验");
const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, "0"));
await mongoose.connect(uri);
assert.equal(
  mongoose.connection.db!.databaseName,
  "survey_stage2_statistics_benchmark_test",
);
const models = [
  SurveyModel,
  SurveyVersionModel,
  SurveyResponseModel,
  QuestionUsageModel,
];
const clean = async () => {
  for (const model of models) await model.collection.deleteMany({});
};
try {
  await clean();
  for (const model of models) await model.init();
  const owner = id(1),
    libraryQuestionId = id(10).toString(),
    versionIds = [id(11).toString(), id(12).toString()];
  const definition = {
    type: "number" as const,
    title: "年龄",
    required: false,
    validation: { integerOnly: true, minValue: null, maxValue: null },
    options: [],
  };
  const sources: StatisticsSource[] = [],
    responses = [];
  for (let s = 0; s < 10; s++) {
    const surveyId = id(100 + s),
      user = s < 5 ? owner : id(2);
    await SurveyModel.create({
      _id: surveyId,
      ownerId: user,
      publicId: `benchmark-${s}`,
      internalName: "实验问卷",
      manualStatus: "open",
    });
    for (let v = 0; v < 2; v++) {
      const surveyVersionId = id(1000 + s * 2 + v),
        qv = versionIds[v]!;
      const questions = [0, 1].map((q) => ({
        ...definition,
        questionId: `q_${q}`,
        jumpRules: [],
        source: {
          libraryQuestionId,
          questionVersionId: qv,
          contentRevision: 1,
          versionNumber: v + 1,
          optionSources: [],
        },
      }));
      await SurveyVersionModel.create({
        _id: surveyVersionId,
        surveyId,
        versionNumber: v + 1,
        status: "published",
        revision: 1,
        title: "实验",
        description: "",
        identityMode: "anonymous",
        allowMultipleSubmissions: true,
        sessionDurationMinutes: 30,
        schemaVersion: 2,
        questions,
        publishedAt: new Date(),
      });
      for (const question of questions) {
        await QuestionUsageModel.create({
          ownerId: user,
          surveyId,
          surveyVersionId,
          questionId: question.questionId,
          libraryQuestionId,
          questionVersionId: qv,
          status: "published",
        });
        if (s < 5)
          sources.push({
            surveyId: surveyId.toString(),
            surveyVersionId: surveyVersionId.toString(),
            questionId: question.questionId,
            questionVersionId: qv,
            versionNumber: v + 1,
            definition,
            optionSources: [],
          });
      }
      for (let r = 0; r < 100; r++)
        responses.push({
          surveyId,
          surveyVersionId,
          fillSessionId: new Types.ObjectId(),
          ownerKey: "anon:benchmark",
          questionPath: questions.map((q) => q.questionId),
          ignoredQuestionIds: [],
          answers: questions.map((q) => ({
            questionId: q.questionId,
            value: r,
          })),
          submittedAt: new Date("2026-10-22T00:00:00.000Z"),
        });
    }
  }
  for (let i = 0; i < 5000; i++)
    responses.push({
      surveyId: id(9000),
      surveyVersionId: id(9001),
      fillSessionId: new Types.ObjectId(),
      ownerKey: "anon:noise",
      questionPath: ["q_other"],
      ignoredQuestionIds: [],
      answers: [{ questionId: "q_other", value: i }],
      submittedAt: new Date("2026-10-22T00:00:00.000Z"),
    });
  await SurveyResponseModel.insertMany(responses);
  const service = new LibraryStatisticsService(
    "benchmark-secret-do-not-use-for-authentication",
    10000,
  );
  const result = await service.query(
    owner,
    libraryQuestionId,
    parseLibraryStatistics({
      questionVersionIds: versionIds,
      merge: true,
      confirmMerge: true,
    }),
  );
  assert.equal(result.groups[0]!.number!.count, 2000);
  assert.equal(result.groups[0]!.number!.sum, 99000);
  const responsePlan = await SurveyResponseModel.aggregate(
    summaryPipeline(sources, true, "number", [0, 18, 30, 45, 60, 120]),
  )
    .hint({ surveyVersionId: 1, submittedAt: -1, _id: -1 })
    .explain("executionStats");
  const sourcePlan = await QuestionUsageModel.find({
    ownerId: owner,
    libraryQuestionId,
    status: "published",
  })
    .hint({
      libraryQuestionId: 1,
      ownerId: 1,
      status: 1,
      surveyVersionId: 1,
      questionId: 1,
    })
    .limit(1001)
    .explain("executionStats");
  const output = {
    generatedAt: new Date().toISOString(),
    mongodbVersion: (await mongoose.connection.db!.admin().buildInfo()).version,
    database: mongoose.connection.db!.databaseName,
    fixture: {
      surveys: 10,
      publishedSurveyVersions: 20,
      allSources: 40,
      ownSources: 20,
      responses: 7000,
      ownedResponseDocuments: 1000,
      expectedAnswerInstances: 2000,
      expectedNumberSum: 99000,
    },
    actual: result.groups[0],
    sourcePlan,
    responsePlan,
  };
  const path = new URL(
    "../../../../docs/experiments/STAGE2_STATISTICS_EXPLAIN.json",
    import.meta.url,
  );
  await writeFile(path, JSON.stringify(output, null, 2) + "\n");
  console.log(
    JSON.stringify({
      saved: path.pathname,
      fixture: output.fixture,
      actual: {
        count: result.groups[0]!.number!.count,
        sum: result.groups[0]!.number!.sum,
      },
    }),
  );
} finally {
  await clean();
  await mongoose.disconnect();
}
