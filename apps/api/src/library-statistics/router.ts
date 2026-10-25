import { Router } from "express";
import type { AuthDependencies } from "../auth/router.js";
import { requireCurrentUser } from "../auth/current-user.js";
import { validLibraryId, exact } from "../library/validation.js";
import { LibraryStatisticsService } from "./service.js";
import { parseLibraryStatistics } from "./validation.js";
export function createLibraryStatisticsRouter(deps: AuthDependencies) {
  const router = Router(),
    service = new LibraryStatisticsService(
      deps.env.jwtSecret,
      deps.env.statisticsMaxTimeMs,
    );
  router.use("/:libraryQuestionId/statistics", async (req, res, next) => {
    try {
      const user = await requireCurrentUser(req, deps.tokens);
      res.locals.statisticsUser = user._id;
      deps.rateLimits.consume(
        `statistics:${user._id}`,
        deps.env.statisticsRateLimitUserMax,
        deps.env.statisticsRateLimitWindowMs,
      );
      res.set("Cache-Control", "no-store");
      next();
    } catch (e) {
      next(e);
    }
  });
  router.get("/:libraryQuestionId/statistics/sources", async (req, res) => {
    exact(req.query, []);
    res.json(
      await service.catalog(
        res.locals.statisticsUser,
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
      ),
    );
  });
  router.post("/:libraryQuestionId/statistics/query", async (req, res) => {
    exact(req.query, []);
    res.json(
      await service.query(
        res.locals.statisticsUser,
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
        parseLibraryStatistics(req.body),
      ),
    );
  });
  return router;
}
