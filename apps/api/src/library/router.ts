import { Router } from "express";
import { requireCurrentUser } from "../auth/current-user.js";
import type { AuthDependencies } from "../auth/router.js";
import { LibraryCursor } from "./cursor.js";
import { LibrarySharingService } from "./sharing.js";
import { LibraryService } from "./service.js";
import {
  parseLibraryCreate,
  parseLibraryShare,
  parseEmptyLibraryBody,
  parseLibraryEdit,
  parseLibraryRestore,
  parseLibraryList,
  parseCopy,
  validLibraryId,
} from "./validation.js";
export function createLibraryRouter(deps: AuthDependencies): Router {
  const router = Router(),
    service = new LibraryService(new LibraryCursor(deps.env.jwtSecret));
  const sharing = new LibrarySharingService(
    new LibraryCursor(deps.env.jwtSecret),
  );
  router.use(async (req, res, next) => {
    try {
      const user = await requireCurrentUser(req, deps.tokens);
      res.locals.libraryUser = user;
      if (!["GET", "HEAD"].includes(req.method))
        deps.rateLimits.consume(
          `library-write:${user._id}`,
          deps.env.surveyWriteRateLimit,
          deps.env.surveyWriteRateWindowMs,
        );
      next();
    } catch (e) {
      next(e);
    }
  });
  const owner = (res: { locals: Record<string, unknown> }) =>
    (res.locals.libraryUser as { _id: import("mongoose").Types.ObjectId })._id;
  router.post("/", async (req, res) =>
    res
      .status(201)
      .json(await service.create(owner(res), parseLibraryCreate(req.body))),
  );
  router.get("/", async (req, res) => {
    const query = parseLibraryList(req.query);
    res.json(await service.list(owner(res), query.limit, query.cursor));
  });
  router.get("/shared", async (req, res) => {
    const query = parseLibraryList(req.query);
    res.json(await service.listShared(owner(res), query.limit, query.cursor));
  });
  const shareRate = (req: import("express").Request, userId: string) => {
    deps.rateLimits.consume(`library-share-user:${userId}`, 20, 15 * 60 * 1000);
    deps.rateLimits.consume(
      `library-share-ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`,
      100,
      15 * 60 * 1000,
    );
  };
  router.post("/:libraryQuestionId/shares", async (req, res) => {
    shareRate(req, owner(res).toString());
    const id = validLibraryId(
        req.params.libraryQuestionId,
        "libraryQuestionId",
      ),
      input = parseLibraryShare(req.body);
    res.status(202).json(await sharing.grant(owner(res), id, input));
  });
  router.get("/:libraryQuestionId/shares", async (req, res) => {
    const query = parseLibraryList(req.query);
    res.json(
      await sharing.listGrants(
        owner(res),
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
        query.limit,
        query.cursor,
      ),
    );
  });
  router.delete("/:libraryQuestionId/shares/:shareId", async (req, res) => {
    shareRate(req, owner(res).toString());
    parseEmptyLibraryBody(req.body);
    await sharing.revoke(
      owner(res),
      validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
      validLibraryId(req.params.shareId, "shareId"),
    );
    res.status(204).end();
  });
  router.get("/:libraryQuestionId/usages", async (req, res) => {
    const query = parseLibraryList(req.query);
    res.json(
      await sharing.ownUsages(
        owner(res),
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
        query.limit,
        query.cursor,
      ),
    );
  });
  router.get("/:libraryQuestionId/usages/others", async (req, res) => {
    const query = parseLibraryList(req.query);
    res.json(
      await sharing.otherUsages(
        owner(res),
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
        query.limit,
        query.cursor,
      ),
    );
  });
  router.get("/:libraryQuestionId", async (req, res) =>
    res.json(
      await service.get(
        owner(res),
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
      ),
    ),
  );
  router.get("/:libraryQuestionId/versions", async (req, res) => {
    const query = parseLibraryList(req.query);
    res.json(
      await service.history(
        owner(res),
        validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
        query.limit,
        query.cursor,
      ),
    );
  });
  router.post("/:libraryQuestionId/versions", async (req, res) => {
    const id = validLibraryId(
        req.params.libraryQuestionId,
        "libraryQuestionId",
      ),
      input = parseLibraryEdit(req.body, true);
    res
      .status(201)
      .json(
        await service.branch(
          owner(res),
          id,
          input.sourceVersionId!,
          input.contentRevision,
          input.definition,
        ),
      );
  });
  router.post("/:libraryQuestionId/restore", async (req, res) => {
    const id = validLibraryId(
      req.params.libraryQuestionId,
      "libraryQuestionId",
    );
    res
      .status(201)
      .json(
        await service.restore(owner(res), id, parseLibraryRestore(req.body)),
      );
  });
  router.get(
    "/:libraryQuestionId/versions/:questionVersionId",
    async (req, res) =>
      res.json(
        await service.get(
          owner(res),
          validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
          validLibraryId(req.params.questionVersionId, "questionVersionId"),
        ),
      ),
  );
  router.patch(
    "/:libraryQuestionId/versions/:questionVersionId",
    async (req, res) => {
      const id = validLibraryId(
          req.params.libraryQuestionId,
          "libraryQuestionId",
        ),
        version = validLibraryId(
          req.params.questionVersionId,
          "questionVersionId",
        ),
        input = parseLibraryEdit(req.body);
      res.json(
        await service.edit(
          owner(res),
          id,
          version,
          input.contentRevision,
          input.definition,
        ),
      );
    },
  );
  router.post(
    "/:libraryQuestionId/versions/:questionVersionId/copy",
    async (req, res) =>
      res
        .status(201)
        .json(
          await service.copy(
            owner(res),
            validLibraryId(req.params.libraryQuestionId, "libraryQuestionId"),
            validLibraryId(req.params.questionVersionId, "questionVersionId"),
            parseCopy(req.body),
          ),
        ),
  );
  return router;
}
