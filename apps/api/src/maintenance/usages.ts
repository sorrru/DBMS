import { createHash } from "node:crypto";
import mongoose, { Types, type ClientSession } from "mongoose";
import {
  QuestionUsageModel,
  type QuestionUsage,
} from "../models/question-usage.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { LibraryVersionModel } from "../models/library-question.js";
import { questionUsageRecords } from "../library/usages.js";
const key = (r: QuestionUsage) => `${r.surveyVersionId}:${r.questionId}`;
const plain = (r: QuestionUsage) => ({
  ownerId: r.ownerId.toString(),
  surveyId: r.surveyId.toString(),
  surveyVersionId: r.surveyVersionId.toString(),
  questionId: r.questionId,
  libraryQuestionId: r.libraryQuestionId.toString(),
  questionVersionId: r.questionVersionId.toString(),
  status: r.status,
});
const canonical = (r: QuestionUsage) => JSON.stringify(plain(r));
export class UsageMaintenance {
  constructor(
    private hooks: {
      beforeWrite?: () => void | Promise<void>;
      afterWrite?: () => void | Promise<void>;
    } = {},
  ) {}
  private async plan(
    ownerId: string,
    surveyId: string,
    session: ClientSession,
  ) {
    const survey = await SurveyModel.findOne({ _id: surveyId, ownerId })
      .session(session)
      .lean();
    if (!survey) throw Error("问卷不存在或 ownerId 不匹配；未作任何修复");
    const versions = await SurveyVersionModel.find({ surveyId })
      .sort({ _id: 1 })
      .session(session)
      .lean();
    const expected: QuestionUsage[] = [],
      blockers: string[] = [];
    for (const v of versions) {
      if (
        v.questions.some(
          (q) =>
            q.source &&
            (!/^[a-f\d]{24}$/.test(q.source.libraryQuestionId) ||
              !/^[a-f\d]{24}$/.test(q.source.questionVersionId)),
        )
      ) {
        blockers.push(`${v._id}:invalid-source-id`);
        continue;
      }
      expected.push(
        ...questionUsageRecords(
          {
            ownerId: survey.ownerId,
            surveyId,
            versionId: v._id.toString(),
            status: v.status,
          },
          v.questions,
        ),
      );
      if (
        new Set(v.questions.map((q) => q.questionId)).size !==
        v.questions.length
      )
        blockers.push(`${v._id}:duplicate-instance-id`);
    }
    const referenced = [
      ...new Set(expected.map((r) => r.questionVersionId.toString())),
    ];
    const libraryVersions = await LibraryVersionModel.find({
      _id: { $in: referenced },
    })
      .session(session)
      .lean();
    for (const v of versions)
      for (const q of v.questions)
        if (q.source) {
          const source = q.source,
            lib = libraryVersions.find(
              (l) =>
                l._id.toString() === source.questionVersionId &&
                l.libraryQuestionId.toString() === source.libraryQuestionId,
            );
          if (!lib) {
            blockers.push(`${v._id}:${q.questionId}:missing-library-version`);
            continue;
          }
          if (
            !lib.frozenAt ||
            lib.contentRevision !== source.contentRevision ||
            lib.versionNumber !== source.versionNumber
          )
            blockers.push(`${v._id}:${q.questionId}:unstable-library-version`);
          const map = new Map(
            source.optionSources.map((o) => [o.optionId, o.sourceOptionId]),
          );
          const definition = {
            type: q.type,
            title: q.title,
            required: q.required,
            validation: q.validation,
            options: q.options.map((o) => ({
              optionId: map.get(o.optionId),
              text: o.text,
            })),
          };
          if (JSON.stringify(definition) !== JSON.stringify(lib.definition))
            blockers.push(`${v._id}:${q.questionId}:definition-mismatch`);
        }
    const actual = await QuestionUsageModel.find({
      $or: [
        { surveyId },
        { surveyVersionId: { $in: versions.map((v) => v._id) } },
      ],
    })
      .session(session)
      .lean();
    const expectedMap = new Map(expected.map((r) => [key(r), r])),
      actualMap = new Map(actual.map((r) => [key(r), r]));
    const missing = expected.filter((r) => !actualMap.has(key(r))),
      extra = actual.filter((r) => !expectedMap.has(key(r))),
      changed = expected.filter(
        (r) =>
          actualMap.has(key(r)) &&
          canonical(r) !== canonical(actualMap.get(key(r))!),
      );
    const planHash = createHash("sha256")
      .update(
        JSON.stringify({
          ownerId,
          surveyId,
          expected: expected.map(canonical).sort(),
          actual: actual.map(canonical).sort(),
          blockers: [...blockers].sort(),
          versions: versions.map((v) => [
            v._id.toString(),
            v.revision,
            v.status,
          ]),
        }),
      )
      .digest("hex");
    return {
      survey,
      expected,
      actual,
      report: {
        ownerId,
        surveyId,
        planHash,
        versionCount: versions.length,
        expectedCount: expected.length,
        actualCount: actual.length,
        missing: missing.length,
        extra: extra.length,
        changed: changed.length,
        blockers,
        clean:
          !missing.length &&
          !extra.length &&
          !changed.length &&
          !blockers.length,
      },
    };
  }
  async check(ownerId: string, surveyId: string) {
    return mongoose.connection.transaction(
      async (session) => (await this.plan(ownerId, surveyId, session)).report,
      { readConcern: { level: "snapshot" } },
    );
  }
  async repair(ownerId: string, surveyId: string, planHash: string) {
    if (!/^[a-f\d]{64}$/.test(planHash))
      throw Error("必须提供检查生成的完整 planHash");
    return mongoose.connection.transaction(
      async (session) => {
        const plan = await this.plan(ownerId, surveyId, session);
        if (plan.report.planHash !== planHash)
          throw Error("检查结果已过期，请重新检查；未作修复");
        if (plan.report.blockers.length)
          throw Error("快照或来源版本存在异常，不能自动修复使用投影");
        if (plan.report.clean) return { ...plan.report, repaired: false };
        await this.hooks.beforeWrite?.();
        // All survey definition writes also touch this parent. Contend before replacing its projection.
        await SurveyModel.updateOne(
          { _id: surveyId, ownerId },
          {
            $set: {
              updatedAt: new Date(
                Math.max(Date.now(), plan.survey.updatedAt.getTime() + 1),
              ),
            },
          },
          { session, timestamps: false },
        );
        await QuestionUsageModel.deleteMany(
          { _id: { $in: plan.actual.map((r) => r._id) } },
          { session },
        );
        if (plan.expected.length)
          await QuestionUsageModel.insertMany(plan.expected, { session });
        await this.hooks.afterWrite?.();
        return { ...plan.report, repaired: true };
      },
      { readConcern: { level: "snapshot" } },
    );
  }
}
