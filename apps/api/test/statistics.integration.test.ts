import mongoose, { Types } from "mongoose";
import request, { type Response } from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { sessionCookieName } from "../src/http/cookies.js";
import { SurveyResponseModel } from "../src/models/response.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { UserModel } from "../src/models/user.js";
import { PasswordService } from "../src/security/password.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { TokenService } from "../src/security/token.js";
import { StatisticsCursorService } from "../src/statistics/cursor.js";
import { StatisticsService } from "../src/statistics/service.js";
import type { SurveyQuestion } from "../src/surveys/questions.js";
import { assertSafeTestDatabase } from "./database-safety.js";

const testEnv = {
  ...env,
  mongoUri: process.env.MONGODB_URI!,
  statisticsRateLimitUserMax: 100,
  statisticsMaxTimeMs: 10_000,
};
const tokens = new TokenService(testEnv.jwtSecret);
const rateLimits = new FixedWindowStore(1_000);
const now = new Date("2027-01-10T00:00:00.000Z");
const app = createApp(
  {
    env: testEnv,
    passwords: new PasswordService(
      { N: 1_024, r: 8, p: 1, maxmem: 8_388_608, saltBytes: 16, keyBytes: 32 },
      "",
    ),
    tokens,
    rateLimits,
  },
  () => new Date(now),
);

let ownerId: Types.ObjectId;
let otherId: Types.ObjectId;
let surveyId: Types.ObjectId;
let versionId: Types.ObjectId;
const cookie = (userId: Types.ObjectId) =>
  `${sessionCookieName}=${tokens.sign(userId.toString())}`;

function expectNoKeys(value: unknown, forbidden: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) expectNoKeys(item, forbidden);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(forbidden.has(key), `response leaked key ${key}`).toBe(false);
    expectNoKeys(child, forbidden);
  }
}

const questions: SurveyQuestion[] = [
  {
    questionId: "q_single",
    type: "single",
    title: "选择",
    required: true,
    validation: {},
    options: [
      { optionId: "o_a", text: "A" },
      { optionId: "o_b", text: "B" },
    ],
    jumpRules: [],
  },
  {
    questionId: "q_text",
    type: "text",
    title: "意见",
    required: false,
    validation: { minLength: 0, maxLength: 2000, digitsOnly: false },
    options: [],
    jumpRules: [],
  },
  {
    questionId: "q_multi",
    type: "multiple",
    title: "多选",
    required: false,
    validation: { minSelections: 1, maxSelections: 2 },
    options: [
      { optionId: "o_x", text: "X" },
      { optionId: "o_y", text: "Y" },
    ],
    jumpRules: [],
  },
  {
    questionId: "q_num",
    type: "number",
    title: "分数",
    required: false,
    validation: { integerOnly: false, minValue: null, maxValue: null },
    options: [],
    jumpRules: [],
  },
];

async function response(
  submittedAt: string,
  path: string[],
  answers: Array<{ questionId: string; value: string | string[] | number }>,
  respondentId?: Types.ObjectId,
  targetVersionId = versionId,
) {
  return SurveyResponseModel.create({
    surveyId,
    surveyVersionId: targetVersionId,
    fillSessionId: new Types.ObjectId(),
    ownerKey: `owner-${new Types.ObjectId()}`,
    questionPath: path,
    ignoredQuestionIds: [],
    answers,
    submittedAt: new Date(submittedAt),
    ...(respondentId ? { respondentId } : {}),
  });
}

async function seedResponses() {
  await response(
    "2027-01-01T01:02:03.111Z",
    ["q_single", "q_text", "q_multi", "q_num"],
    [
      { questionId: "q_single", value: "o_a" },
      { questionId: "q_text", value: "第一条\n回答" },
      { questionId: "q_multi", value: ["o_x", "o_y"] },
      { questionId: "q_num", value: 1 },
    ],
  );
  await response(
    "2027-01-02T02:03:04.222Z",
    ["q_single", "q_multi", "q_num"],
    [
      { questionId: "q_single", value: "o_b" },
      { questionId: "q_multi", value: ["o_x"] },
      { questionId: "q_num", value: 3 },
    ],
  );
  await response(
    "2027-01-03T03:04:05.333Z",
    ["q_single", "q_text", "q_multi", "q_num"],
    [
      { questionId: "q_single", value: "o_a" },
      { questionId: "q_text", value: "第三条" },
    ],
  );
}

beforeAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  await mongoose.connect(testEnv.mongoUri);
  await Promise.all([
    UserModel.init(),
    SurveyModel.init(),
    SurveyVersionModel.init(),
    SurveyResponseModel.init(),
  ]);
});

beforeEach(async () => {
  rateLimits.reset();
  await Promise.all([
    SurveyResponseModel.deleteMany({}),
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
  const owner = await UserModel.create({
    username: "statistics_owner",
    usernameNormalized: "statistics_owner",
    passwordHash: "unused",
    registeredAt: now,
  });
  const other = await UserModel.create({
    username: "statistics_other",
    usernameNormalized: "statistics_other",
    passwordHash: "unused",
    registeredAt: now,
  });
  ownerId = owner._id;
  otherId = other._id;
  surveyId = new Types.ObjectId();
  versionId = new Types.ObjectId();
  await SurveyModel.create({
    _id: surveyId,
    ownerId,
    publicId: `stats_${surveyId}`,
    internalName: "统计样例",
    manualStatus: "open",
    currentVersionId: versionId,
    draftVersionId: null,
  });
  await SurveyVersionModel.create({
    _id: versionId,
    surveyId,
    versionNumber: 1,
    status: "published",
    revision: 5,
    title: "统计样例",
    description: "",
    identityMode: "anonymous",
    allowMultipleSubmissions: true,
    deadline: null,
    sessionDurationMinutes: 30,
    questions,
    schemaVersion: 1,
    publishedAt: now,
  });
  await seedResponses();
});

afterAll(async () => {
  rateLimits.dispose();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("creator statistics", () => {
  it("returns hand-checkable aggregates and no-store", async () => {
    const result = await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
      .set("Cookie", cookie(ownerId))
      .expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toMatchObject({
      identityMode: "anonymous",
      submissionCount: 3,
      generatedAt: now.toISOString(),
      questions: [
        {
          questionId: "q_single",
          reachedCount: 3,
          answeredCount: 3,
          notReachedCount: 0,
          options: [
            { optionId: "o_a", count: 2, percentageOfAnswered: 2 / 3 },
            { optionId: "o_b", count: 1, percentageOfAnswered: 1 / 3 },
          ],
        },
        {
          questionId: "q_text",
          reachedCount: 2,
          answeredCount: 2,
          notReachedCount: 1,
        },
        {
          questionId: "q_multi",
          answeredCount: 2,
          options: [
            { optionId: "o_x", count: 2 },
            { optionId: "o_y", count: 1 },
          ],
        },
        {
          questionId: "q_num",
          answeredCount: 2,
          number: { count: 2, average: 2, minimum: 1, maximum: 3 },
        },
      ],
    });
    expectNoKeys(
      result.body,
      new Set(["ownerKey", "dedupKey", "fillSessionId", "respondentKey"]),
    );
  });

  it("returns null number extrema when there is no numeric answer", async () => {
    await SurveyResponseModel.updateMany(
      {},
      { $pull: { answers: { questionId: "q_num" } } },
    );
    const result = await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
      .set("Cookie", cookie(ownerId))
      .expect(200);
    expect(result.body.questions[3].number).toEqual({
      count: 0,
      average: null,
      minimum: null,
      maximum: null,
    });
  });

  it("keeps totals, options, and text responses isolated between versions", async () => {
    const secondVersionId = new Types.ObjectId();
    await SurveyVersionModel.create({
      _id: secondVersionId,
      surveyId,
      versionNumber: 2,
      status: "published",
      revision: 1,
      title: "统计样例 v2",
      description: "",
      identityMode: "anonymous",
      allowMultipleSubmissions: true,
      deadline: null,
      sessionDurationMinutes: 30,
      questions,
      schemaVersion: 1,
      publishedAt: now,
    });
    await SurveyModel.updateOne(
      { _id: surveyId },
      { currentVersionId: secondVersionId },
    );
    await response(
      "2027-01-04T04:05:06.444Z",
      ["q_single", "q_text", "q_multi", "q_num"],
      [
        { questionId: "q_single", value: "o_b" },
        { questionId: "q_text", value: "只属于第二版" },
        { questionId: "q_num", value: 99 },
      ],
      undefined,
      secondVersionId,
    );
    const [firstStats, secondStats, firstText, secondText] = await Promise.all([
      request(app)
        .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
        .set("Cookie", cookie(ownerId)),
      request(app)
        .get(`/api/surveys/${surveyId}/versions/${secondVersionId}/statistics`)
        .set("Cookie", cookie(ownerId)),
      request(app)
        .get(
          `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_text`,
        )
        .set("Cookie", cookie(ownerId)),
      request(app)
        .get(
          `/api/surveys/${surveyId}/versions/${secondVersionId}/responses?questionId=q_text`,
        )
        .set("Cookie", cookie(ownerId)),
    ]);
    expect([
      firstStats.status,
      secondStats.status,
      firstText.status,
      secondText.status,
    ]).toEqual([200, 200, 200, 200]);
    expect(firstStats.body.submissionCount).toBe(3);
    expect(firstStats.body.questions[0].options).toMatchObject([
      { optionId: "o_a", count: 2 },
      { optionId: "o_b", count: 1 },
    ]);
    expect(
      firstText.body.items.map((item: { value: string }) => item.value),
    ).toEqual(["第三条", "第一条\n回答"]);
    expect(secondStats.body.submissionCount).toBe(1);
    expect(secondStats.body.questions[0].options).toMatchObject([
      { optionId: "o_a", count: 0 },
      { optionId: "o_b", count: 1 },
    ]);
    expect(secondStats.body.questions[3].number).toMatchObject({
      count: 1,
      average: 99,
      minimum: 99,
      maximum: 99,
    });
    expect(secondText.body.items).toEqual([
      { value: "只属于第二版", submittedDate: "2027-01-04" },
    ]);
  });

  it("paginates anonymous text without exact time, ids, or readable cursor data", async () => {
    const first = await request(app)
      .get(
        `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_text&limit=1`,
      )
      .set("Cookie", cookie(ownerId))
      .expect(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body.items).toEqual([
      { value: "第三条", submittedDate: "2027-01-03" },
    ]);
    expectNoKeys(
      first.body,
      new Set([
        "ownerKey",
        "dedupKey",
        "fillSessionId",
        "respondentKey",
        "respondentId",
        "submittedAt",
        "id",
      ]),
    );
    const cursor = first.body.nextCursor as string;
    expect(() =>
      JSON.parse(Buffer.from(cursor, "base64url").toString()),
    ).toThrow();
    expect(cursor).not.toContain("2027-01-03");
    const second = await request(app)
      .get(
        `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_text&limit=1&cursor=${encodeURIComponent(cursor)}`,
      )
      .set("Cookie", cookie(ownerId))
      .expect(200);
    expect(second.body.items[0].value).toBe("第一条\n回答");
    expect(second.body.nextCursor).toBeNull();
  });

  it("returns identified text respondents while querying users in one batch", async () => {
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { identityMode: "identified" },
    );
    await SurveyResponseModel.updateMany(
      { surveyVersionId: versionId },
      { respondentId: otherId },
    );
    const userQueries = vi.spyOn(UserModel, "find");
    let result: Response;
    try {
      result = await request(app)
        .get(
          `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_text&limit=20`,
        )
        .set("Cookie", cookie(ownerId))
        .expect(200);
      expect(userQueries).toHaveBeenCalledTimes(1);
    } finally {
      userQueries.mockRestore();
    }
    expect(result.body.identityMode).toBe("identified");
    expect(result.body.items).toEqual([
      {
        value: "第三条",
        submittedAt: "2027-01-03T03:04:05.333Z",
        respondent: { id: otherId.toString(), username: "statistics_other" },
      },
      {
        value: "第一条\n回答",
        submittedAt: "2027-01-01T01:02:03.111Z",
        respondent: { id: otherId.toString(), username: "statistics_other" },
      },
    ]);
    expectNoKeys(
      result.body,
      new Set(["ownerKey", "dedupKey", "fillSessionId", "respondentKey"]),
    );
  });

  it("lists every identified submission even when no text answer exists", async () => {
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { identityMode: "identified" },
    );
    await SurveyResponseModel.updateMany(
      { surveyVersionId: versionId },
      { respondentId: otherId },
    );
    const userQueries = vi.spyOn(UserModel, "find");
    let first: Response;
    try {
      first = await request(app)
        .get(
          `/api/surveys/${surveyId}/versions/${versionId}/submissions?limit=2`,
        )
        .set("Cookie", cookie(ownerId))
        .expect(200);
      expect(userQueries).toHaveBeenCalledTimes(1);
    } finally {
      userQueries.mockRestore();
    }
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toMatchObject({
      identityMode: "identified",
      items: [
        {
          submittedAt: "2027-01-03T03:04:05.333Z",
          respondent: {
            id: otherId.toString(),
            username: "statistics_other",
          },
        },
        {
          submittedAt: "2027-01-02T02:03:04.222Z",
          respondent: {
            id: otherId.toString(),
            username: "statistics_other",
          },
        },
      ],
    });
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(app)
      .get(
        `/api/surveys/${surveyId}/versions/${versionId}/submissions?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )
      .set("Cookie", cookie(ownerId))
      .expect(200);
    expect(second.body.items).toEqual([
      {
        submittedAt: "2027-01-01T01:02:03.111Z",
        respondent: {
          id: otherId.toString(),
          username: "statistics_other",
        },
      },
    ]);
    expect(second.body.nextCursor).toBeNull();
    expectNoKeys(
      first.body,
      new Set(["ownerKey", "dedupKey", "fillSessionId", "respondentKey"]),
    );
  });

  it("never exposes a submission identity list for anonymous versions", async () => {
    const result = await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/submissions`)
      .set("Cookie", cookie(ownerId))
      .expect(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/submissions?extra=1`)
      .set("Cookie", cookie(ownerId))
      .expect(400);
    await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/submissions`)
      .set("Cookie", cookie(otherId))
      .expect(404);
  });

  it("rejects drafts, invalid queries, cross-owner access, and cursor reuse", async () => {
    await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics?extra=1`)
      .set("Cookie", cookie(ownerId))
      .expect(400);
    for (const limit of ["0", "51", "1.5"])
      await request(app)
        .get(
          `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_text&limit=${limit}`,
        )
        .set("Cookie", cookie(ownerId))
        .expect(400);
    await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
      .set("Cookie", cookie(otherId))
      .expect(404);
    await request(app)
      .get(
        `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_single`,
      )
      .set("Cookie", cookie(ownerId))
      .expect(400);
    await request(app)
      .get(
        `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_missing`,
      )
      .set("Cookie", cookie(ownerId))
      .expect(404);
    await SurveyVersionModel.updateOne(
      { _id: versionId },
      { status: "draft", publishedAt: null },
    );
    const draft = await request(app)
      .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
      .set("Cookie", cookie(ownerId))
      .expect(409);
    expect(draft.body.error.code).toBe("VERSION_NOT_PUBLISHED");
  });

  it("shares a configurable per-user rate limit across both read endpoints", async () => {
    testEnv.statisticsRateLimitUserMax = 1;
    try {
      await request(app)
        .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
        .set("Cookie", cookie(ownerId))
        .expect(200);
      const limited = await request(app)
        .get(
          `/api/surveys/${surveyId}/versions/${versionId}/responses?questionId=q_text`,
        )
        .set("Cookie", cookie(ownerId))
        .expect(429);
      expect(limited.body.error.code).toBe("RATE_LIMITED");
      expect(limited.headers["retry-after"]).toBeDefined();
    } finally {
      testEnv.statisticsRateLimitUserMax = 100;
      rateLimits.reset();
    }
  });

  it("keeps all pipelines on one snapshot when a response arrives between them", async () => {
    let inserted = false;
    const service = new StatisticsService(
      testEnv,
      new StatisticsCursorService(testEnv.jwtSecret),
      {
        afterPipeline: async (name) => {
          if (name !== "total" || inserted) return;
          inserted = true;
          await response(
            "2027-01-04T00:00:00.000Z",
            ["q_single", "q_text", "q_multi", "q_num"],
            [
              { questionId: "q_single", value: "o_b" },
              { questionId: "q_text", value: "late" },
            ],
          );
        },
      },
      () => new Date(now),
    );
    const result = await service.statistics(
      ownerId,
      surveyId.toString(),
      versionId.toString(),
    );
    expect(result.submissionCount).toBe(3);
    expect(
      result.questions.every((q) => q.answeredCount <= q.reachedCount),
    ).toBe(true);
    expect(
      result.questions.every((q) => q.reachedCount <= result.submissionCount),
    ).toBe(true);
    expect(
      await SurveyResponseModel.countDocuments({ surveyVersionId: versionId }),
    ).toBe(4);
  });

  it("maps an aggregate timeout to a stable 503 error", async () => {
    const aggregate = vi
      .spyOn(SurveyResponseModel, "aggregate")
      .mockReturnValue({
        session() {
          return this;
        },
        option() {
          return this;
        },
        exec() {
          return Promise.reject(
            Object.assign(new Error("forced timeout"), {
              code: 50,
              codeName: "MaxTimeMSExpired",
            }),
          );
        },
      } as never);
    try {
      const result = await request(app)
        .get(`/api/surveys/${surveyId}/versions/${versionId}/statistics`)
        .set("Cookie", cookie(ownerId))
        .expect(503);
      expect(result.body.error.code).toBe("STATISTICS_UNAVAILABLE");
    } finally {
      aggregate.mockRestore();
    }
  });
});
