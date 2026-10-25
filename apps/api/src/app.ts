import { createLibraryStatisticsRouter } from "./library-statistics/router.js";
import { createBankRouter } from "./banks/router.js";
import cors from "cors";
import { createLibraryRouter } from "./library/router.js";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import { env } from "./config/env.js";
import { createAuthRouter, type AuthDependencies } from "./auth/router.js";
import {
  checkDatabaseStatus,
  type DatabaseStatus,
} from "./database/connection.js";
import { ApiError } from "./errors/api-error.js";
import { PasswordService } from "./security/password.js";
import { FixedWindowStore } from "./security/rate-limit.js";
import { TokenService } from "./security/token.js";
import { createSurveyRouter } from "./surveys/router.js";
import { createFillRouter } from "./fills/router.js";
import { createStatisticsRouter } from "./statistics/router.js";

export interface HealthResponse {
  status: "ok" | "degraded";
  services: {
    api: "connected";
    database: DatabaseStatus;
  };
  timestamp: string;
}

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originGuard(webOrigin: string): RequestHandler {
  return (request, _response, next) => {
    if (
      (stateChangingMethods.has(request.method) ||
        request.method === "OPTIONS") &&
      request.headers.origin !== webOrigin
    ) {
      next(new ApiError(403, "ORIGIN_NOT_ALLOWED", "请求来源不被允许"));
      return;
    }
    next();
  };
}

const contentTypeGuard: RequestHandler = (request, _response, next) => {
  const hasBody =
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.path !== "/api/auth/logout";
  if (hasBody && !request.is("application/json")) {
    next(
      new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "请求必须使用 application/json",
      ),
    );
    return;
  }
  next();
};

function defaultAuthDependencies(): AuthDependencies {
  return {
    env,
    passwords: new PasswordService(),
    tokens: new TokenService(env.jwtSecret),
    rateLimits: new FixedWindowStore(env.rateLimitMaxKeys),
  };
}

export function createApp(
  authDependencies: AuthDependencies = defaultAuthDependencies(),
  clock: () => Date = () => new Date(),
): Express {
  const app = express();

  app.disable("x-powered-by");
  if (authDependencies.env.trustProxy !== false)
    app.set("trust proxy", authDependencies.env.trustProxy);
  app.use(originGuard(authDependencies.env.webOrigin));
  app.use(
    cors({
      origin: authDependencies.env.webOrigin,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  app.use(contentTypeGuard);
  const defaultJsonParser = express.json({ limit: "256kb" });
  app.use((request, response, next) => {
    const submissionPath =
      request.method === "POST" &&
      /^\/api\/public\/sessions\/[A-Za-z0-9]+\/submit$/.test(request.path);
    if (submissionPath) {
      next();
      return;
    }
    defaultJsonParser(request, response, next);
  });

  app.get("/api/health", async (_request, response) => {
    const database = await checkDatabaseStatus();
    const body: HealthResponse = {
      status: database === "connected" ? "ok" : "degraded",
      services: { api: "connected", database },
      timestamp: new Date().toISOString(),
    };
    response.json(body);
  });

  app.use("/api/auth", createAuthRouter(authDependencies));
  app.use("/api/question-banks", createBankRouter(authDependencies));
  app.use("/api/questions", createLibraryStatisticsRouter(authDependencies));
  app.use("/api/questions", createLibraryRouter(authDependencies));
  app.use("/api/public", createFillRouter(authDependencies, clock));
  app.use("/api/surveys", createStatisticsRouter(authDependencies, clock));
  app.use("/api/surveys", createSurveyRouter(authDependencies));
  app.use("/api", (_request, _response, next) =>
    next(new ApiError(404, "NOT_FOUND", "接口不存在")),
  );

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    let apiError: ApiError;
    if (error instanceof ApiError) apiError = error;
    else if ((error as { type?: unknown })?.type === "entity.too.large")
      apiError = new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体积超过限制");
    else if (error instanceof SyntaxError && "body" in error)
      apiError = new ApiError(400, "VALIDATION_ERROR", "JSON 格式无效");
    else {
      console.error(
        "未预期的 API 错误",
        error instanceof Error ? error.message : "unknown",
      );
      apiError = new ApiError(500, "INTERNAL_ERROR", "服务器内部错误");
    }
    if (apiError.headers) response.set(apiError.headers);
    const body: {
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    } = { error: { code: apiError.code, message: apiError.message } };
    if (apiError.details) body.error.details = apiError.details;
    response.status(apiError.status).json(body);
  };
  app.use(errorHandler);

  return app;
}
