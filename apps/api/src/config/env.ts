import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ],
  quiet: true,
});

const EXAMPLE_SECRETS = new Set([
  "replace-with-at-least-32-random-characters",
  "replace-with-a-different-32-character-secret",
]);

function required(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback?: string,
): string {
  const value = source[name] ?? fallback;
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function integer(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum = 1,
): number {
  const value = Number(source[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`${name} 必须是不小于 ${minimum} 的整数`);
  return value;
}

function secret(source: NodeJS.ProcessEnv, name: string): string {
  const value = required(source, name);
  if (value.length < 32 || EXAMPLE_SECRETS.has(value))
    throw new Error(`${name} 必须是至少 32 字符且不是示例值的密钥`);
  return value;
}

export interface AppEnv {
  apiPort: number;
  webOrigin: string;
  mongoUri: string;
  jwtSecret: string;
  anonymousIdSecret: string;
  production: boolean;
  trustProxy: string | number | false;
  registerLimit: number;
  registerWindowMs: number;
  loginAccountLimit: number;
  loginIpLimit: number;
  loginWindowMs: number;
  rateLimitMaxKeys: number;
  surveyMaxPerUser: number;
  surveyWriteRateLimit: number;
  surveyWriteRateWindowMs: number;
  jumpRuleMaxPerQuestion: number;
}

export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
): Readonly<AppEnv> {
  const jwtSecret = secret(source, "JWT_SECRET");
  const anonymousIdSecret = secret(source, "ANONYMOUS_ID_SECRET");
  if (jwtSecret === anonymousIdSecret)
    throw new Error("JWT_SECRET 与 ANONYMOUS_ID_SECRET 不能相同");
  const apiPort = integer(source, "API_PORT", 3000);
  if (apiPort > 65535) throw new Error("API_PORT 必须是 1 至 65535 之间的整数");
  const trustProxyRaw = source.TRUST_PROXY?.trim();
  const trustProxy = !trustProxyRaw
    ? false
    : /^\d+$/.test(trustProxyRaw)
      ? Number(trustProxyRaw)
      : trustProxyRaw;
  const jumpRuleMaxPerQuestion = integer(
    source,
    "JUMP_RULE_MAX_PER_QUESTION",
    20,
  );
  if (jumpRuleMaxPerQuestion > 100)
    throw new Error("JUMP_RULE_MAX_PER_QUESTION 必须是 1 至 100 之间的整数");
  return Object.freeze({
    apiPort,
    webOrigin: required(source, "WEB_ORIGIN", "http://localhost:5173"),
    mongoUri: required(
      source,
      "MONGODB_URI",
      "mongodb://127.0.0.1:27017/survey_stage1?replicaSet=rs0&directConnection=true",
    ),
    jwtSecret,
    anonymousIdSecret,
    production: source.NODE_ENV === "production",
    trustProxy,
    registerLimit: integer(source, "REGISTER_RATE_LIMIT", 5),
    registerWindowMs: integer(source, "REGISTER_RATE_WINDOW_MS", 3_600_000),
    loginAccountLimit: integer(source, "LOGIN_ACCOUNT_RATE_LIMIT", 10),
    loginIpLimit: integer(source, "LOGIN_IP_RATE_LIMIT", 100),
    loginWindowMs: integer(source, "LOGIN_RATE_WINDOW_MS", 900_000),
    rateLimitMaxKeys: integer(source, "RATE_LIMIT_MAX_KEYS", 10_000),
    surveyMaxPerUser: integer(source, "SURVEY_MAX_PER_USER", 100),
    surveyWriteRateLimit: integer(source, "SURVEY_WRITE_RATE_LIMIT", 120),
    surveyWriteRateWindowMs: integer(
      source,
      "SURVEY_WRITE_RATE_WINDOW_MS",
      60_000,
    ),
    jumpRuleMaxPerQuestion,
  });
}

export const env = loadEnv();
