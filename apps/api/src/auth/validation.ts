import { validationError } from "../errors/api-error.js";
import type { PasswordService } from "../security/password.js";

const usernamePattern = /^[A-Za-z0-9_]{3,20}$/;

export interface Credentials {
  username: string;
  usernameNormalized: string;
  password: string;
}

export function validateCredentials(
  body: unknown,
  passwords: PasswordService,
  registering: boolean,
): Credentials {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw validationError();
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.username !== "string") throw validationError("username");
  if (typeof candidate.password !== "string") throw validationError("password");
  const username = candidate.username.trim();
  const usernameNormalized = username.toLowerCase();
  if (!usernamePattern.test(username))
    throw validationError("username", "用户名必须为 3–20 位英文、数字或下划线");
  const password = passwords.normalize(candidate.password);
  const length = Array.from(password).length;
  if (length < (registering ? 10 : 1) || length > 128)
    throw validationError(
      "password",
      registering ? "密码长度必须为 10–128 个字符" : "密码不符合要求",
    );
  if (
    registering &&
    (!/[A-Za-z]/.test(password) ||
      !/\d/.test(password) ||
      password === usernameNormalized)
  ) {
    throw validationError(
      "password",
      "密码须含英文字母和数字，且不能与用户名相同",
    );
  }
  return { username, usernameNormalized, password };
}
