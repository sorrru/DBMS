import { Router, type Request } from "express";
import type { AuthDependencies } from "../auth/router.js";
import { requireCurrentUser } from "../auth/current-user.js";
import { validationError } from "../errors/api-error.js";
import {
  readFillSessionCookie,
  setFillSessionCookie,
} from "../http/cookies.js";
import { FillService } from "./service.js";

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

  return router;
}
