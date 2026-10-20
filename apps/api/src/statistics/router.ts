import { Router } from "express";
import { isValidObjectId } from "mongoose";
import { requireCurrentUser } from "../auth/current-user.js";
import type { AuthDependencies } from "../auth/router.js";
import { validationError } from "../errors/api-error.js";
import { StatisticsCursorService } from "./cursor.js";
import { StatisticsService } from "./service.js";
import { parseStatisticsQuery, parseTextQuery } from "./validation.js";

function validId(value: string, field: string): string {
  if (!isValidObjectId(value)) throw validationError(field);
  return value;
}

export function createStatisticsRouter(
  deps: AuthDependencies,
  clock: () => Date = () => new Date(),
): Router {
  const router = Router();
  const service = new StatisticsService(
    deps.env,
    new StatisticsCursorService(deps.env.jwtSecret),
    {},
    clock,
  );
  const consume = (userId: string) =>
    deps.rateLimits.consume(
      `statistics:${userId}`,
      deps.env.statisticsRateLimitUserMax,
      deps.env.statisticsRateLimitWindowMs,
    );

  router.get(
    "/:surveyId/versions/:versionId/statistics",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      parseStatisticsQuery(request.query as Record<string, unknown>);
      const body = await service.statistics(
        user._id,
        validId(request.params.surveyId!, "surveyId"),
        validId(request.params.versionId!, "versionId"),
        () => consume(user._id.toString()),
      );
      response.set("Cache-Control", "no-store").json(body);
    },
  );

  router.get(
    "/:surveyId/versions/:versionId/responses",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const query = parseTextQuery(request.query as Record<string, unknown>);
      const body = await service.textResponses(
        user._id,
        validId(request.params.surveyId!, "surveyId"),
        validId(request.params.versionId!, "versionId"),
        query.questionId,
        query.limit,
        query.cursor,
        () => consume(user._id.toString()),
      );
      response.set("Cache-Control", "no-store").json(body);
    },
  );
  return router;
}
