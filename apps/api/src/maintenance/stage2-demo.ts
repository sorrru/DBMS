import mongoose, { Types } from "mongoose";
import type { LibraryVersionView } from "@survey/survey-logic";
import type { AppEnv } from "../config/env.js";
import { validateCredentials } from "../auth/validation.js";
import { PasswordService } from "../security/password.js";
import { UserModel } from "../models/user.js";
import { Stage2DemoModel } from "../models/stage2-demo.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../models/library-question.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { SurveyResponseModel } from "../models/response.js";
import { FillSessionModel } from "../models/fill-session.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import { QuestionShareModel } from "../models/question-share.js";
import {
  QuestionBankModel,
  QuestionBankItemModel,
} from "../models/question-bank.js";
import { LibraryService } from "../library/service.js";
import { LibraryCursor } from "../library/cursor.js";
import { LibrarySharingService } from "../library/sharing.js";
import { BankService } from "../banks/service.js";
import { SurveyService } from "../surveys/service.js";
import { SurveyCursorService } from "../surveys/cursor.js";
import { FillService } from "../fills/service.js";
import { parseSubmissionBody } from "../fills/submission-validation.js";
import { LibraryStatisticsService } from "../library-statistics/service.js";
import { parseLibraryStatistics } from "../library-statistics/validation.js";
export const demoNames = [
  "stage2_teacher",
  "stage2_student",
  "stage2_outsider",
] as const;
const manifestId = "stage2-m6-v1";
export class Stage2Demo {
  private library: LibraryService;
  private sharing: LibrarySharingService;
  private banks: BankService;
  private surveys: SurveyService;
  private fills: FillService;
  constructor(
    private env: AppEnv,
    private passwords = new PasswordService(),
  ) {
    const cursor = new LibraryCursor(env.jwtSecret);
    this.library = new LibraryService(cursor);
    this.sharing = new LibrarySharingService(cursor);
    this.banks = new BankService(cursor);
    this.surveys = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
    );
    this.fills = new FillService(env);
  }
  async clean() {
    return mongoose.connection.transaction(async (session) => {
      const manifest = await Stage2DemoModel.findById(manifestId)
        .session(session)
        .lean();
      if (!manifest) return { removed: false };
      const users = manifest.userIds;
      const surveyIds = await SurveyModel.find({ ownerId: { $in: users } })
        .session(session)
        .distinct("_id");
      const questionIds = await LibraryQuestionModel.find({
        ownerId: { $in: users },
      })
        .session(session)
        .distinct("_id");
      const bankIds = await QuestionBankModel.find({ ownerId: { $in: users } })
        .session(session)
        .distinct("_id");
      const external = [
        await QuestionUsageModel.exists({
          libraryQuestionId: { $in: questionIds },
          ownerId: { $nin: users },
        }).session(session),
        await LibraryQuestionModel.exists({
          ownerId: { $nin: users },
          "copiedFrom.libraryQuestionId": { $in: questionIds },
        }).session(session),
        await SurveyVersionModel.exists({
          surveyId: { $nin: surveyIds },
          "questions.source.libraryQuestionId": {
            $in: questionIds.map(String),
          },
        }).session(session),
        await QuestionShareModel.exists({
          libraryQuestionId: { $in: questionIds },
          recipientId: { $nin: users },
        }).session(session),
        await QuestionBankItemModel.exists({
          libraryQuestionId: { $in: questionIds },
          bankId: { $nin: bankIds },
        }).session(session),
      ];
      if (external.some(Boolean))
        throw Error(
          "非演示账号已使用、复制、分类或获授权演示题目；拒绝清理，保留全部数据",
        );
      // Delete only these manifest-owned accounts' resources, in one transaction.
      await SurveyResponseModel.deleteMany(
        { surveyId: { $in: surveyIds } },
        { session },
      );
      await FillSessionModel.deleteMany(
        { surveyId: { $in: surveyIds } },
        { session },
      );
      await QuestionUsageModel.deleteMany(
        { surveyId: { $in: surveyIds } },
        { session },
      );
      await SurveyVersionModel.deleteMany(
        { surveyId: { $in: surveyIds } },
        { session },
      );
      await SurveyModel.deleteMany({ _id: { $in: surveyIds } }, { session });
      await QuestionBankItemModel.deleteMany(
        { bankId: { $in: bankIds } },
        { session },
      );
      await QuestionBankModel.deleteMany(
        { _id: { $in: bankIds } },
        { session },
      );
      await QuestionShareModel.deleteMany(
        {
          $or: [
            { libraryQuestionId: { $in: questionIds } },
            { recipientId: { $in: users } },
          ],
        },
        { session },
      );
      await LibraryOptionKeyModel.deleteMany(
        { libraryQuestionId: { $in: questionIds } },
        { session },
      );
      await LibraryVersionModel.deleteMany(
        { libraryQuestionId: { $in: questionIds } },
        { session },
      );
      await LibraryQuestionModel.deleteMany(
        { _id: { $in: questionIds } },
        { session },
      );
      await UserModel.deleteMany({ _id: { $in: users } }, { session });
      await Stage2DemoModel.deleteOne({ _id: manifestId }, { session });
      return {
        removed: true,
        users: users.length,
        surveys: surveyIds.length,
        questions: questionIds.length,
        banks: bankIds.length,
      };
    });
  }
  async create(password?: string) {
    const existing = await Stage2DemoModel.findById(manifestId).lean();
    if (existing) {
      if (existing.state !== "ready")
        throw Error(
          "上次演示生成未完成；请检查后使用显式 reset，默认不会删除数据",
        );
      return { created: false, ...(await this.verify()) };
    }
    if (!password)
      throw Error("首次生成需要 SEED_USER_PASSWORD；不提供内置密码");
    const inputs = demoNames.map((username) =>
      validateCredentials({ username, password }, this.passwords, true),
    );
    const hashes = await Promise.all(
      inputs.map((i) => this.passwords.hash(i.password)),
    );
    await Promise.all([
      UserModel.init(),
      Stage2DemoModel.init(),
      this.library.ensureIndexes(),
      this.banks.ensureIndexes(),
      this.surveys.ensureIndexes(),
      SurveyResponseModel.init(),
      FillSessionModel.init(),
    ]);
    const ids = demoNames.map(() => new Types.ObjectId());
    await mongoose.connection.transaction(async (session) => {
      if (
        await UserModel.exists({
          usernameNormalized: { $in: [...demoNames] },
        }).session(session)
      )
        throw Error("演示用户名已被占用且不属于 manifest，拒绝覆盖账号");
      await Stage2DemoModel.create(
        [{ _id: manifestId, userIds: ids, state: "building" }],
        { session },
      );
      await UserModel.create(
        inputs.map((i, n) => ({
          _id: ids[n],
          username: i.username,
          usernameNormalized: i.usernameNormalized,
          passwordHash: hashes[n],
          registeredAt: new Date(),
        })),
        { session, ordered: true },
      );
    });
    const teacher = ids[0]!,
      student = ids[1]!,
      outsider = ids[2]!;
    const age = await this.library.create(teacher, {
      type: "number",
      title: "演示：年龄",
      required: true,
      validation: { integerOnly: true, minValue: 0, maxValue: 120 },
      options: [],
    });
    const single = await this.library.create(teacher, {
      type: "single",
      title: "演示：学习方式",
      required: true,
      validation: {},
      options: [{ text: "课堂" }, { text: "自学" }],
    });
    const multi = await this.library.create(teacher, {
      type: "multiple",
      title: "演示：兴趣",
      required: false,
      validation: { minSelections: 1, maxSelections: 2 },
      options: [{ text: "数据库" }, { text: "编程" }, { text: "设计" }],
    });
    const text = await this.library.create(teacher, {
      type: "text",
      title: "演示：建议",
      required: false,
      validation: { minLength: 0, maxLength: 200 },
      options: [],
    });
    const a = await this.survey(teacher, "阶段二：学生基本信息 A", [
      age.version,
      single.version,
      multi.version,
      text.version,
    ]);
    await this.answer(student, a, 18, "希望增加实验", 0);
    await this.answer(outsider, a, 30, "课程内容清楚", 1);
    const age2 = await this.library.branch(
      teacher,
      age.question.libraryQuestionId,
      age.version.questionVersionId,
      1,
      {
        ...age.version.definition,
        title: "演示：周岁年龄",
        validation: { integerOnly: true, minValue: 0, maxValue: 130 },
      },
    );
    const b = await this.survey(teacher, "阶段二：学生基本信息 B", [
      age2.version,
      single.version,
      multi.version,
      text.version,
    ]);
    await this.answer(student, b, 60, "希望提供更多例子", 0);
    await this.sharing.grant(teacher, age.question.libraryQuestionId, {
      usernames: [demoNames[1]],
      questionVersionIds: [age.version.questionVersionId],
    });
    const c = await this.survey(student, "阶段二：接收者独立问卷", [
      age.version,
    ]);
    await this.answer(outsider, c, 88, "", 0);
    await this.library.copy(
      student,
      age.question.libraryQuestionId,
      age.version.questionVersionId,
      1,
    );
    await this.survey(
      teacher,
      "阶段二：重复实例草稿",
      [age.version, age.version],
      false,
    );
    const next = await this.surveys.createNextVersion(
      student,
      c.id,
      c.currentVersion!.id,
    );
    await this.sharing.grant(teacher, text.question.libraryQuestionId, {
      usernames: [demoNames[1]],
      questionVersionIds: [text.version.questionVersionId],
    });
    await this.surveys.addLibraryQuestion(student, c.id, next.version.id, {
      revision: next.version.revision,
      libraryQuestionId: text.question.libraryQuestionId,
      questionVersionId: text.version.questionVersionId,
      contentRevision: 1,
    });
    const mainBank = await this.banks.create(teacher, "阶段二：跟随最新"),
      pinned = await this.banks.create(teacher, "阶段二：固定历史"),
      shared = await this.banks.create(student, "阶段二：共享分类");
    for (const q of [age, single, multi, text])
      await this.banks.putMember(teacher, mainBank.bankId, {
        libraryQuestionId: q.question.libraryQuestionId,
        versionPolicy: "latest",
        questionVersionId: null,
      });
    await this.banks.putMember(teacher, pinned.bankId, {
      libraryQuestionId: age.question.libraryQuestionId,
      versionPolicy: "pinned",
      questionVersionId: age.version.questionVersionId,
    });
    for (const q of [age, text])
      await this.banks.putMember(student, shared.bankId, {
        libraryQuestionId: q.question.libraryQuestionId,
        versionPolicy: "pinned",
        questionVersionId: q.version.questionVersionId,
      });
    const grant = (
      await this.sharing.listGrants(
        teacher,
        text.question.libraryQuestionId,
        20,
      )
    ).items[0]!;
    await this.sharing.revoke(
      teacher,
      text.question.libraryQuestionId,
      grant.shareId,
    );
    await this.library.restore(teacher, age.question.libraryQuestionId, {
      restoredFromVersionId: age.version.questionVersionId,
      sourceContentRevision: 1,
      baseVersionId: age2.version.questionVersionId,
      baseContentRevision: 1,
    });
    await Stage2DemoModel.updateOne(
      { _id: manifestId },
      { $set: { state: "ready" } },
    );
    return { created: true, ...(await this.verify()) };
  }
  private async survey(
    user: Types.ObjectId,
    name: string,
    versions: LibraryVersionView[],
    publish = true,
  ) {
    const s = await this.surveys.create(user, name);
    let revision = 1;
    for (const v of versions) {
      const r = await this.surveys.addLibraryQuestion(
        user,
        s.id,
        s.draftVersion!.id,
        {
          revision,
          libraryQuestionId: v.libraryQuestionId,
          questionVersionId: v.questionVersionId,
          contentRevision: v.contentRevision,
        },
      );
      revision = r.version.revision;
    }
    if (publish)
      await this.surveys.publish(
        user,
        s.id,
        s.draftVersion!.id,
        revision,
        true,
      );
    return this.surveys.get(user, s.id);
  }
  private async answer(
    user: Types.ObjectId,
    survey: Awaited<ReturnType<SurveyService["get"]>>,
    age: number,
    text: string,
    option: number,
  ) {
    const started = await this.fills.create(user, survey.publicId);
    const version = await SurveyVersionModel.findById(
      survey.currentVersion!.id,
    ).lean();
    const answers = version!.questions.map((q) => ({
      questionId: q.questionId,
      value:
        q.type === "number"
          ? age
          : q.type === "text"
            ? text
            : q.type === "single"
              ? q.options[option]!.optionId
              : [q.options[0]!.optionId],
    }));
    await this.fills.submit(
      user,
      started.body.session.id,
      started.token,
      parseSubmissionBody({ answers }),
    );
  }
  async verify() {
    const manifest = await Stage2DemoModel.findById(manifestId).lean();
    if (!manifest || manifest.state !== "ready") throw Error("演示未准备完成");
    const teacher = manifest.userIds[0]!,
      student = manifest.userIds[1]!;
    const age = await LibraryQuestionModel.findOne({
      ownerId: teacher,
      type: "number",
    }).lean();
    if (!age) throw Error("演示年龄题缺失");
    const stats = new LibraryStatisticsService(
        this.env.jwtSecret,
        this.env.statisticsMaxTimeMs,
      ),
      catalog = await stats.catalog(teacher, age._id.toString());
    const result = await stats.query(
      teacher,
      age._id.toString(),
      parseLibraryStatistics({
        questionVersionIds: catalog.versions.map((v) => v.questionVersionId),
        merge: true,
        confirmMerge: true,
      }),
    );
    const recipient = await stats.query(
      student,
      age._id.toString(),
      parseLibraryStatistics({
        questionVersionIds: [
          catalog.versions.find((v) => v.versionNumber === 1)!
            .questionVersionId,
        ],
      }),
    );
    const counts = {
      users: await UserModel.countDocuments({ _id: { $in: manifest.userIds } }),
      surveys: await SurveyModel.countDocuments({
        ownerId: { $in: manifest.userIds },
      }),
      questions: await LibraryQuestionModel.countDocuments({
        ownerId: { $in: manifest.userIds },
      }),
      banks: await QuestionBankModel.countDocuments({
        ownerId: { $in: manifest.userIds },
      }),
    };
    return {
      accounts: [...demoNames],
      counts,
      teacherAge: result.groups[0]!.number,
      studentAge: recipient.groups[0]!.number,
    };
  }
}
