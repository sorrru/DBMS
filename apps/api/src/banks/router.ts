import { Router } from "express";
import type { Types } from "mongoose";
import { requireCurrentUser } from "../auth/current-user.js";
import type { AuthDependencies } from "../auth/router.js";
import { LibraryCursor } from "../library/cursor.js";
import { parseLibraryList, validLibraryId } from "../library/validation.js";
import { BankService } from "./service.js";
import { bankName, bankMember, bankRevision } from "./validation.js";
export function createBankRouter(deps: AuthDependencies) {
  const router = Router(),
    service = new BankService(new LibraryCursor(deps.env.jwtSecret));
  router.use(async (req, res, next) => {
    try {
      const user = await requireCurrentUser(req, deps.tokens);
      res.locals.bankUser = user._id;
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
  const user = (res: { locals: Record<string, unknown> }) =>
    res.locals.bankUser as Types.ObjectId;
  router.get("/", async (req, res) => {
    const q = parseLibraryList(req.query);
    res.json(await service.list(user(res), q.limit, q.cursor));
  });
  router.post("/", async (req, res) => {
    const b = bankName(req.body);
    res.status(201).json(await service.create(user(res), b.name));
  });
  router.patch("/:bankId", async (req, res) => {
    const b = bankName(req.body, true);
    res.json(
      await service.rename(
        user(res),
        validLibraryId(req.params.bankId, "bankId"),
        b.revision!,
        b.name,
      ),
    );
  });
  router.delete("/:bankId", async (req, res) => {
    await service.remove(
      user(res),
      validLibraryId(req.params.bankId, "bankId"),
      bankRevision(req.body),
    );
    res.status(204).end();
  });
  router.get("/:bankId/items", async (req, res) => {
    const q = parseLibraryList(req.query);
    res.json(
      await service.members(
        user(res),
        validLibraryId(req.params.bankId, "bankId"),
        q.limit,
        q.cursor,
      ),
    );
  });
  router.post("/:bankId/items", async (req, res) => {
    await service.putMember(
      user(res),
      validLibraryId(req.params.bankId, "bankId"),
      bankMember(req.body),
    );
    res.status(201).json({ accepted: true });
  });
  router.put("/:bankId/items/:itemId", async (req, res) => {
    await service.putMember(
      user(res),
      validLibraryId(req.params.bankId, "bankId"),
      bankMember(req.body, true),
      validLibraryId(req.params.itemId, "itemId"),
    );
    res.json({ accepted: true });
  });
  router.delete("/:bankId/items/:itemId", async (req, res) => {
    await service.removeMember(
      user(res),
      validLibraryId(req.params.bankId, "bankId"),
      validLibraryId(req.params.itemId, "itemId"),
      bankRevision(req.body),
    );
    res.status(204).end();
  });
  return router;
}
