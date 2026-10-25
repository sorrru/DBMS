import mongoose, { Types } from "mongoose";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
} from "../models/library-question.js";
import { QuestionShareModel } from "../models/question-share.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { UserModel } from "../models/user.js";
import { libraryAccess, libraryMissing } from "./access.js";
import { LibraryCursor } from "./cursor.js";
export class LibrarySharingService {
  constructor(private cursors: LibraryCursor) {}
  private async owned(userId: Types.ObjectId, id: string) {
    if (!(await LibraryQuestionModel.exists({ _id: id, ownerId: userId })))
      throw libraryMissing();
  }
  async grant(
    userId: Types.ObjectId,
    id: string,
    input: { usernames: string[]; questionVersionIds: string[] },
  ) {
    await QuestionShareModel.init();
    await mongoose.connection.transaction(async (session) => {
      const identity = await LibraryQuestionModel.findOne({
        _id: id,
        ownerId: userId,
      })
        .session(session)
        .lean();
      if (!identity) throw libraryMissing();
      const versions = await LibraryVersionModel.countDocuments({
        _id: { $in: input.questionVersionIds },
        libraryQuestionId: id,
      }).session(session);
      if (versions !== input.questionVersionIds.length) throw libraryMissing();
      // Serialize grant administration; recipient read/use still contends on individual grant rows.
      await LibraryQuestionModel.updateOne(
        { _id: id, ownerId: userId },
        { $inc: { revision: 1 } },
        { session },
      );
      const users = await UserModel.find({
        usernameNormalized: { $in: input.usernames },
        _id: { $ne: userId },
      })
        .select({ _id: 1 })
        .session(session)
        .lean();
      const operations = users.flatMap((user) =>
        input.questionVersionIds.map((version) => ({
          updateOne: {
            filter: {
              questionVersionId: new Types.ObjectId(version),
              recipientId: user._id,
            },
            update: {
              $setOnInsert: {
                libraryQuestionId: new Types.ObjectId(id),
                questionVersionId: new Types.ObjectId(version),
                recipientId: user._id,
                accessRevision: 0,
                createdAt: new Date(),
              },
            },
            upsert: true,
          },
        })),
      );
      if (operations.length)
        await QuestionShareModel.bulkWrite(operations, { session });
    });
    return { accepted: true };
  }
  async listGrants(
    userId: Types.ObjectId,
    id: string,
    limit: number,
    cursor?: string,
  ) {
    await this.owned(userId, id);
    const scope = `shares:${id}`,
      after = cursor
        ? this.cursors.decode(cursor, userId.toString(), scope)
        : undefined;
    const rows = await QuestionShareModel.find({
        libraryQuestionId: id,
        ...(after ? { _id: { $lt: after } } : {}),
      })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean(),
      page = rows.slice(0, limit);
    const [users, versions] = await Promise.all([
      UserModel.find({ _id: { $in: page.map((g) => g.recipientId) } })
        .select({ username: 1 })
        .lean(),
      LibraryVersionModel.find({
        _id: { $in: page.map((g) => g.questionVersionId) },
      })
        .select({ versionNumber: 1 })
        .lean(),
    ]);
    const names = new Map(users.map((u) => [u._id.toString(), u.username])),
      numbers = new Map(
        versions.map((v) => [v._id.toString(), v.versionNumber]),
      );
    return {
      items: page.map((g) => ({
        shareId: g._id.toString(),
        username: names.get(g.recipientId.toString()) ?? "已删除用户",
        versionNumber: numbers.get(g.questionVersionId.toString()) ?? null,
      })),
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(
              userId.toString(),
              scope,
              page.at(-1)!._id.toString(),
            )
          : null,
    };
  }
  async revoke(userId: Types.ObjectId, id: string, shareId: string) {
    await mongoose.connection.transaction(async (session) => {
      if (
        !(await LibraryQuestionModel.exists({
          _id: id,
          ownerId: userId,
        }).session(session))
      )
        throw libraryMissing();
      await LibraryQuestionModel.updateOne(
        { _id: id, ownerId: userId },
        { $inc: { revision: 1 } },
        { session },
      );
      await QuestionShareModel.deleteOne(
        { _id: shareId, libraryQuestionId: id },
        { session },
      );
    });
  }
  async ownUsages(
    userId: Types.ObjectId,
    id: string,
    limit: number,
    cursor?: string,
  ) {
    await libraryAccess(userId, id);
    const scope = `usages:${id}`,
      after = cursor
        ? this.cursors.decode(cursor, userId.toString(), scope)
        : undefined;
    const rows = await QuestionUsageModel.find({
        libraryQuestionId: id,
        ownerId: userId,
        ...(after ? { _id: { $lt: after } } : {}),
      })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean(),
      page = rows.slice(0, limit);
    const surveys = await SurveyModel.find({
        _id: { $in: page.map((r) => r.surveyId) },
        ownerId: userId,
      })
        .select({ internalName: 1 })
        .lean(),
      allowed = new Map(surveys.map((s) => [s._id.toString(), s.internalName]));
    const versions = await SurveyVersionModel.find({
        _id: { $in: page.map((r) => r.surveyVersionId) },
        surveyId: { $in: surveys.map((s) => s._id) },
      }).lean(),
      byId = new Map(versions.map((v) => [v._id.toString(), v]));
    return {
      items: page.flatMap((r) => {
        const v = byId.get(r.surveyVersionId.toString()),
          q = v?.questions.find((q) => q.questionId === r.questionId);
        if (
          !v ||
          !q?.source ||
          q.source.libraryQuestionId !== id ||
          q.source.questionVersionId !== r.questionVersionId.toString()
        )
          return [];
        return [
          {
            surveyId: r.surveyId.toString(),
            surveyVersionId: r.surveyVersionId.toString(),
            questionId: r.questionId,
            internalName: allowed.get(r.surveyId.toString())!,
            surveyVersionNumber: v.versionNumber,
            questionVersionNumber: q.source.versionNumber,
            status: v.status,
          },
        ];
      }),
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(
              userId.toString(),
              scope,
              page.at(-1)!._id.toString(),
            )
          : null,
    };
  }
  async otherUsages(
    userId: Types.ObjectId,
    id: string,
    limit: number,
    cursor?: string,
  ) {
    await this.owned(userId, id);
    const scope = `others:${id}`,
      after = cursor
        ? this.cursors.decode(cursor, userId.toString(), scope)
        : undefined;
    const rows = await QuestionUsageModel.aggregate<{
      _id: {
        ownerId: Types.ObjectId;
        questionVersionId: Types.ObjectId;
        status: "draft" | "published";
      };
      count: number;
      key: string;
    }>([
      {
        $match: {
          libraryQuestionId: new Types.ObjectId(id),
          ownerId: { $ne: userId },
        },
      },
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
        $set: {
          key: {
            $concat: [
              { $toString: "$_id.ownerId" },
              ":",
              { $toString: "$_id.questionVersionId" },
              ":",
              "$_id.status",
            ],
          },
        },
      },
      ...(after ? [{ $match: { key: { $gt: after } } }] : []),
      { $sort: { key: 1 } },
      { $limit: limit + 1 },
    ]);
    const page = rows.slice(0, limit);
    const [users, versions] = await Promise.all([
      UserModel.find({ _id: { $in: page.map((r) => r._id.ownerId) } })
        .select({ username: 1 })
        .lean(),
      LibraryVersionModel.find({
        _id: { $in: page.map((r) => r._id.questionVersionId) },
      })
        .select({ versionNumber: 1 })
        .lean(),
    ]);
    const names = new Map(users.map((u) => [u._id.toString(), u.username])),
      numbers = new Map(
        versions.map((v) => [v._id.toString(), v.versionNumber]),
      );
    return {
      items: page.map((r) => ({
        username: names.get(r._id.ownerId.toString()) ?? "已删除用户",
        versionNumber: numbers.get(r._id.questionVersionId.toString()) ?? null,
        status: r._id.status,
        count: r.count,
      })),
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(userId.toString(), scope, page.at(-1)!.key)
          : null,
    };
  }
}
