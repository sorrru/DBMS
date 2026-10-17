import type { Request, Response } from "express";
import { sessionLifetimeSeconds } from "../security/token.js";

export const sessionCookieName = "survey_session";

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === sessionCookieName) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function setSessionCookie(
  response: Response,
  token: string,
  secure: boolean,
): void {
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; Max-Age=${sessionLifetimeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
}
