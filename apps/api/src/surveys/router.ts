import { Router } from "express";
import { parseLibrarySelection } from "./library-validation.js";
import { isValidObjectId } from "mongoose";
import { requireCurrentUser } from "../auth/current-user.js";
import type { AuthDependencies } from "../auth/router.js";
import { validationError } from "../errors/api-error.js";
import { SurveyCursorService } from "./cursor.js";
import { parseJumpRulesUpdate } from "./jumps.js";
import {
  parseCreateQuestion,
  parseQuestionOrder,
  parseReplaceQuestion,
  parseRevision,
  validQuestionId,
} from "./questions.js";
import { SurveyService } from "./service.js";
import {
  validateCreateSurvey,
  validateCreateVersion,
  validateDraftPatch,
  validateListQuery,
  validatePublish,
  validateRenameSurvey,
  validateStatusPatch,
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
  router.patch("/:surveyId/status", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const surveyId = validId(request.params.surveyId!, "surveyId");
    const input = validateStatusPatch(request.body);
    consumeWrite(user._id.toString());
    response.json({
      survey: await service.setStatus(user._id, surveyId, input.manualStatus),
    });
  });
  router.get("/:surveyId/versions", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const surveyId = validId(request.params.surveyId!, "surveyId");
    const query = validateListQuery(request.query.limit, request.query.cursor);
    response.json(
      await service.listVersions(user._id, surveyId, query.limit, query.cursor),
    );
  });
  router.post("/:surveyId/versions", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const surveyId = validId(request.params.surveyId!, "surveyId");
    const input = validateCreateVersion(request.body);
    const sourceVersionId = validId(input.sourceVersionId, "sourceVersionId");
    consumeWrite(user._id.toString());
    response
      .status(201)
      .json(
        await service.createNextVersion(user._id, surveyId, sourceVersionId),
      );
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
  router.delete("/:surveyId/versions/:versionId", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    const surveyId = validId(request.params.surveyId!, "surveyId");
    const versionId = validId(request.params.versionId!, "versionId");
    const revision = parseRevision(request.body);
    consumeWrite(user._id.toString());
    response.json(
      await service.discardDraft(user._id, surveyId, versionId, revision),
    );
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
  router.post(
    "/:surveyId/versions/:versionId/questions",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const input = parseCreateQuestion(request.body);
      consumeWrite(user._id.toString());
      response
        .status(201)
        .json(await service.addQuestion(user._id, surveyId, versionId, input));
    },
  );
  router.patch(
    "/:surveyId/versions/:versionId/questions/:questionId",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const questionId = validQuestionId(request.params.questionId!);
      const input = parseReplaceQuestion(request.body);
      consumeWrite(user._id.toString());
      response.json(
        await service.replaceQuestion(
          user._id,
          surveyId,
          versionId,
          questionId,
          input,
        ),
      );
    },
  );
  router.delete(
    "/:surveyId/versions/:versionId/questions/:questionId",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const questionId = validQuestionId(request.params.questionId!);
      const revision = parseRevision(request.body);
      consumeWrite(user._id.toString());
      response.json(
        await service.deleteQuestion(
          user._id,
          surveyId,
          versionId,
          questionId,
          revision,
        ),
      );
    },
  );
  router.put(
    "/:surveyId/versions/:versionId/question-order",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const input = parseQuestionOrder(request.body);
      consumeWrite(user._id.toString());
      response.json(
        await service.reorderQuestions(
          user._id,
          surveyId,
          versionId,
          input.revision,
          input.questionIds,
        ),
      );
    },
  );
  router.put(
    "/:surveyId/versions/:versionId/questions/:questionId/jump-rules",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const questionId = validQuestionId(request.params.questionId!);
      const input = parseJumpRulesUpdate(request.body);
      consumeWrite(user._id.toString());
      response.json(
        await service.updateJumpRules(
          user._id,
          surveyId,
          versionId,
          questionId,
          input.revision,
          input.rules,
        ),
      );
    },
  );
  router.post(
    "/:surveyId/versions/:versionId/validate",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const revision = parseRevision(request.body);
      response.json(
        await service.validateDraft(user._id, surveyId, versionId, revision),
      );
    },
  );
  router.post(
    "/:surveyId/versions/:versionId/publish",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId");
      const versionId = validId(request.params.versionId!, "versionId");
      const input = validatePublish(request.body);
      consumeWrite(user._id.toString());
      response.json(
        await service.publish(
          user._id,
          surveyId,
          versionId,
          input.revision,
          input.acknowledgeWarnings,
        ),
      );
    },
  );
  router.post(
    "/:surveyId/versions/:versionId/library-questions",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId"),
        versionId = validId(request.params.versionId!, "versionId"),
        input = parseLibrarySelection(request.body);
      consumeWrite(user._id.toString());
      response
        .status(201)
        .json(
          await service.addLibraryQuestion(
            user._id,
            surveyId,
            versionId,
            input,
          ),
        );
    },
  );
  router.put(
    "/:surveyId/versions/:versionId/questions/:questionId/library-source",
    async (request, response) => {
      const user = await requireCurrentUser(request, deps.tokens);
      const surveyId = validId(request.params.surveyId!, "surveyId"),
        versionId = validId(request.params.versionId!, "versionId"),
        questionId = validQuestionId(request.params.questionId!),
        input = parseLibrarySelection(request.body);
      consumeWrite(user._id.toString());
      response.json(
        await service.addLibraryQuestion(
          user._id,
          surveyId,
          versionId,
          input,
          questionId,
        ),
      );
    },
  );
  for (const action of ["detach-library", "save-to-library"] as const)
    router.post(
      `/:surveyId/versions/:versionId/questions/:questionId/${action}`,
      async (request, response) => {
        const user = await requireCurrentUser(request, deps.tokens);
        const surveyId = validId(request.params.surveyId!, "surveyId"),
          versionId = validId(request.params.versionId!, "versionId"),
          questionId = validQuestionId(request.params.questionId!),
          revision = parseRevision(request.body);
        consumeWrite(user._id.toString());
        const result =
          action === "detach-library"
            ? await service.detachLibraryQuestion(
                user._id,
                surveyId,
                versionId,
                questionId,
                revision,
              )
            : await service.saveQuestionToLibrary(
                user._id,
                surveyId,
                versionId,
                questionId,
                revision,
              );
        response.status(action === "save-to-library" ? 201 : 200).json(result);
      },
    );
  return router;
}
