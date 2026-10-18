import mongoose from "mongoose";
import request from "supertest";
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
import { UserModel } from "../src/models/user.js";
import { PasswordService } from "../src/security/password.js";
import { FixedWindowStore } from "../src/security/rate-limit.js";
import { TokenService } from "../src/security/token.js";
import { assertSafeTestDatabase } from "./database-safety.js";

const origin = "http://localhost:5173";
const testScryptProfile = {
  N: 1_024,
  r: 8,
  p: 1,
  maxmem: 8 * 1024 * 1024,
  saltBytes: 16,
  keyBytes: 32,
};
const testEnv = {
  ...env,
  mongoUri: process.env.MONGODB_URI!,
  registerLimit: 20,
  loginAccountLimit: 20,
  loginIpLimit: 30,
  rateLimitMaxKeys: 100,
  production: false,
};
const passwords = new PasswordService(testScryptProfile, "");
const tokens = new TokenService(testEnv.jwtSecret);
const rateLimits = new FixedWindowStore(testEnv.rateLimitMaxKeys);
let app: ReturnType<typeof createApp>;
let appPasswords: PasswordService;

const register = (username = "Alice", password = "Password123") =>
  request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .set("Content-Type", "application/json")
    .send({ username, password });

beforeAll(async () => {
  assertSafeTestDatabase(testEnv.mongoUri);
  const dummyHash = await passwords.hash("dummy-password-123");
  appPasswords = new PasswordService(testScryptProfile, dummyHash);
  app = createApp({
    env: testEnv,
    passwords: appPasswords,
    tokens,
    rateLimits,
  });
  await mongoose.connect(testEnv.mongoUri);
  await UserModel.init();
});

beforeEach(async () => {
  rateLimits.reset();
  await UserModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("authentication API", () => {
  it("registers, stores only a hash, returns fixed public fields and restores the cookie session", async () => {
    const response = await register().expect(201);
    expect(Object.keys(response.body.user).sort()).toEqual([
      "id",
      "registeredAt",
      "username",
    ]);
    expect(response.body.user.username).toBe("Alice");
    expect(response.headers["set-cookie"]![0]!).toEqual(
      expect.stringContaining(`${sessionCookieName}=`),
    );
    expect(response.headers["set-cookie"]![0]!).toContain("HttpOnly");
    expect(response.headers["set-cookie"]![0]!).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]![0]!).toContain("Path=/");
    expect(response.headers["set-cookie"]![0]!).toContain("Max-Age=7200");
    expect(response.headers["set-cookie"]![0]!).not.toContain("Secure");
    const saved = await UserModel.findOne({
      usernameNormalized: "alice",
    }).lean();
    expect(saved?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(saved)).not.toContain("Password123");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", response.headers["set-cookie"]!)
      .expect(200);
    expect(me.body.user.id).toBe(response.body.user.id);
  });

  it("uses the unique normalized index under concurrent registration", async () => {
    const [first, second] = await Promise.all([
      register("Alice"),
      register("alice"),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(
      await UserModel.countDocuments({ usernameNormalized: "alice" }),
    ).toBe(1);
  });

  it("logs in with normalized username and clears the password from responses", async () => {
    await register("Alice", "Password123");
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username: " alice ", password: "Password123" })
      .expect(200);
    expect(response.body.user.username).toBe("Alice");
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|usernameNormalized/i,
    );
  });

  it("returns Retry-After when registration is rate limited", async () => {
    const limitedStore = new FixedWindowStore(10);
    const limitedApp = createApp({
      env: { ...testEnv, registerLimit: 1 },
      passwords,
      tokens,
      rateLimits: limitedStore,
    });
    await request(limitedApp)
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ username: "First", password: "Password123" })
      .expect(201);
    const response = await request(limitedApp)
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ username: "Second", password: "Password123" })
      .expect(429);
    expect(response.headers["retry-after"]).toBeTruthy();
    expect(response.body.error.code).toBe("RATE_LIMITED");
  });

  it("returns identical credentials errors and performs dummy verification for a missing user", async () => {
    await register();
    const verify = vi.spyOn(PasswordService.prototype, "verify");
    const wrong = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username: "Alice", password: "WrongPassword1" });
    const missing = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username: "Nobody", password: "WrongPassword1" });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual(wrong.body);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[1]?.[1]).toBe(appPasswords.dummyHash);
    verify.mockRestore();
  });

  it("enforces both account and total-IP login limits", async () => {
    await register();
    const accountApp = createApp({
      env: { ...testEnv, loginAccountLimit: 1 },
      passwords: appPasswords,
      tokens,
      rateLimits: new FixedWindowStore(20),
    });
    const loginRequest = (target: ReturnType<typeof createApp>, name: string) =>
      request(target)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ username: name, password: "WrongPassword1" });
    await loginRequest(accountApp, "Alice").expect(401);
    await loginRequest(accountApp, "Alice").expect(429);

    const ipApp = createApp({
      env: { ...testEnv, loginAccountLimit: 10, loginIpLimit: 1 },
      passwords: appPasswords,
      tokens,
      rateLimits: new FixedWindowStore(20),
    });
    await loginRequest(ipApp, "NobodyOne").expect(401);
    await loginRequest(ipApp, "NobodyTwo").expect(429);
  });

  it.each([{ $ne: null }, ["Alice"], 7, null])(
    "rejects non-string NoSQL-shaped username %j",
    async (username) => {
      const response = await request(app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ username, password: "Password123" });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    },
  );

  it("rejects missing origin, non-JSON, malformed JSON and oversized JSON in stable formats", async () => {
    expect(
      (await request(app).post("/api/auth/login").send({})).body.error.code,
    ).toBe("ORIGIN_NOT_ALLOWED");
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", origin)
          .type("text")
          .send("x")
      ).body.error.code,
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", origin)
          .set("Content-Type", "application/json")
          .send("{")
      ).body.error.code,
    ).toBe("VALIDATION_ERROR");
    const large = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({
          username: "a".repeat(270_000),
          password: "Password123",
        }),
      );
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects a disallowed CORS preflight and requires a session for me", async () => {
    const preflight = await request(app)
      .options("/api/auth/login")
      .set("Origin", "https://evil.example")
      .expect(403);
    expect(preflight.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    const missing = await request(app).get("/api/auth/me").expect(401);
    expect(missing.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects forged tokens and a valid token whose user was deleted", async () => {
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: new mongoose.Types.ObjectId().toString() })).toString("base64url")}.`;
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${sessionCookieName}=${none}`)
      .expect(401);
    const registered = await register();
    const id = registered.body.user.id as string;
    const wrongToken = new TokenService(
      "different-secret-that-is-long-enough-123",
    ).sign(id);
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${sessionCookieName}=${wrongToken}`)
      .expect(401);
    await UserModel.findByIdAndDelete(id);
    const deleted = await request(app)
      .get("/api/auth/me")
      .set("Cookie", registered.headers["set-cookie"]!);
    expect(deleted.body.error.code).toBe("AUTH_INVALID");
  });

  it("logs out without requiring a JSON content type and returns JSON 404", async () => {
    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Origin", origin)
      .expect(204);
    expect(logout.headers["set-cookie"]![0]!).toContain("Max-Age=0");
    const missing = await request(app).get("/api/missing").expect(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("sets Secure on production cookies", async () => {
    const productionApp = createApp({
      env: { ...testEnv, production: true },
      passwords,
      tokens,
      rateLimits,
    });
    const response = await request(productionApp)
      .post("/api/auth/logout")
      .set("Origin", origin)
      .expect(204);
    expect(response.headers["set-cookie"]![0]!).toContain("Secure");
  });
});
