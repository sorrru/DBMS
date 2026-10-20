import express, { Router, type Request } from "express";
import type { AuthDependencies } from "../auth/router.js";
import { requireCurrentUser } from "../auth/current-user.js";
import { validationError } from "../errors/api-error.js";
import {
  clearFillSessionCookie,
  readFillSessionCookie,
  setFillSessionCookie,
} from "../http/cookies.js";
import { FillService } from "./service.js";
import { parseSubmissionBody } from "./submission-validation.js";

const ipOf = (request: Request) =>
  request.ip ?? request.socket.remoteAddress ?? "unknown";

const emptyObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

export function createFillRouter(
  deps: AuthDependencies,
  clock: () => Date = () => new Date(),
): Router {
  const router = Router();
  const service = new FillService(deps.env, clock);

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/surveys/:publicId", async (request, response) => {
    response.json({ survey: await service.summary(request.params.publicId!) });
  });

  router.post("/surveys/:publicId/sessions", async (request, response) => {
    if (!emptyObject(request.body))
      throw validationError(undefined, "请求体必须是空 JSON 对象");
    const user = await requireCurrentUser(request, deps.tokens);
    const ip = ipOf(request);
    deps.rateLimits.consume(
      `fill-session-ip:${ip}`,
      deps.env.fillSessionIpMax,
      deps.env.fillSessionRateLimitWindowMs,
    );
    deps.rateLimits.consume(
      `fill-session-account-ip:${user._id.toString()}:${ip}`,
      deps.env.fillSessionAccountIpMax,
      deps.env.fillSessionRateLimitWindowMs,
    );
    const created = await service.create(user._id, request.params.publicId!);
    setFillSessionCookie(
      response,
      created.body.session.id,
      created.token,
      created.maxAgeSeconds,
      deps.env.production,
    );
    response.status(201).json(created.body);
  });

  router.get("/sessions/:sessionId", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    response.json(
      await service.resume(
        user._id,
        request.params.sessionId!,
        readFillSessionCookie(request),
      ),
    );
  });

  const submissionJson = express.json({ limit: "4mb" });
  router.post(
    "/sessions/:sessionId/submit",
    async (request, response, next) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const sessionId = request.params.sessionId!;
      const preflight = await service.preflightSubmission(
        user._id,
        sessionId,
        readFillSessionCookie(request),
      );
      if (preflight) {
        clearFillSessionCookie(response, sessionId, deps.env.production);
        response.status(200).json(preflight.body);
        return;
      }
      deps.rateLimits.consume(
        `submission-account:${user._id.toString()}`,
        deps.env.submissionAccountMax,
        deps.env.submissionRateLimitWindowMs,
      );
      deps.rateLimits.consume(
        `submission-session:${sessionId}`,
        deps.env.submissionSessionMax,
        deps.env.submissionRateLimitWindowMs,
      );
      await service.assertSubmissionActive(
        user._id,
        sessionId,
        readFillSessionCookie(request),
      );
      response.locals.submissionUserId = user._id;
      next();
    },
    submissionJson,
    async (request, response) => {
      const sessionId = request.params.sessionId!;
      const submitted = await service.submit(
        response.locals.submissionUserId,
        sessionId,
        readFillSessionCookie(request),
        parseSubmissionBody(request.body),
      );
      clearFillSessionCookie(response, sessionId, deps.env.production);
      response.status(submitted.created ? 201 : 200).json(submitted.body);
    },
  );

  return router;
}
