import mongoose, { Types, type ClientSession } from "mongoose";
import type {
  LibraryDefinition,
  LibraryFreezeReason,
  LibraryQuestionView,
  LibraryVersionView,
  QuestionType,
  SurveyQuestion,
} from "@survey/survey-logic";
import { ApiError } from "../errors/api-error.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
  type LibraryQuestion,
  type LibraryVersion,
} from "../models/library-question.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import {
  normalizeQuestion,
  type RawQuestionDefinition,
} from "../surveys/questions.js";
import { QuestionShareModel } from "../models/question-share.js";
import {
  libraryAccess,
  visibleVersionsPipeline,
  readAccessibleLibraryVersion,
  libraryMissing,
} from "./access.js";
import { LibraryCursor } from "./cursor.js";

type Identity = LibraryQuestion & { _id: Types.ObjectId };
type Version = LibraryVersion & { _id: Types.ObjectId };
const missing = () =>
  new ApiError(404, "LIBRARY_QUESTION_NOT_FOUND", "题目或版本不存在");
const conflict = () =>
  new ApiError(409, "LIBRARY_CONFLICT", "题目已发生变化，请刷新后重试");
const oid = (id: string) => new Types.ObjectId(id);
export const libraryVersionView = (v: Version): LibraryVersionView => ({
  questionVersionId: v._id.toString(),
  libraryQuestionId: v.libraryQuestionId.toString(),
  versionNumber: v.versionNumber,
  contentRevision: v.contentRevision,
  frozenAt: v.frozenAt?.toISOString() ?? null,
  freezeReasons: v.freezeReasons,
  parentVersionId: v.parentVersionId?.toString() ?? null,
  restoredFromVersionId: v.restoredFromVersionId?.toString() ?? null,
  definition: v.definition,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});
const identityView = (q: Identity): LibraryQuestionView => ({
  libraryQuestionId: q._id.toString(),
  type: q.type,
  latestVersionId: q.latestVersionId.toString(),
  versionCount: q.nextVersionNumber - 1,
  copiedFrom: q.copiedFrom
    ? {
        libraryQuestionId: q.copiedFrom.libraryQuestionId.toString(),
        questionVersionId: q.copiedFrom.questionVersionId.toString(),
        contentRevision: q.copiedFrom.contentRevision,
      }
    : null,
  createdAt: q.createdAt.toISOString(),
  updatedAt: q.updatedAt.toISOString(),
});
function normalized(
  type: QuestionType,
  raw: RawQuestionDefinition,
  base?: LibraryDefinition,
): LibraryDefinition {
  const existing: SurveyQuestion | undefined = base
    ? { ...base, questionId: "q_library", jumpRules: [] }
    : undefined;
  const q = normalizeQuestion(type, raw, existing, existing ? [existing] : []);
  return {
    type: q.type,
    title: q.title,
    required: q.required,
    validation: q.validation,
    options: q.options,
  };
}
async function registerOptions(
  identityId: Types.ObjectId,
  definition: LibraryDefinition,
  session: ClientSession,
  base?: LibraryDefinition,
): Promise<void> {
  const old = new Set(base?.options.map((o) => o.optionId));
  const added = definition.options.filter((o) => !old.has(o.optionId));
  if (added.length)
    await LibraryOptionKeyModel.insertMany(
      added.map((o) => ({ _id: o.optionId, libraryQuestionId: identityId })),
      { session },
    );
}
/** Internal adoption primitive; caller checks ownership/authorization and writes snapshot in this transaction. */
export async function freezeLibraryVersion(
  v: Version,
  expectedRevision: number,
  reason: LibraryFreezeReason,
  session: ClientSession,
): Promise<void> {
  if (v.contentRevision !== expectedRevision) throw conflict();
  const result = await LibraryVersionModel.updateOne(
    {
      _id: v._id,
      libraryQuestionId: v.libraryQuestionId,
      contentRevision: expectedRevision,
    },
    {
      $set: { frozenAt: v.frozenAt ?? new Date() },
      $addToSet: { freezeReasons: reason },
    },
    { session },
  );
  if (result.matchedCount !== 1) throw conflict();
}
export interface LibraryTestHooks {
  afterFreeze?: () => Promise<void> | void;
  afterVersionInserted?: () => Promise<void> | void;
}
export class LibraryService {
  constructor(
    private cursors: LibraryCursor,
    private hooks: LibraryTestHooks = {},
  ) {}
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      LibraryQuestionModel.init(),
      LibraryVersionModel.init(),
      LibraryOptionKeyModel.init(),
      QuestionUsageModel.init(),
      QuestionShareModel.init(),
    ]);
  }
  private async owned(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    session?: ClientSession,
  ): Promise<Identity> {
    const q = await LibraryQuestionModel.findOne({
      _id: libraryQuestionId,
      ownerId,
    })
      .session(session ?? null)
      .lean();
    if (!q) throw missing();
    return q;
  }
  private async version(
    libraryQuestionId: string,
    versionId: string,
    session?: ClientSession,
  ): Promise<Version> {
    const v = await LibraryVersionModel.findOne({
      _id: versionId,
      libraryQuestionId,
    })
      .session(session ?? null)
      .lean();
    if (!v) throw missing();
    return v;
  }
  async create(
    ownerId: Types.ObjectId,
    input: RawQuestionDefinition & { type: QuestionType },
  ) {
    await this.ensureIndexes();
    let result:
      { libraryQuestionId: string; questionVersionId: string } | undefined;
    await mongoose.connection.transaction(async (session) => {
      result = await createLibraryQuestionRecords(ownerId, input, session);
      await this.hooks.afterVersionInserted?.();
    });
    return this.get(
      ownerId,
      result!.libraryQuestionId,
      result!.questionVersionId,
    );
  }

  async get(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    versionId?: string,
  ) {
    const { identity: q, isOwner } = await libraryAccess(
      ownerId,
      libraryQuestionId,
    );
    let v: Version;
    let visibleCount = q.nextVersionNumber - 1;
    let latestVersionId = q.latestVersionId.toString();
    if (isOwner)
      v = await this.version(libraryQuestionId, versionId ?? latestVersionId);
    else {
      const rows = await LibraryVersionModel.aggregate<Version>([
        ...visibleVersionsPipeline(ownerId, libraryQuestionId),
        { $sort: { versionNumber: -1 } },
        { $limit: 1 },
      ]);
      const latest = rows[0];
      if (!latest) throw libraryMissing();
      latestVersionId = latest._id.toString();
      visibleCount = await QuestionShareModel.countDocuments({
        libraryQuestionId,
        recipientId: ownerId,
      });
      const chosen = versionId ?? latestVersionId;
      if (
        !(await QuestionShareModel.exists({
          libraryQuestionId,
          questionVersionId: chosen,
          recipientId: ownerId,
        }))
      )
        throw libraryMissing();
      v = await this.version(libraryQuestionId, chosen);
    }
    const counts = await QuestionUsageModel.aggregate<{
      _id: boolean;
      count: number;
    }>([
      {
        $match: { questionVersionId: v._id, ...(!isOwner ? { ownerId } : {}) },
      },
      { $group: { _id: { $eq: ["$ownerId", ownerId] }, count: { $sum: 1 } } },
    ]);
    const view = (await this.safeVersionViews(ownerId, [v], isOwner))[0]!;
    return {
      access: isOwner ? ("owner" as const) : ("shared" as const),
      question: {
        ...identityView(q),
        latestVersionId,
        versionCount: visibleCount,
        ...(!isOwner ? { copiedFrom: null } : {}),
      },
      version: view,
      modificationStatus: {
        canEditInPlace: isOwner && v.frozenAt === null,
        ownUsageCount: counts.find((c) => c._id === true)?.count ?? 0,
        otherUsageCount: isOwner
          ? (counts.find((c) => c._id === false)?.count ?? 0)
          : 0,
      },
    };
  }
  private async safeVersionViews(
    userId: Types.ObjectId,
    rows: Version[],
    isOwner: boolean,
  ): Promise<LibraryVersionView[]> {
    if (isOwner) return rows.map(libraryVersionView);
    const ancestors = rows.flatMap((v) =>
      [v.parentVersionId, v.restoredFromVersionId].filter(
        (id): id is Types.ObjectId => id !== null,
      ),
    );
    const visible = await QuestionShareModel.find({
      recipientId: userId,
      questionVersionId: { $in: ancestors },
    })
      .select({ questionVersionId: 1 })
      .lean();
    const allowed = new Set(visible.map((g) => g.questionVersionId.toString()));
    return rows.map((v) => {
      const view = libraryVersionView(v);
      return {
        ...view,
        ...(view.parentVersionId && !allowed.has(view.parentVersionId)
          ? { parentVersionId: null, parentUnavailable: true }
          : {}),
        ...(view.restoredFromVersionId &&
        !allowed.has(view.restoredFromVersionId)
          ? { restoredFromVersionId: null, restoredFromUnavailable: true }
          : {}),
      };
    });
  }

  async list(ownerId: Types.ObjectId, limit: number, cursor?: string) {
    const after = cursor
      ? this.cursors.decode(cursor, ownerId.toString(), "questions")
      : undefined;
    const rows = await LibraryQuestionModel.find({
      ownerId,
      ...(after ? { _id: { $lt: oid(after as string) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = rows.slice(0, limit);
    const versions = await LibraryVersionModel.find({
      _id: { $in: page.map((q) => q.latestVersionId) },
    }).lean();
    const byId = new Map(versions.map((v) => [v._id.toString(), v]));
    return {
      items: page.map((q) => ({
        question: identityView(q),
        version: libraryVersionView(byId.get(q.latestVersionId.toString())!),
      })),
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(
              ownerId.toString(),
              "questions",
              page.at(-1)!._id.toString(),
            )
          : null,
    };
  }
  async listShared(userId: Types.ObjectId, limit: number, cursor?: string) {
    const scope = "sharedQuestions",
      after = cursor
        ? this.cursors.decode(cursor, userId.toString(), scope)
        : undefined;
    const rows = await QuestionShareModel.aggregate<{
      _id: Types.ObjectId;
      version: Version;
      count: number;
    }>([
      {
        $match: {
          recipientId: userId,
          ...(after
            ? {
                libraryQuestionId: { $lt: new Types.ObjectId(after as string) },
              }
            : {}),
        },
      },
      {
        $lookup: {
          from: "question_versions",
          localField: "questionVersionId",
          foreignField: "_id",
          as: "version",
        },
      },
      { $unwind: "$version" },
      { $sort: { "version.versionNumber": -1 } },
      {
        $group: {
          _id: "$libraryQuestionId",
          version: { $first: "$version" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: limit + 1 },
    ]);
    const page = rows.slice(0, limit),
      identities = await LibraryQuestionModel.find({
        _id: { $in: page.map((r) => r._id) },
      }).lean(),
      byId = new Map(identities.map((q) => [q._id.toString(), q]));
    const views = await this.safeVersionViews(
      userId,
      page.map((r) => r.version),
      false,
    );
    return {
      items: page.flatMap((r, i) => {
        const q = byId.get(r._id.toString());
        return q
          ? [
              {
                question: {
                  ...identityView(q),
                  latestVersionId: r.version._id.toString(),
                  versionCount: r.count,
                  copiedFrom: null,
                },
                version: views[i]!,
              },
            ]
          : [];
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
  async history(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    limit: number,
    cursor?: string,
  ) {
    const { isOwner } = await libraryAccess(ownerId, libraryQuestionId);
    const scope = `versions:${libraryQuestionId}`;
    const after = cursor
      ? this.cursors.decode(cursor, ownerId.toString(), scope)
      : undefined;
    const rows = isOwner
      ? await LibraryVersionModel.find({
          libraryQuestionId,
          ...(after ? { versionNumber: { $lt: after as number } } : {}),
        })
          .sort({ versionNumber: -1 })
          .limit(limit + 1)
          .lean()
      : await LibraryVersionModel.aggregate<Version>([
          ...visibleVersionsPipeline(ownerId, libraryQuestionId),
          ...(after ? [{ $match: { versionNumber: { $lt: after } } }] : []),
          { $sort: { versionNumber: -1 } },
          { $limit: limit + 1 },
        ]);
    const page = rows.slice(0, limit);
    return {
      items: await this.safeVersionViews(ownerId, page, isOwner),
      nextCursor:
        rows.length > limit
          ? this.cursors.encode(
              ownerId.toString(),
              scope,
              page.at(-1)!.versionNumber,
            )
          : null,
    };
  }

  async edit(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    versionId: string,
    expected: number,
    raw: RawQuestionDefinition,
  ) {
    await mongoose.connection.transaction(async (session) => {
      const q = await this.owned(ownerId, libraryQuestionId, session);
      const v = await this.version(libraryQuestionId, versionId, session);
      if (v.frozenAt)
        throw new ApiError(
          409,
          "LIBRARY_VERSION_FROZEN",
          "该版本曾被使用或派生，请创建新版本或另存新题",
        );
      if (v.contentRevision !== expected) throw conflict();
      const definition = normalized(q.type, raw, v.definition);
      const result = await LibraryVersionModel.updateOne(
        { _id: v._id, contentRevision: expected, frozenAt: null },
        { $set: { definition }, $inc: { contentRevision: 1 } },
        { session },
      );
      if (result.matchedCount !== 1) throw conflict();
      await registerOptions(q._id, definition, session, v.definition);
      await LibraryQuestionModel.updateOne(
        { _id: q._id, revision: q.revision },
        { $inc: { revision: 1 } },
        { session },
      );
    });
    return this.get(ownerId, libraryQuestionId, versionId);
  }
  async branch(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    sourceVersionId: string,
    expected: number,
    raw: RawQuestionDefinition,
  ) {
    await this.ensureIndexes();
    let versionId = "";
    await mongoose.connection.transaction(async (session) => {
      const q = await this.owned(ownerId, libraryQuestionId, session),
        v = await this.version(libraryQuestionId, sourceVersionId, session);
      if (v.contentRevision !== expected) throw conflict();
      const definition = normalized(q.type, raw, v.definition);
      await freezeLibraryVersion(v, expected, "derived", session);
      await this.hooks.afterFreeze?.();
      versionId = await this.append(
        q,
        definition,
        v._id,
        null,
        session,
        v.definition,
      );
    });
    return this.get(ownerId, libraryQuestionId, versionId);
  }
  private async append(
    q: Identity,
    definition: LibraryDefinition,
    parentVersionId: Types.ObjectId,
    restoredFromVersionId: Types.ObjectId | null,
    session: ClientSession,
    base: LibraryDefinition,
  ): Promise<string> {
    const _id = new Types.ObjectId();
    await LibraryVersionModel.create(
      [
        {
          _id,
          libraryQuestionId: q._id,
          versionNumber: q.nextVersionNumber,
          contentRevision: 1,
          frozenAt: null,
          freezeReasons: [],
          parentVersionId,
          restoredFromVersionId,
          definition,
        },
      ],
      { session },
    );
    await registerOptions(q._id, definition, session, base);
    await this.hooks.afterVersionInserted?.();
    const result = await LibraryQuestionModel.updateOne(
      { _id: q._id, revision: q.revision },
      {
        $set: { latestVersionId: _id },
        $inc: { nextVersionNumber: 1, revision: 1 },
      },
      { session },
    );
    if (result.matchedCount !== 1) throw conflict();
    return _id.toString();
  }
  async restore(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    input: {
      restoredFromVersionId: string;
      sourceContentRevision: number;
      baseVersionId: string;
      baseContentRevision: number;
    },
  ) {
    await this.ensureIndexes();
    let versionId = "";
    await mongoose.connection.transaction(async (session) => {
      const q = await this.owned(ownerId, libraryQuestionId, session);
      if (q.latestVersionId.toString() !== input.baseVersionId)
        throw conflict();
      const source = await this.version(
        libraryQuestionId,
        input.restoredFromVersionId,
        session,
      );
      const base = await this.version(
        libraryQuestionId,
        input.baseVersionId,
        session,
      );
      await freezeLibraryVersion(
        source,
        input.sourceContentRevision,
        "restored",
        session,
      );
      await freezeLibraryVersion(
        base,
        input.baseContentRevision,
        "derived",
        session,
      );
      await this.hooks.afterFreeze?.();
      versionId = await this.append(
        q,
        source.definition,
        base._id,
        source._id,
        session,
        source.definition,
      );
    });
    return this.get(ownerId, libraryQuestionId, versionId);
  }
  async copy(
    ownerId: Types.ObjectId,
    libraryQuestionId: string,
    versionId: string,
    expected: number,
  ) {
    await this.ensureIndexes();
    let newIdentityId = "";
    await mongoose.connection.transaction(async (session) => {
      const source = await readAccessibleLibraryVersion(
        ownerId,
        libraryQuestionId,
        versionId,
        session,
      );
      await freezeLibraryVersion(source, expected, "copied", session);
      await this.hooks.afterFreeze?.();
      const definition = normalized(source.definition.type, {
        ...source.definition,
        options: source.definition.options.map((o) => ({ text: o.text })),
      });
      const _id = new Types.ObjectId(),
        newVersionId = new Types.ObjectId();
      newIdentityId = _id.toString();
      await LibraryQuestionModel.create(
        [
          {
            _id,
            ownerId,
            type: definition.type,
            latestVersionId: newVersionId,
            nextVersionNumber: 2,
            revision: 1,
            copiedFrom: {
              libraryQuestionId: oid(libraryQuestionId),
              questionVersionId: source._id,
              contentRevision: source.contentRevision,
            },
          },
        ],
        { session },
      );
      await LibraryVersionModel.create(
        [
          {
            _id: newVersionId,
            libraryQuestionId: _id,
            versionNumber: 1,
            contentRevision: 1,
            frozenAt: null,
            freezeReasons: [],
            parentVersionId: null,
            restoredFromVersionId: null,
            definition,
          },
        ],
        { session },
      );
      await registerOptions(_id, definition, session);
      await this.hooks.afterVersionInserted?.();
    });
    return this.get(ownerId, newIdentityId);
  }
}

export async function createLibraryQuestionRecords(
  ownerId: Types.ObjectId,
  input: RawQuestionDefinition & { type: QuestionType },
  session: ClientSession,
): Promise<{ libraryQuestionId: string; questionVersionId: string }> {
  const definition = normalized(input.type, input);
  const identityId = new Types.ObjectId(),
    versionId = new Types.ObjectId();
  await LibraryQuestionModel.create(
    [
      {
        _id: identityId,
        ownerId,
        type: definition.type,
        latestVersionId: versionId,
        nextVersionNumber: 2,
        revision: 1,
        copiedFrom: null,
      },
    ],
    { session },
  );
  await LibraryVersionModel.create(
    [
      {
        _id: versionId,
        libraryQuestionId: identityId,
        versionNumber: 1,
        contentRevision: 1,
        frozenAt: null,
        freezeReasons: [],
        parentVersionId: null,
        restoredFromVersionId: null,
        definition,
      },
    ],
    { session },
  );
  await registerOptions(identityId, definition, session);
  return {
    libraryQuestionId: identityId.toString(),
    questionVersionId: versionId.toString(),
  };
}
