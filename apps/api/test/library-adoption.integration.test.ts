import mongoose, { Types } from "mongoose";
import request from "supertest";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { PasswordService } from "../src/security/password.js";
import { TokenService } from "../src/security/token.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { sessionCookieName } from "../src/http/cookies.js";
import { SurveyService } from "../src/surveys/service.js";
import { SurveyCursorService } from "../src/surveys/cursor.js";
import { LibraryService } from "../src/library/service.js";
import { LibraryCursor } from "../src/library/cursor.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
  LibraryOptionKeyModel,
} from "../src/models/library-question.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { FillSessionModel } from "../src/models/fill-session.js";
import { UserModel } from "../src/models/user.js";
import { assertSafeTestDatabase } from "./database-safety.js";
import type { PublicVersion } from "../src/surveys/service.js";
const origin = "http://localhost:5173",
  tokens = new TokenService(env.jwtSecret),
  rateLimits = new FixedWindowStore(1000);
const app = createApp({
  env: { ...env, surveyWriteRateLimit: 1000 },
  passwords: new PasswordService(),
  tokens,
  rateLimits,
});
const surveys = new SurveyService(env, new SurveyCursorService(env.jwtSecret));
const library = new LibraryService(new LibraryCursor(env.jwtSecret));
let ownerId: Types.ObjectId,
  otherId: Types.ObjectId,
  surveyId: string,
  versionId: string;
const cookie = (owner = ownerId) =>
  `${sessionCookieName}=${tokens.sign(owner.toString())}`;
const auth = (test: request.Test, owner = ownerId) =>
  test.set("Origin", origin).set("Cookie", cookie(owner));
const root = () => `/api/surveys/${surveyId}/versions/${versionId}`;
const qPath = (q: string) => `${root()}/questions/${q}`;
const current = () => surveys.getVersion(ownerId, surveyId, versionId);
async function createLibrary() {
  return library.create(ownerId, {
    type: "single",
    title: "满意度",
    required: true,
    validation: {},
    options: [{ text: "满意" }, { text: "一般" }],
  });
}
type Lib = Awaited<ReturnType<typeof createLibrary>>;
const selection = (lib: Lib) => ({
  libraryQuestionId: lib.question.libraryQuestionId,
  questionVersionId: lib.version.questionVersionId,
  contentRevision: lib.version.contentRevision,
});
async function adopt(lib: Lib) {
  return auth(request(app).post(`${root()}/library-questions`))
    .send({ revision: (await current()).revision, ...selection(lib) })
    .expect(201);
}
async function local() {
  return surveys.addQuestion(ownerId, surveyId, versionId, {
    revision: (await current()).revision,
    type: "text",
    title: "本地补充",
    required: false,
    validation: {},
    options: [],
  });
}
async function newer(lib: Lib) {
  const d = lib.version.definition;
  return library.branch(
    ownerId,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    lib.version.contentRevision,
    { ...d, title: "满意度新版", options: d.options },
  );
}
async function rule(from: string, target: string) {
  const v = await current(),
    q = v.questions.find((q) => q.questionId === from)!;
  return surveys.updateJumpRules(
    ownerId,
    surveyId,
    versionId,
    from,
    v.revision,
    [
      {
        operator: "equals",
        value: q.options[0]!.optionId,
        targetQuestionId: target,
      },
    ],
  );
}
async function publish() {
  const v = await current();
  return surveys.publish(ownerId, surveyId, versionId, v.revision, true);
}
async function clear() {
  await Promise.all([
    SurveyResponseModel.deleteMany({}),
    FillSessionModel.deleteMany({}),
    QuestionUsageModel.deleteMany({}),
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    LibraryOptionKeyModel.deleteMany({}),
    LibraryVersionModel.deleteMany({}),
    LibraryQuestionModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
}
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
  await Promise.all([
    surveys.ensureIndexes(),
    library.ensureIndexes(),
    UserModel.init(),
    FillSessionModel.init(),
    SurveyResponseModel.init(),
  ]);
});
beforeEach(async () => {
  rateLimits.reset();
  await clear();
  const users = await UserModel.create([
    {
      username: "adopt_owner",
      usernameNormalized: "adopt_owner",
      passwordHash: "unused",
      registeredAt: new Date(),
    },
    {
      username: "adopt_other",
      usernameNormalized: "adopt_other",
      passwordHash: "unused",
      registeredAt: new Date(),
    },
  ]);
  ownerId = users[0]!._id;
  otherId = users[1]!._id;
  const survey = await surveys.create(ownerId, "复用测试");
  surveyId = survey.id;
  versionId = survey.draftVersion!.id;
});
afterAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await clear();
  await mongoose.disconnect();
  rateLimits.dispose();
});
describe("library adoption into existing survey lifecycle", () => {
  it("keeps the original question limit and does not freeze a source when the draft is full", async () => {
    const questions = Array.from({ length: 100 }, (_, i) => ({
      questionId: `q_limit_${i}`,
      type: "text",
      title: `题${i}`,
      required: false,
      validation: { minLength: 0, maxLength: 2000, digitsOnly: false },
      options: [],
      jumpRules: [],
    }));
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { $set: { questions } },
    );
    const lib = await createLibrary();
    const r = await auth(request(app).post(`${root()}/library-questions`))
      .send({ revision: 1, ...selection(lib) })
      .expect(409);
    expect(r.body.error.code).toBe("QUESTION_LIMIT_REACHED");
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).toBeNull();
  });
  it("rolls back discarded usage and version deletion on lifecycle failure", async () => {
    await adopt(await createLibrary());
    await publish();
    const draft = await surveys.createNextVersion(ownerId, surveyId, versionId);
    const faulty = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
      undefined,
      {
        afterDraftUsagesRemoved: () => {
          throw Error("discard rollback");
        },
      },
    );
    await expect(
      faulty.discardDraft(
        ownerId,
        surveyId,
        draft.version.id,
        draft.version.revision,
      ),
    ).rejects.toThrow("discard rollback");
    expect(await SurveyVersionModel.countDocuments()).toBe(2);
    expect(await QuestionUsageModel.countDocuments()).toBe(2);
    expect((await surveys.get(ownerId, surveyId)).draftVersion?.id).toBe(
      draft.version.id,
    );
  });

  it("adopts the same version twice with independent instance IDs and stable source option mappings", async () => {
    const lib = await createLibrary();
    await adopt(lib);
    const r = await adopt(lib);
    const v = r.body.version as PublicVersion;
    expect(v.schemaVersion).toBe(2);
    expect(v.questions).toHaveLength(2);
    expect(
      new Set(
        v.questions.flatMap((q) => [
          q.questionId,
          ...q.options.map((o) => o.optionId),
        ]),
      ).size,
    ).toBe(6);
    for (const q of v.questions) {
      expect(q.source).toMatchObject({ ...selection(lib), versionNumber: 1 });
      expect(q.jumpRules).toEqual([]);
      expect(q.source!.optionSources.map((o) => o.sourceOptionId)).toEqual(
        lib.version.definition.options.map((o) => o.optionId),
      );
      expect(q.source!.optionSources.map((o) => o.optionId)).toEqual(
        q.options.map((o) => o.optionId),
      );
    }
    expect(await QuestionUsageModel.countDocuments()).toBe(2);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .freezeReasons,
    ).toContain("adopted");
  });
  it("reuses one source in multiple surveys without later library versions changing snapshots", async () => {
    const lib = await createLibrary();
    const first = (await adopt(lib)).body.version;
    const second = await surveys.create(ownerId, "第二份问卷");
    await surveys.addLibraryQuestion(
      ownerId,
      second.id,
      second.draftVersion!.id,
      { revision: 1, ...selection(lib) },
    );
    await newer(lib);
    expect((await current()).questions).toEqual(first.questions);
    expect(
      (
        await library.get(
          ownerId,
          lib.question.libraryQuestionId,
          lib.version.questionVersionId,
        )
      ).modificationStatus.ownUsageCount,
    ).toBe(2);
  });
  it("rejects unauthorized survey/library access, foreign versions and forged source data", async () => {
    const lib = await createLibrary();
    await auth(request(app).post(`${root()}/library-questions`), otherId)
      .send({ revision: 1, ...selection(lib) })
      .expect(404);
    const foreign = await library.create(otherId, {
      type: "text",
      title: "别人的题",
      required: false,
      validation: {},
      options: [],
    });
    await auth(request(app).post(`${root()}/library-questions`))
      .send({ revision: 1, ...selection(foreign) })
      .expect(404);
    await auth(request(app).post(`${root()}/library-questions`))
      .send({
        revision: 1,
        ...selection(lib),
        questionVersionId: foreign.version.questionVersionId,
      })
      .expect(404);
    for (const extra of [
      { source: {} },
      { optionSources: [] },
      { ownerId: otherId.toString() },
    ])
      await auth(request(app).post(`${root()}/library-questions`))
        .send({ revision: 1, ...selection(lib), ...extra })
        .expect(400);
    expect((await current()).revision).toBe(1);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).toBeNull();
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
  });
  it("does not freeze unused sources on stale draft or source content revisions", async () => {
    const lib = await createLibrary();
    await local();
    await auth(request(app).post(`${root()}/library-questions`))
      .send({ revision: 1, ...selection(lib) })
      .expect(409);
    await library.edit(
      ownerId,
      lib.question.libraryQuestionId,
      lib.version.questionVersionId,
      1,
      { ...lib.version.definition, title: "已修改" },
    );
    await auth(request(app).post(`${root()}/library-questions`))
      .send({ revision: 2, ...selection(lib) })
      .expect(409);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).toBeNull();
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
  });
  it("forbids all library writes to published versions without mutating a source", async () => {
    const localResult = await local(),
      q = localResult.questionId;
    await publish();
    const lib = await createLibrary(),
      revision = (await current()).revision;
    for (const call of [
      request(app)
        .post(`${root()}/library-questions`)
        .send({ revision, ...selection(lib) }),
      request(app)
        .put(`${qPath(q)}/library-source`)
        .send({ revision, ...selection(lib) }),
      request(app)
        .post(`${qPath(q)}/save-to-library`)
        .send({ revision }),
      request(app)
        .post(`${qPath(q)}/detach-library`)
        .send({ revision }),
    ])
      await auth(call).expect(409);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).toBeNull();
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
  });
  it("saves a local definition without jump rules, binding old answers or modifying the original question", async () => {
    const a = await surveys.addQuestion(ownerId, surveyId, versionId, {
      revision: 1,
      type: "single",
      title: "本地题",
      required: true,
      validation: {},
      options: [{ text: "A" }, { text: "B" }],
    });
    const b = await local();
    await rule(a.questionId, b.questionId);
    const before = await current();
    const saved = await auth(
      request(app).post(`${qPath(a.questionId)}/save-to-library`),
    )
      .send({ revision: before.revision })
      .expect(201);
    expect(saved.body.version.questions).toEqual(before.questions);
    expect(saved.body.version.schemaVersion).toBe(1);
    expect(saved.body.version.revision).toBe(before.revision + 1);
    const lib = await library.get(ownerId, saved.body.libraryQuestionId);
    expect(lib.version.definition.title).toBe("本地题");
    expect(lib.version.definition).not.toHaveProperty("jumpRules");
    expect(lib.version.frozenAt).toBeNull();
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
  });
  it("requires explicit detaching before definition edits and blocks forged source removal", async () => {
    const r = await adopt(await createLibrary()),
      q = r.body.version.questions[0];
    const body = {
      revision: r.body.version.revision,
      title: "篡改",
      required: true,
      validation: {},
      options: q.options,
    };
    const response = await auth(request(app).patch(qPath(q.questionId)))
      .send(body)
      .expect(409);
    expect(response.body.error.code).toBe("LIBRARY_SNAPSHOT_READ_ONLY");
    await auth(request(app).patch(qPath(q.questionId)))
      .send({ ...body, source: null })
      .expect(400);
    expect((await current()).questions[0]!.title).toBe("满意度");
    expect(await QuestionUsageModel.countDocuments()).toBe(1);
  });
  it("retains source through sorting and local jumps, detaches without changing IDs/jumps, and never unfreezes", async () => {
    const lib = await createLibrary(),
      r = await adopt(lib),
      q = r.body.version.questions[0];
    const b = await local();
    await rule(q.questionId, b.questionId);
    const before = await current();
    await surveys.reorderQuestions(
      ownerId,
      surveyId,
      versionId,
      before.revision,
      [b.questionId, q.questionId],
    );
    const reordered = await current();
    expect(reordered.questions[1]!.source).toEqual(q.source);
    const detached = await auth(
      request(app).post(`${qPath(q.questionId)}/detach-library`),
    )
      .send({ revision: reordered.revision })
      .expect(200);
    const after = detached.body.version.questions[1];
    expect(after).not.toHaveProperty("source");
    expect(after.options).toEqual(q.options);
    expect(after.questionId).toBe(q.questionId);
    expect(after.jumpRules).toEqual(before.questions[0]!.jumpRules);
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).not.toBeNull();
    await auth(request(app).patch(qPath(q.questionId)))
      .send({
        revision: detached.body.version.revision,
        title: "本地可编辑",
        required: true,
        validation: {},
        options: after.options,
      })
      .expect(200);
  });
  it("replaces with a chosen version of the same identity at the same position and changes usage atomically", async () => {
    const lib = await createLibrary();
    await local();
    const r = await adopt(lib),
      old = r.body.version.questions[1];
    const v2 = await newer(lib);
    const changed = await auth(
      request(app).put(`${qPath(old.questionId)}/library-source`),
    )
      .send({ revision: r.body.version.revision, ...selection(v2) })
      .expect(200);
    const q = changed.body.version.questions[1];
    expect(q.questionId).not.toBe(old.questionId);
    expect(q.title).toBe("满意度新版");
    expect(q.source.questionVersionId).toBe(v2.version.questionVersionId);
    expect(q.jumpRules).toEqual([]);
    expect(
      await QuestionUsageModel.countDocuments({
        questionVersionId: lib.version.questionVersionId,
      }),
    ).toBe(0);
    expect(
      await QuestionUsageModel.countDocuments({
        questionVersionId: v2.version.questionVersionId,
      }),
    ).toBe(1);
    const other = await createLibrary();
    await auth(request(app).put(`${qPath(q.questionId)}/library-source`))
      .send({ revision: changed.body.version.revision, ...selection(other) })
      .expect(400);
  });
  it("requires incoming jumps and outgoing rules to be resolved before replacement", async () => {
    const lib = await createLibrary(),
      r = await adopt(lib),
      first = r.body.version.questions[0],
      v2 = await newer(lib);
    const second = await adopt(lib),
      target = second.body.version.questions[1];
    await rule(first.questionId, target.questionId);
    const rev = (await current()).revision;
    const incoming = await auth(
      request(app).put(`${qPath(target.questionId)}/library-source`),
    )
      .send({ revision: rev, ...selection(v2) })
      .expect(409);
    expect(incoming.body.error.code).toBe("QUESTION_REFERENCED");
    const outgoing = await auth(
      request(app).put(`${qPath(first.questionId)}/library-source`),
    )
      .send({ revision: rev, ...selection(v2) })
      .expect(409);
    expect(outgoing.body.error.code).toBe("QUESTION_HAS_JUMP_RULES");
    expect(await QuestionUsageModel.countDocuments()).toBe(2);
    expect(
      (
        await library.get(
          ownerId,
          v2.question.libraryQuestionId,
          v2.version.questionVersionId,
        )
      ).version.frozenAt,
    ).toBeNull();
  });
  it("deletes usage when a source question is removed but keeps its library version frozen", async () => {
    const lib = await createLibrary(),
      r = await adopt(lib),
      q = r.body.version.questions[0];
    await auth(request(app).delete(qPath(q.questionId)))
      .send({ revision: r.body.version.revision })
      .expect(200);
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).not.toBeNull();
  });
  it("publishes usage state, copies sources into next draft, and removes only discarded-draft usage", async () => {
    const lib = await createLibrary();
    await adopt(lib);
    await publish();
    expect(
      await QuestionUsageModel.countDocuments({ status: "published" }),
    ).toBe(1);
    const next = await surveys.createNextVersion(ownerId, surveyId, versionId);
    expect(next.version.schemaVersion).toBe(2);
    expect(next.version.questions).toEqual((await current()).questions);
    expect(await QuestionUsageModel.countDocuments({ status: "draft" })).toBe(
      1,
    );
    await surveys.discardDraft(
      ownerId,
      surveyId,
      next.version.id,
      next.version.revision,
    );
    expect(await QuestionUsageModel.countDocuments()).toBe(1);
    expect(
      await QuestionUsageModel.countDocuments({ status: "published" }),
    ).toBe(1);
  });
  it("rolls back freezing, usage and draft revision if adoption transaction fails", async () => {
    const lib = await createLibrary();
    const faulty = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
      undefined,
      {
        afterQuestionUsagesChanged: () => {
          throw Error("projection rollback");
        },
      },
    );
    await expect(
      faulty.addLibraryQuestion(ownerId, surveyId, versionId, {
        revision: 1,
        ...selection(lib),
      }),
    ).rejects.toThrow("projection rollback");
    expect((await current()).revision).toBe(1);
    expect((await current()).questions).toEqual([]);
    expect(await QuestionUsageModel.countDocuments()).toBe(0);
    expect(
      (await library.get(ownerId, lib.question.libraryQuestionId)).version
        .frozenAt,
    ).toBeNull();
  });
  it("rolls back replacement/detachment and save-to-library records on transaction failure", async () => {
    const lib = await createLibrary(),
      r = await adopt(lib),
      q = r.body.version.questions[0],
      v2 = await newer(lib);
    const faulty = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
      undefined,
      {
        afterQuestionUsagesChanged: () => {
          throw Error("rollback");
        },
      },
    );
    await expect(
      faulty.addLibraryQuestion(
        ownerId,
        surveyId,
        versionId,
        { revision: r.body.version.revision, ...selection(v2) },
        q.questionId,
      ),
    ).rejects.toThrow("rollback");
    await expect(
      faulty.detachLibraryQuestion(
        ownerId,
        surveyId,
        versionId,
        q.questionId,
        r.body.version.revision,
      ),
    ).rejects.toThrow("rollback");
    expect((await current()).questions[0]!.source).toEqual(q.source);
    expect(
      await QuestionUsageModel.countDocuments({
        questionVersionId: lib.version.questionVersionId,
      }),
    ).toBe(1);
    expect(
      (
        await library.get(
          ownerId,
          v2.question.libraryQuestionId,
          v2.version.questionVersionId,
        )
      ).version.frozenAt,
    ).toBeNull();
    const b = await local(),
      count = await LibraryQuestionModel.countDocuments();
    await expect(
      faulty.saveQuestionToLibrary(
        ownerId,
        surveyId,
        versionId,
        b.questionId,
        b.version.revision,
      ),
    ).rejects.toThrow("rollback");
    expect(await LibraryQuestionModel.countDocuments()).toBe(count);
  });
  it("rolls back usage state and next-draft rows on lifecycle failure", async () => {
    await adopt(await createLibrary());
    const faultyPublish = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
      undefined,
      {
        afterVersionPublished: () => {
          throw Error("publish rollback");
        },
      },
    );
    await expect(
      faultyPublish.publish(
        ownerId,
        surveyId,
        versionId,
        (await current()).revision,
        true,
      ),
    ).rejects.toThrow("publish rollback");
    expect(await QuestionUsageModel.countDocuments({ status: "draft" })).toBe(
      1,
    );
    expect((await current()).status).toBe("draft");
    await publish();
    const faultyCopy = new SurveyService(
      env,
      new SurveyCursorService(env.jwtSecret),
      undefined,
      {
        afterVersionCreated: () => {
          throw Error("copy rollback");
        },
      },
    );
    await expect(
      faultyCopy.createNextVersion(ownerId, surveyId, versionId),
    ).rejects.toThrow("copy rollback");
    expect(await QuestionUsageModel.countDocuments()).toBe(1);
    expect(await SurveyVersionModel.countDocuments()).toBe(1);
  });
  it("serializes two draft insertions with the same revision without orphan projection rows", async () => {
    const lib = await createLibrary();
    const result = await Promise.all(
      [1, 2].map(() =>
        auth(request(app).post(`${root()}/library-questions`)).send({
          revision: 1,
          ...selection(lib),
        }),
      ),
    );
    expect(result.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await current()).questions).toHaveLength(1);
    expect(await QuestionUsageModel.countDocuments()).toBe(1);
  });
  it("makes original editing and first adoption contend on the source version", async () => {
    const lib = await createLibrary();
    const edit = auth(
      request(app).patch(
        `/api/questions/${lib.question.libraryQuestionId}/versions/${lib.version.questionVersionId}`,
      ),
    ).send({ ...lib.version.definition, type: undefined, contentRevision: 1 });
    const results = await Promise.all([
      edit,
      auth(request(app).post(`${root()}/library-questions`)).send({
        revision: 1,
        ...selection(lib),
      }),
    ]);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 200 || r.status === 201),
    ).toHaveLength(1);
    if (results[1]!.status === 201) {
      expect((await current()).questions[0]!.source!.contentRevision).toBe(1);
      expect(
        (await library.get(ownerId, lib.question.libraryQuestionId)).version
          .frozenAt,
      ).not.toBeNull();
    } else {
      expect(await QuestionUsageModel.countDocuments()).toBe(0);
      expect(
        (await library.get(ownerId, lib.question.libraryQuestionId)).version
          .contentRevision,
      ).toBe(2);
    }
  });
  it("preserves an old fill session, published snapshot and version statistics after a new source version is published", async () => {
    const lib = await createLibrary(),
      r = await adopt(lib),
      oldQuestion = r.body.version.questions[0];
    const published = await publish();
    const oldSnapshot = await SurveyVersionModel.findById(versionId).lean();
    const start = await auth(
      request(app).post(
        `/api/public/surveys/${published.survey.publicId}/sessions`,
      ),
      otherId,
    )
      .send({})
      .expect(201);
    expect(JSON.stringify(start.body)).not.toContain("libraryQuestionId");
    const headers = start.headers["set-cookie"]!,
      fillCookie = (Array.isArray(headers) ? headers[0]! : headers).split(
        ";",
      )[0]!;
    const v2 = await newer(lib),
      draft = await surveys.createNextVersion(ownerId, surveyId, versionId);
    const changed = await surveys.addLibraryQuestion(
      ownerId,
      surveyId,
      draft.version.id,
      { revision: 1, ...selection(v2) },
      oldQuestion.questionId,
    );
    await surveys.publish(
      ownerId,
      surveyId,
      draft.version.id,
      changed.version.revision,
      true,
    );
    const submit = await request(app)
      .post(`/api/public/sessions/${start.body.session.id}/submit`)
      .set("Origin", origin)
      .set("Cookie", [cookie(otherId), fillCookie])
      .send({
        answers: [
          {
            questionId: oldQuestion.questionId,
            value: oldQuestion.options[0].optionId,
          },
        ],
      })
      .expect(201);
    expect(submit.body).not.toHaveProperty("source");
    expect(await SurveyVersionModel.findById(versionId).lean()).toEqual(
      oldSnapshot,
    );
    expect(
      await SurveyResponseModel.countDocuments({ surveyVersionId: versionId }),
    ).toBe(1);
    const oldStats = await auth(
      request(app).get(`${root()}/statistics`),
    ).expect(200);
    expect(oldStats.body.submissionCount).toBe(1);
    const newStats = await auth(
      request(app).get(
        `/api/surveys/${surveyId}/versions/${draft.version.id}/statistics`,
      ),
    ).expect(200);
    expect(newStats.body.submissionCount).toBe(0);
  });
});
