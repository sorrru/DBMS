import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ],
  quiet: true,
});

function stringValue(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function portValue(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT 必须是 1 至 65535 之间的整数");
  }
  return port;
}

export const env = Object.freeze({
  apiPort: portValue(stringValue("API_PORT", "3000")),
  webOrigin: stringValue("WEB_ORIGIN", "http://localhost:5173"),
  mongoUri: stringValue(
    "MONGODB_URI",
    "mongodb://127.0.0.1:27017/survey_stage1?replicaSet=rs0&directConnection=true",
  ),
});
