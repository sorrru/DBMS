import { SurveyVersionModel } from "../src/models/survey-version.js";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { env } from "../src/config/env.js";
import { LibraryStatisticsService } from "../src/library-statistics/service.js";
import { parseLibraryStatistics } from "../src/library-statistics/validation.js";
import { summaryPipeline } from "../src/library-statistics/pipelines.js";
import { LibrarySharingService } from "../src/library/sharing.js";
import { LibraryCursor } from "../src/library/cursor.js";
import { UserModel } from "../src/models/user.js";
import { QuestionUsageModel } from "../src/models/question-usage.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { createApp } from "../src/app.js";
import { TokenService } from "../src/security/token.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { PasswordService } from "../src/security/password.js";
import { sessionCookieName } from "../src/http/cookies.js";
import { assertSafeTestDatabase } from "./database-safety.js";
import {
  library,
  surveys,
  cleanStatisticsFixtures,
  createQuestion,
  createSurvey,
  addResponse,
} from "./library-statistics-fixtures.js";
const stats = new LibraryStatisticsService(env.jwtSecret, 10000),
  sharing = new LibrarySharingService(new LibraryCursor(env.jwtSecret)),
  tokens = new TokenService(env.jwtSecret),
  limits = new FixedWindowStore(1000);
const app = createApp({
  env,
  tokens,
  rateLimits: limits,
  passwords: new PasswordService(),
});
let owner: Types.ObjectId, student: Types.ObjectId;
const query = (ids: string[], extra: Record<string, unknown> = {}) =>
  parseLibraryStatistics({ questionVersionIds: ids, ...extra });
const auth = (r: request.Test, user = owner) =>
  r
    .set("Origin", env.webOrigin)
    .set("Cookie", `${sessionCookieName}=${tokens.sign(user.toString())}`);
beforeAll(async () => {
  assertSafeTestDatabase(env.mongoUri);
  await mongoose.connect(env.mongoUri);
  await surveys.ensureIndexes();
  await SurveyResponseModel.init();
  await UserModel.init();
});
beforeEach(async () => {
  await cleanStatisticsFixtures();
  await UserModel.deleteMany({});
  limits.reset();
  const users = await UserModel.create(
    ["teacher", "student"].map((name) => ({
      username: name,
      usernameNormalized: name,
      passwordHash: "unused",
      registeredAt: new Date(),
    })),
  );
  owner = users[0]!._id;
  student = users[1]!._id;
});
afterAll(async () => {
  await cleanStatisticsFixtures();
  await UserModel.deleteMany({});
  await mongoose.disconnect();
  limits.dispose();
});
it("aggregates age across surveys with separate and explicitly merged versions and bucket boundaries", async () => {
  const lib = await createQuestion(owner),
    a = await createSurvey(owner, [lib.version]);
  const next = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    { ...lib.version.definition, title: "周岁年龄" },
  );
  const b = await createSurvey(owner, [next.version]);
  for (const value of [-1, 0, 17, 18]) await addResponse(a, [value]);
  for (const value of [30, 60, 120, 130]) await addResponse(b, [value]);
  const ids = [lib.version.questionVersionId, next.version.questionVersionId];
  const separate = await stats.query(
    owner,
    lib.question.libraryQuestionId,
    query(ids),
  );
  expect(separate.groups).toHaveLength(2);
  expect(separate.groups.map((g) => g.number!.count)).toEqual([4, 4]);
  const merged = await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query(ids, { merge: true, confirmMerge: true }),
    ),
    g = merged.groups[0]!;
  expect(g.number).toMatchObject({
    count: 8,
    sum: 374,
    minimum: -1,
    maximum: 130,
    average: 46.75,
  });
  expect(g.number!.buckets.map((b) => b.count)).toEqual([1, 2, 1, 1, 0, 1, 2]);
  expect(g.sourceCount).toBe(2);
  expect(g.surveyCount).toBe(2);
});
it("counts repeated instances as opportunities and distinguishes skipped versus unanswered", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, [lib.version, lib.version]);
  await addResponse(s, [20, 40]);
  await addResponse(s, [undefined, undefined], [s.questions[0]!.questionId]);
  const g = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    )
  ).groups[0]!;
  expect(g).toMatchObject({
    opportunityCount: 4,
    reachedCount: 3,
    answeredCount: 2,
    notReachedCount: 1,
    unansweredReachedCount: 1,
    answerRate: 2 / 3,
    reachRate: 0.75,
  });
  expect(g.number).toMatchObject({ count: 2, sum: 60, average: 30 });
});
it("maps different instance option IDs to stable source IDs and preserves renamed labels", async () => {
  const lib = await createQuestion(owner, "single"),
    a = await createSurvey(owner, [lib.version]);
  const next = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    {
      ...lib.version.definition,
      options: lib.version.definition.options.map((o, i) => ({
        ...o,
        text: i ? o.text : "A改名",
      })),
    },
  );
  const b = await createSurvey(owner, [next.version]);
  expect(a.questions[0]!.options[0]!.optionId).not.toBe(
    b.questions[0]!.options[0]!.optionId,
  );
  await addResponse(a, [a.questions[0]!.options[0]!.optionId]);
  await addResponse(b, [b.questions[0]!.options[0]!.optionId]);
  const g = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId, next.version.questionVersionId], {
        merge: true,
        confirmMerge: true,
      }),
    )
  ).groups[0]!;
  expect(
    g.options.find(
      (o) => o.optionId === lib.version.definition.options[0]!.optionId,
    ),
  ).toMatchObject({ count: 2, percentageOfAnswered: 1 });
  expect(new Set(g.options[0]!.labels)).toEqual(new Set(["A", "A改名"]));
});
it("uses answered instances as the denominator for multiple selections", async () => {
  const lib = await createQuestion(owner, "multiple"),
    s = await createSurvey(owner, [lib.version]);
  const ids = s.questions[0]!.options.map((o) => o.optionId);
  await addResponse(s, [ids]);
  await addResponse(s, [[ids[0]!]]);
  await addResponse(s, [undefined]);
  const g = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    )
  ).groups[0]!;
  expect(g.answeredCount).toBe(2);
  expect(g.options.map((o) => o.count)).toEqual([2, 1]);
  expect(g.options.map((o) => o.percentageOfAnswered)).toEqual([1, 0.5]);
});
it("keeps zero answers distinct from zero-valued numeric answers", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, [lib.version]);
  let g = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    )
  ).groups[0]!;
  expect(g.number).toMatchObject({
    count: 0,
    sum: 0,
    average: null,
    minimum: null,
    maximum: null,
  });
  await addResponse(s, [0]);
  g = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    )
  ).groups[0]!;
  expect(g.number).toMatchObject({
    count: 1,
    sum: 0,
    average: 0,
    minimum: 0,
    maximum: 0,
  });
});
it("does not grant owners access to recipients' answers and preserves recipients' own stats after revocation", async () => {
  const lib = await createQuestion(owner);
  await sharing.grant(owner, lib.question.libraryQuestionId, {
    usernames: ["student"],
    questionVersionIds: [lib.version.questionVersionId],
  });
  const s = await createSurvey(student, [lib.version]);
  await addResponse(s, [88]);
  expect(
    (await stats.catalog(owner, lib.question.libraryQuestionId)).versions,
  ).toEqual([]);
  await expect(
    stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    ),
  ).rejects.toMatchObject({ status: 400 });
  const grant = (
    await sharing.listGrants(owner, lib.question.libraryQuestionId, 20)
  ).items[0]!;
  await sharing.revoke(owner, lib.question.libraryQuestionId, grant.shareId);
  expect(
    (
      await stats.query(
        student,
        lib.question.libraryQuestionId,
        query([lib.version.questionVersionId]),
      )
    ).groups[0]!.number!.sum,
  ).toBe(88);
  const foreign = await createQuestion(owner);
  await expect(
    stats.catalog(student, foreign.question.libraryQuestionId),
  ).rejects.toMatchObject({ status: 404 });
});
it("verifies real survey ownership and snapshot sources even if the usage projection is forged", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, [lib.version]);
  await addResponse(s, [99]);
  await QuestionUsageModel.updateMany({}, { $set: { ownerId: student } });
  await sharing.grant(owner, lib.question.libraryQuestionId, {
    usernames: ["student"],
    questionVersionIds: [lib.version.questionVersionId],
  });
  expect(
    (await stats.catalog(student, lib.question.libraryQuestionId)).versions,
  ).toEqual([]);
  await QuestionUsageModel.updateMany(
    {},
    { $set: { ownerId: owner, questionVersionId: new Types.ObjectId() } },
  );
  expect(
    (await stats.catalog(owner, lib.question.libraryQuestionId)).versions,
  ).toEqual([]);
});
it("excludes drafts and unrelated local questions, retaining prior published versions", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, [lib.version]);
  await addResponse(s, [5]);
  await surveys.createNextVersion(owner, s.surveyId, s.versionId);
  const catalog = await stats.catalog(owner, lib.question.libraryQuestionId);
  expect(catalog.sourceCount).toBe(1);
  expect(
    (
      await stats.query(
        owner,
        lib.question.libraryQuestionId,
        query([lib.version.questionVersionId]),
      )
    ).groups[0]!.answeredCount,
  ).toBe(1);
});
it("pages text with tied timestamps, duplicate instances, encrypted bound cursors and minimal fields", async () => {
  const lib = await createQuestion(owner, "text"),
    s = await createSurvey(owner, [lib.version, lib.version]);
  await addResponse(s, ["<img src=x>", "第二条"]);
  await addResponse(s, ["第三条", "第四条"]);
  const input = query([lib.version.questionVersionId], { limit: 1 }),
    rows: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await stats.query(owner, lib.question.libraryQuestionId, {
      ...input,
      ...(cursor ? { cursor } : {}),
    });
    const row = result.text!.items[0]!;
    rows.push(row.value);
    expect(Object.keys(row).sort()).toEqual([
      "questionVersionId",
      "submittedDate",
      "value",
    ]);
    expect(row.submittedDate).toBe("2026-10-22");
    cursor = result.text!.nextCursor ?? undefined;
  } while (cursor);
  expect(new Set(rows).size).toBe(4);
  const first = await stats.query(owner, lib.question.libraryQuestionId, input),
    token = first.text!.nextCursor!;
  expect(token.split(".")).toHaveLength(3);
  await expect(
    stats.query(owner, lib.question.libraryQuestionId, {
      ...input,
      limit: 2,
      cursor: token,
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    stats.query(owner, lib.question.libraryQuestionId, {
      ...input,
      cursor: token + "x",
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("rejects invalid versions, unconfirmed merge, bad buckets, unknown fields and oversized selections", async () => {
  const lib = await createQuestion(owner);
  for (const extra of [
    {
      merge: true,
      questionVersionIds: [
        lib.version.questionVersionId,
        new Types.ObjectId().toString(),
      ],
    },
    { boundaries: [0, 0] },
    { boundaries: [1, 0] },
    { boundaries: [0, Infinity] },
    { boundaries: [0] },
    { boundaries: Array.from({ length: 32 }, (_, i) => i) },
    { questionVersionIds: Array(51).fill(lib.version.questionVersionId) },
    { questionVersionIds: [] },
    { ownerId: owner.toString() },
    { limit: 0 },
    { merge: "true" },
  ])
    expect(() => query([lib.version.questionVersionId], extra)).toThrow();
  await createSurvey(owner, [lib.version]);
  await expect(
    stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([new Types.ObjectId().toString()]),
    ),
  ).rejects.toMatchObject({ status: 400 });
});
it("authenticates HTTP statistics, requires origin and JSON, and disables caching", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, [lib.version]);
  await addResponse(s, [18]);
  const root = `/api/questions/${lib.question.libraryQuestionId}/statistics`;
  await request(app).get(`${root}/sources`).expect(401);
  const catalog = await auth(request(app).get(`${root}/sources`)).expect(200);
  expect(catalog.headers["cache-control"]).toBe("no-store");
  await request(app)
    .post(`${root}/query`)
    .send(query([lib.version.questionVersionId]))
    .expect(403);
  const r = await auth(request(app).post(`${root}/query`))
    .send(query([lib.version.questionVersionId]))
    .expect(200);
  expect(r.body.groups[0].number.sum).toBe(18);
  await auth(request(app).get(`${root}/sources`), student).expect(404);
});
it("maintains one snapshot across source batches when a response arrives mid-query", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, Array(51).fill(lib.version));
  await addResponse(s, Array(51).fill(1));
  let inserted = false;
  const concurrent = new LibraryStatisticsService(env.jwtSecret, 10000, {
    afterBatch: async () => {
      if (!inserted) {
        inserted = true;
        await addResponse(s, Array(51).fill(2));
      }
    },
  });
  const g = (
    await concurrent.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    )
  ).groups[0]!;
  expect(g.answeredCount).toBe(51);
  expect(g.number!.sum).toBe(51);
  const after = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId]),
    )
  ).groups[0]!;
  expect(after.answeredCount).toBe(102);
  expect(after.number!.sum).toBe(153);
});
it("filters responses by indexed surveyVersionId before expansion without response lookups", async () => {
  const lib = await createQuestion(owner),
    s = await createSurvey(owner, [lib.version]);
  await addResponse(s, [20]);
  const pipeline = summaryPipeline(
    [
      {
        surveyId: s.surveyId,
        surveyVersionId: s.versionId,
        questionId: s.questions[0]!.questionId,
        questionVersionId: lib.version.questionVersionId,
        versionNumber: 1,
        definition: lib.version.definition,
        optionSources: [],
      },
    ],
    false,
    "number",
    [0, 18, 60],
  );
  expect(JSON.stringify(pipeline)).not.toContain("$lookup");
  expect(pipeline[0]).toHaveProperty("$match.surveyVersionId");
  const explain = await SurveyResponseModel.aggregate(pipeline)
    .hint({ surveyVersionId: 1, submittedAt: -1, _id: -1 })
    .explain("executionStats");
  expect(JSON.stringify(explain)).toContain("IXSCAN");
});
it("does not merge new option identities merely because their visible text matches", async () => {
  const lib = await createQuestion(owner, "single"),
    first = await createSurvey(owner, [lib.version]);
  const next = await library.branch(
    owner,
    lib.question.libraryQuestionId,
    lib.version.questionVersionId,
    1,
    {
      ...lib.version.definition,
      options: [{ text: "A" }, lib.version.definition.options[1]!],
    },
  );
  const second = await createSurvey(owner, [next.version]);
  await addResponse(first, [first.questions[0]!.options[0]!.optionId]);
  await addResponse(second, [second.questions[0]!.options[0]!.optionId]);
  const g = (
    await stats.query(
      owner,
      lib.question.libraryQuestionId,
      query([lib.version.questionVersionId, next.version.questionVersionId], {
        merge: true,
        confirmMerge: true,
      }),
    )
  ).groups[0]!;
  expect(
    g.options.filter((o) => o.labels.includes("A")).map((o) => o.count),
  ).toEqual([1, 1]);
});

it("keeps text cursor tie ordering consistent with MongoDB binary ordering", async () => {
  const lib = await createQuestion(owner, "text"),
    s = await createSurvey(owner, [lib.version, lib.version, lib.version]);
  const names = ["q_A", "q_a", "q_-"];
  for (let i = 0; i < s.questions.length; i++) {
    const old = s.questions[i]!.questionId;
    await QuestionUsageModel.updateOne(
      { surveyVersionId: s.versionId, questionId: old },
      { $set: { questionId: names[i] } },
    );
    s.questions[i]!.questionId = names[i]!;
  }
  await SurveyVersionModel.updateOne(
    { _id: s.versionId },
    { $set: { questions: s.questions } },
  );
  await addResponse(s, ["upper", "lower", "dash"]);
  const input = query([lib.version.questionVersionId], { limit: 1 }),
    values: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await stats.query(owner, lib.question.libraryQuestionId, {
      ...input,
      ...(cursor ? { cursor } : {}),
    });
    values.push(...page.text!.items.map((i) => i.value));
    cursor = page.text!.nextCursor ?? undefined;
  } while (cursor);
  expect(values).toEqual(["lower", "upper", "dash"]);
});
