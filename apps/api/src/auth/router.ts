import { Router, type Request } from "express";
import type { AppEnv } from "../config/env.js";
import { clearSessionCookie, setSessionCookie } from "../http/cookies.js";
import type { PasswordService } from "../security/password.js";
import { FixedWindowStore } from "../security/rate-limit.js";
import type { TokenService } from "../security/token.js";
import { AuthService, publicUser } from "./service.js";
import { validateCredentials } from "./validation.js";
import { requireCurrentUser } from "./current-user.js";

export interface AuthDependencies {
  env: Readonly<AppEnv>;
  passwords: PasswordService;
  tokens: TokenService;
  rateLimits: FixedWindowStore;
}

const ipOf = (request: Request) =>
  request.ip ?? request.socket.remoteAddress ?? "unknown";

export function createAuthRouter(deps: AuthDependencies): Router {
  const router = Router();
  const service = new AuthService(deps.passwords);

  router.post("/register", async (request, response) => {
    const credentials = validateCredentials(request.body, deps.passwords, true);
    deps.rateLimits.consume(
      `register:${ipOf(request)}`,
      deps.env.registerLimit,
      deps.env.registerWindowMs,
    );
    const user = await service.register(credentials);
    setSessionCookie(
      response,
      deps.tokens.sign(user._id.toString()),
      deps.env.production,
    );
    response.status(201).json({ user: publicUser(user) });
  });

  router.post("/login", async (request, response) => {
    const credentials = validateCredentials(
      request.body,
      deps.passwords,
      false,
    );
    const ip = ipOf(request);
    const accountKey = `login-account:${ip}:${credentials.usernameNormalized}`;
    deps.rateLimits.consume(
      `login-ip:${ip}`,
      deps.env.loginIpLimit,
      deps.env.loginWindowMs,
    );
    deps.rateLimits.consume(
      accountKey,
      deps.env.loginAccountLimit,
      deps.env.loginWindowMs,
    );
    const user = await service.login(credentials);
    deps.rateLimits.clear(accountKey);
    setSessionCookie(
      response,
      deps.tokens.sign(user._id.toString()),
      deps.env.production,
    );
    response.json({ user: publicUser(user) });
  });

  router.get("/me", async (request, response) => {
    const user = await requireCurrentUser(request, deps.tokens);
    response.json({ user: publicUser(user) });
  });

  router.post("/logout", (_request, response) => {
    clearSessionCookie(response, deps.env.production);
    response.status(204).end();
  });

  return router;
}
