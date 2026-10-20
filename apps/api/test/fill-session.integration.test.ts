import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import {
  fillSessionCookieName,
  sessionCookieName,
} from "../src/http/cookies.js";
import { FillSessionModel } from "../src/models/fill-session.js";
import { SurveyModel } from "../src/models/survey.js";
import { SurveyVersionModel } from "../src/models/survey-version.js";
import { UserModel } from "../src/models/user.js";
import { PasswordService } from "../src/security/password.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { TokenService } from "../src/security/token.js";
import { assertSafeTestDatabase } from "./database-safety.js";

const origin = "http://localhost:5173";
const testEnv = {
  ...env,
  mongoUri: process.env.MONGODB_URI!,
  production: false,
  rateLimitMaxKeys: 1_000,
  fillSessionAccountIpMax: 100,
  fillSessionIpMax: 500,
};
const tokens = new TokenService(testEnv.jwtSecret);
const rateLimits = new FixedWindowStore(testEnv.rateLimitMaxKeys);
let now = new Date("2027-01-01T00:00:00.000Z");
const app = createApp(
  {
    env: testEnv,
    passwords: new PasswordService(
      {
        N: 1_024,
        r: 8,
        p: 1,
        maxmem: 8 * 1024 * 1024,
        saltBytes: 16,
        keyBytes: 32,
      },
      "",
    ),
    tokens,
    rateLimits,
  },
  () => new Date(now),
);

const authCookie = (userId: Types.ObjectId) =>
  `${sessionCookieName}=${tokens.sign(userId.toString())}`;

const firstCookie = (value: string) => value.split(";", 1)[0]!;

async function user(username: string) {
  return UserModel.create({
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: "unused",
    registeredAt: now,
  });
}

async function publishedSurvey(
  ownerId: Types.ObjectId,
  options: {
    publicId?: string;
    identityMode?: "anonymous" | "identified";
    deadline?: Date | null;
    manualStatus?: "open" | "closed";
    versionNumber?: number;
  } = {},
) {
  const surveyId = new Types.ObjectId();
  const versionId = new Types.ObjectId();
  const publicId = options.publicId ?? `public_${surveyId.toString()}`;
  const versionNumber = options.versionNumber ?? 1;
  await SurveyModel.create({
    _id: surveyId,
    ownerId,
    publicId,
    internalName: publicId,
    manualStatus: options.manualStatus ?? "open",
    currentVersionId: versionId,
    draftVersionId: null,
  });
  await SurveyVersionModel.create({
    _id: versionId,
    surveyId,
    versionNumber,
    status: "published",
    revision: 3,
    title: "公开标题",
    description: "填写说明",
    identityMode: options.identityMode ?? "anonymous",
    allowMultipleSubmissions: false,
    deadline: options.deadline ?? null,
    sessionDurationMinutes: 30,
    questions: [
      {
        questionId: "q_text",
        type: "text",
        title: "请回答",
        required: true,
        validation: { minLength: 1, maxLength: 100, digitsOnly: false },
        options: [],
        jumpRules: [],
      },
    ],
    schemaVersion: 1,
    publishedAt: now,
  });
  return { surveyId, versionId, publicId };
}

function start(publicId: string, userId: Types.ObjectId) {
  return request(app)
    .post(`/api/public/surveys/${publicId}/sessions`)
    .set("Origin", origin)
    .set("Content-Type", "application/json")
    .set("Cookie", authCookie(userId))
    .send({});
}

beforeAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  await mongoose.connect(testEnv.mongoUri);
  await Promise.all([
    UserModel.init(),
    SurveyModel.init(),
    SurveyVersionModel.init(),
    FillSessionModel.init(),
  ]);
});

beforeEach(async () => {
  now = new Date("2027-01-01T00:00:00.000Z");
  rateLimits.reset();
  await Promise.all([
    FillSessionModel.deleteMany({}),
    SurveyVersionModel.deleteMany({}),
    SurveyModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  rateLimits.dispose();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("public survey summary", () => {
  it("is public, no-store, and exposes only the response whitelist", async () => {
    const owner = await user("Owner");
    const survey = await publishedSurvey(owner._id);
    const response = await request(app)
      .get(`/api/public/surveys/${survey.publicId}`)
      .expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(response.body.survey).sort()).toEqual([
      "deadline",
      "description",
      "identityMode",
      "publicId",
      "questionCount",
      "sessionDurationMinutes",
      "status",
      "title",
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /surveyId|revision|ownerKey/,
    );
  });

  it("hides drafts and reports closed or expired published surveys", async () => {
    const owner = await user("Owner");
    const closed = await publishedSurvey(owner._id, {
      publicId: "closed_survey",
      manualStatus: "closed",
    });
    const expired = await publishedSurvey(owner._id, {
      publicId: "expired_survey",
      deadline: now,
    });
    expect(
      (await request(app).get(`/api/public/surveys/${closed.publicId}`)).body
        .survey.status,
    ).toBe("closed");
    expect(
      (await request(app).get(`/api/public/surveys/${expired.publicId}`)).body
        .survey.status,
    ).toBe("expired");
    await request(app).get("/api/public/surveys/missing").expect(404);
  });
});

describe("fill session creation and recovery", () => {
  it("creates every required session index with the active-only slot guard", async () => {
    const indexes = await FillSessionModel.collection.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { sessionTokenHash: 1 }, unique: true }),
        expect.objectContaining({ key: { purgeAt: 1 }, expireAfterSeconds: 0 }),
        expect.objectContaining({
          key: { surveyId: 1, ownerKey: 1, activeSlot: 1 },
          unique: true,
          partialFilterExpression: { status: "active" },
        }),
        expect.objectContaining({
          key: { surveyId: 1, ownerKey: 1, status: 1, expiresAt: 1 },
        }),
      ]),
    );
  });

  it("creates an anonymous session without userId and does not refresh login", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await publishedSurvey(owner._id);
    const response = await start(survey.publicId, respondent._id).expect(201);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${fillSessionCookieName}=`);
    expect(cookies[0]).toContain(
      `Path=/api/public/sessions/${response.body.session.id}`,
    );
    expect(cookies[0]).toContain("Max-Age=1800");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(cookies[0]).not.toContain("Secure");
    expect(cookies[0]).not.toContain(`${sessionCookieName}=`);
    const saved = await FillSessionModel.findById(
      response.body.session.id,
    ).lean();
    expect(saved).not.toHaveProperty("userId");
    expect(saved?.ownerKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(response.body)).not.toMatch(
      /ownerKey|userId|revision|surveyId/,
    );

    const resumed = await request(app)
      .get(`/api/public/sessions/${response.body.session.id}`)
      .set("Cookie", [authCookie(respondent._id), firstCookie(cookies[0]!)])
      .expect(200);
    expect(resumed.headers["cache-control"]).toBe("no-store");
    expect(resumed.body.version.questions[0].questionId).toBe("q_text");
  });

  it("derives a different anonymous ownerKey for the same account in different surveys", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const first = await publishedSurvey(owner._id, { publicId: "owner_key_a" });
    const second = await publishedSurvey(owner._id, {
      publicId: "owner_key_b",
    });
    const firstSession = await start(first.publicId, respondent._id).expect(
      201,
    );
    const secondSession = await start(second.publicId, respondent._id).expect(
      201,
    );
    const sessions = await FillSessionModel.find({
      _id: {
        $in: [firstSession.body.session.id, secondSession.body.session.id],
      },
    })
      .sort({ surveyId: 1 })
      .lean();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.ownerKey).not.toBe(sessions[1]!.ownerKey);
  });

  it("stores userId only for identified sessions", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await publishedSurvey(owner._id, {
      identityMode: "identified",
    });
    const response = await start(survey.publicId, respondent._id).expect(201);
    const saved = await FillSessionModel.findById(
      response.body.session.id,
    ).lean();
    expect(saved?.userId?.toString()).toBe(respondent._id.toString());
  });

  it("adds Secure to the fill cookie in production", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await publishedSurvey(owner._id);
    const productionApp = createApp(
      {
        env: { ...testEnv, production: true },
        passwords: new PasswordService(
          {
            N: 1_024,
            r: 8,
            p: 1,
            maxmem: 8 * 1024 * 1024,
            saltBytes: 16,
            keyBytes: 32,
          },
          "",
        ),
        tokens,
        rateLimits,
      },
      () => new Date(now),
    );
    const response = await request(productionApp)
      .post(`/api/public/surveys/${survey.publicId}/sessions`)
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .set("Cookie", authCookie(respondent._id))
      .send({})
      .expect(201);
    expect(
      (response.headers["set-cookie"] as unknown as string[])[0],
    ).toContain("Secure");
  });

  it("requires both cookies and hides ownership mismatches", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const other = await user("Other");
    const survey = await publishedSurvey(owner._id);
    const created = await start(survey.publicId, respondent._id).expect(201);
    const fillCookie = firstCookie(
      (created.headers["set-cookie"] as unknown as string[])[0]!,
    );
    const path = `/api/public/sessions/${created.body.session.id}`;
    await request(app).get(path).set("Cookie", fillCookie).expect(401);
    await request(app)
      .get(path)
      .set("Cookie", authCookie(respondent._id))
      .expect(404);
    await request(app)
      .get(path)
      .set("Cookie", [authCookie(other._id), fillCookie])
      .expect(404);
  });

  it("strictly limits concurrent active sessions to five", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await publishedSurvey(owner._id);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => start(survey.publicId, respondent._id)),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([
      201, 201, 201, 201, 201, 409,
    ]);
    expect(await FillSessionModel.countDocuments({ status: "active" })).toBe(5);
    expect(
      responses.find(({ status }) => status === 409)?.body.error.code,
    ).toBe("SESSION_LIMIT_REACHED");
  });

  it("releases expired active slots before creating another session", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const survey = await publishedSurvey(owner._id);
    for (let index = 0; index < 5; index += 1)
      await start(survey.publicId, respondent._id).expect(201);
    now = new Date(now.getTime() + 30 * 60_000);
    const replacement = await start(survey.publicId, respondent._id).expect(
      201,
    );
    expect(replacement.body.session.status).toBe("active");
    expect(
      await FillSessionModel.countDocuments({
        surveyId: survey.surveyId,
        status: "expired",
        activeSlot: null,
      }),
    ).toBe(5);
    expect(
      await FillSessionModel.countDocuments({
        surveyId: survey.surveyId,
        status: "active",
      }),
    ).toBe(1);
  });

  it("uses the bound old-version deadline after a newer version is published", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const deadline = new Date(now.getTime() + 60_000);
    const survey = await publishedSurvey(owner._id, { deadline });
    const created = await start(survey.publicId, respondent._id).expect(201);
    const fillCookie = firstCookie(
      (created.headers["set-cookie"] as unknown as string[])[0]!,
    );
    const nextVersionId = new Types.ObjectId();
    await SurveyVersionModel.create({
      _id: nextVersionId,
      surveyId: survey.surveyId,
      versionNumber: 2,
      status: "published",
      revision: 1,
      title: "新版",
      description: "",
      identityMode: "anonymous",
      allowMultipleSubmissions: false,
      deadline: null,
      sessionDurationMinutes: 30,
      questions: [],
      schemaVersion: 1,
      publishedAt: now,
    });
    await SurveyModel.updateOne(
      { _id: survey.surveyId },
      { $set: { currentVersionId: nextVersionId } },
    );
    now = new Date(deadline.getTime());
    const response = await request(app)
      .get(`/api/public/sessions/${created.body.session.id}`)
      .set("Cookie", [authCookie(respondent._id), fillCookie])
      .expect(409);
    expect(response.body.error.code).toBe("SURVEY_EXPIRED");
  });

  it("rejects creation for closed and expired surveys", async () => {
    const owner = await user("Owner");
    const respondent = await user("Respondent");
    const closed = await publishedSurvey(owner._id, {
      publicId: "closed_create",
      manualStatus: "closed",
    });
    const expired = await publishedSurvey(owner._id, {
      publicId: "expired_create",
      deadline: now,
    });
    expect((await start(closed.publicId, respondent._id)).body.error.code).toBe(
      "SURVEY_CLOSED",
    );
    expect(
      (await start(expired.publicId, respondent._id)).body.error.code,
    ).toBe("SURVEY_EXPIRED");
  });
});
