import type { Request, Response } from "express";
import { sessionLifetimeSeconds } from "../security/token.js";

export const sessionCookieName = "survey_session";
export const fillSessionCookieName = "survey_fill";

function readCookie(request: Request, cookieName: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function readSessionCookie(request: Request): string | undefined {
  return readCookie(request, sessionCookieName);
}

export function readFillSessionCookie(request: Request): string | undefined {
  return readCookie(request, fillSessionCookieName);
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

export function setFillSessionCookie(
  response: Response,
  sessionId: string,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): void {
  response.append(
    "Set-Cookie",
    `${fillSessionCookieName}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/api/public/sessions/${sessionId}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
}
