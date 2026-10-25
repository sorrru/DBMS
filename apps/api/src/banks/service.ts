import mongoose, { Types, type ClientSession } from "mongoose";
import { ApiError } from "../errors/api-error.js";
import { LibraryCursor } from "../library/cursor.js";
import { LibraryService } from "../library/service.js";
import { readAccessibleLibraryVersion } from "../library/access.js";
import {
  QuestionBankModel,
  QuestionBankItemModel,
  type QuestionBank,
} from "../models/question-bank.js";
const missing = () => new ApiError(404, "BANK_NOT_FOUND", "题库或成员不存在");
const conflict = () =>
  new ApiError(409, "BANK_CONFLICT", "题库或成员已变化，请刷新后重试");
const view = (b: QuestionBank & { _id: Types.ObjectId }) => ({
  bankId: b._id.toString(),
  name: b.name,
  revision: b.revision,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
});
export class BankService {
  private library: LibraryService;
  constructor(
    private cursors: LibraryCursor,
    private hooks: { afterMemberWrite?: () => void | Promise<void> } = {},
  ) {
    this.library = new LibraryService(cursors);
  }
  async ensureIndexes() {
    await Promise.all([
      QuestionBankModel.init(),
      QuestionBankItemModel.init(),
      this.library.ensureIndexes(),
    ]);
  }
  private async owned(
    user: Types.ObjectId,
    id: string,
    session?: ClientSession,
  ) {
    const b = await QuestionBankModel.findOne({ _id: id, ownerId: user })
      .session(session ?? null)
      .lean();
    if (!b) throw missing();
    return b;
  }
  async create(user: Types.ObjectId, name: string) {
    await this.ensureIndexes();
    return view(
      (await QuestionBankModel.create({ ownerId: user, name })).toObject(),
    );
  }
  async list(user: Types.ObjectId, limit: number, cursor?: string) {
    const after = cursor
      ? (this.cursors.decode(cursor, user.toString(), "banks") as string)
      : null;
    const rows = await QuestionBankModel.find({
      ownerId: user,
      ...(after ? { _id: { $lt: after } } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    return {
      items: rows.slice(0, limit).map(view),
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(
              user.toString(),
              "banks",
              rows[limit - 1]!._id.toString(),
            )
          : null,
    };
  }
  async rename(
    user: Types.ObjectId,
    id: string,
    revision: number,
    name: string,
  ) {
    await this.owned(user, id);
    const b = await QuestionBankModel.findOneAndUpdate(
      { _id: id, ownerId: user, revision },
      { $set: { name }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    ).lean();
    if (!b) throw conflict();
    return view(b);
  }
  async remove(user: Types.ObjectId, id: string, revision: number) {
    await mongoose.connection.transaction(async (session) => {
      await this.owned(user, id, session);
      const r = await QuestionBankModel.deleteOne(
        { _id: id, ownerId: user, revision },
        { session },
      );
      if (!r.deletedCount) throw conflict();
      await QuestionBankItemModel.deleteMany({ bankId: id }, { session });
    });
  }
  async members(
    user: Types.ObjectId,
    id: string,
    limit: number,
    cursor?: string,
  ) {
    const b = await this.owned(user, id),
      scope = `bankItems:${id}`;
    const after = cursor
      ? (this.cursors.decode(cursor, user.toString(), scope) as string)
      : null;
    const rows = await QuestionBankItemModel.find({
      bankId: id,
      ...(after ? { _id: { $lt: after } } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    // Bounded page; use the library's permission-aware projection, including ancestor redaction.
    const items = await Promise.all(
      rows.slice(0, limit).map(async (row) => {
        const item = {
          itemId: row._id.toString(),
          libraryQuestionId: row.libraryQuestionId.toString(),
          versionPolicy: row.versionPolicy,
          questionVersionId: row.questionVersionId?.toString() ?? null,
          revision: row.revision,
        };
        try {
          const detail = await this.library.get(
            user,
            item.libraryQuestionId,
            item.questionVersionId ?? undefined,
          );
          return { ...item, available: true, version: detail.version };
        } catch (e) {
          if (e instanceof ApiError && e.status === 404)
            return { ...item, available: false, version: null };
          throw e;
        }
      }),
    );
    return {
      bank: view(b),
      items,
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(
              user.toString(),
              scope,
              rows[limit - 1]!._id.toString(),
            )
          : null,
    };
  }
  async putMember(
    user: Types.ObjectId,
    id: string,
    input: {
      libraryQuestionId: string;
      versionPolicy: "latest" | "pinned";
      questionVersionId: string | null;
      revision?: number;
    },
    itemId?: string,
  ) {
    await this.ensureIndexes();
    try {
      await mongoose.connection.transaction(async (session) => {
        await this.owned(user, id, session);
        // All membership writes contend with deletion without making unrelated members' revisions stale.
        await QuestionBankModel.updateOne(
          { _id: id, ownerId: user },
          { $inc: { membershipRevision: 1 } },
          { session },
        );
        let versionId = input.questionVersionId;
        if (!versionId)
          versionId = (await this.library.get(user, input.libraryQuestionId))
            .version.questionVersionId;
        await readAccessibleLibraryVersion(
          user,
          input.libraryQuestionId,
          versionId,
          session,
        );
        const values = {
          versionPolicy: input.versionPolicy,
          questionVersionId: input.questionVersionId,
        };
        if (itemId) {
          const row = await QuestionBankItemModel.findOne({
            _id: itemId,
            bankId: id,
          })
            .session(session)
            .lean();
          if (!row) throw missing();
          if (
            row.libraryQuestionId.toString() !== input.libraryQuestionId ||
            row.revision !== input.revision
          )
            throw conflict();
          await QuestionBankItemModel.updateOne(
            { _id: itemId },
            { $set: values, $inc: { revision: 1 } },
            { session },
          );
        } else {
          if (
            await QuestionBankItemModel.exists({
              bankId: id,
              libraryQuestionId: input.libraryQuestionId,
            }).session(session)
          )
            throw conflict();
          await QuestionBankItemModel.create(
            [
              {
                bankId: id,
                libraryQuestionId: input.libraryQuestionId,
                ...values,
              },
            ],
            { session },
          );
        }
        await this.hooks.afterMemberWrite?.();
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw conflict();
      throw e;
    }
  }
  async removeMember(
    user: Types.ObjectId,
    id: string,
    itemId: string,
    revision: number,
  ) {
    await mongoose.connection.transaction(async (session) => {
      await this.owned(user, id, session);
      await QuestionBankModel.updateOne(
        { _id: id, ownerId: user },
        { $inc: { membershipRevision: 1 } },
        { session },
      );
      const row = await QuestionBankItemModel.findOne({
        _id: itemId,
        bankId: id,
      })
        .session(session)
        .lean();
      if (!row) throw missing();
      if (row.revision !== revision) throw conflict();
      await QuestionBankItemModel.deleteOne({ _id: itemId }, { session });
    });
  }
}
