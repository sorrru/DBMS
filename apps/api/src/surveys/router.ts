import { Router } from "express";
import { isValidObjectId } from "mongoose";
import { requireCurrentUser } from "../auth/current-user.js";
import type { AuthDependencies } from "../auth/router.js";
import { validationError } from "../errors/api-error.js";
import { SurveyCursorService } from "./cursor.js";
import { SurveyService } from "./service.js";
import {
  validateCreateSurvey,
  validateDraftPatch,
  validateListQuery,
  validateRenameSurvey,
} from "./validation.js";

function validId(value: string, field: string): string {
  if (!isValidObjectId(value)) throw validationError(field);
  return value;
}

export function createSurveyRouter(deps: AuthDependencies): Router {
  const router = Router();
  const service = new SurveyService(
    deps.env,
    new SurveyCursorService(deps.env.jwtSecret),
  );
  const consumeWrite = (userId: string) =>
    deps.rateLimits.consume(
      `survey-write:${userId}`,
      deps.env.surveyWriteRateLimit,
      deps.env.surveyWriteRateWindowMs,
    );

  router.post("/", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const input = validateCreateSurvey(request.body);
    consumeWrite(user._id.toString());
    response
      .status(201)
      .json({ survey: await service.create(user._id, input.internalName) });
  });
  router.get("/", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const query = validateListQuery(request.query.limit, request.query.cursor);
    response.json(await service.list(user._id, query.limit, query.cursor));
  });
  router.get("/:surveyId", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    response.json({
      survey: await service.get(
        user._id,
        validId(request.params.surveyId!, "surveyId"),
      ),
    });
  });
  router.patch("/:surveyId", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const surveyId = validId(request.params.surveyId!, "surveyId");
    const input = validateRenameSurvey(request.body);
    consumeWrite(user._id.toString());
    response.json({
      survey: await service.rename(user._id, surveyId, input.internalName),
    });
  });
  router.get("/:surveyId/versions/:versionId", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    response.json({
      version: await service.getVersion(
        user._id,
        validId(request.params.surveyId!, "surveyId"),
        validId(request.params.versionId!, "versionId"),
      ),
    });
  });
  router.patch("/:surveyId/versions/:versionId", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const surveyId = validId(request.params.surveyId!, "surveyId");
    const versionId = validId(request.params.versionId!, "versionId");
    const input = validateDraftPatch(request.body);
    consumeWrite(user._id.toString());
    response.json(
      await service.patchDraft(
        user._id,
        surveyId,
        versionId,
        input.revision,
        input.changes,
      ),
    );
  });
  return router;
}
