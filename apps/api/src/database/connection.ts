import mongoose from "mongoose";
import { env } from "../config/env.js";

const retryDelayMs = 5_000;
let reconnectTimer: NodeJS.Timeout | undefined;

export type DatabaseStatus = "connected" | "connecting" | "disconnected";

export function getDatabaseStatus(): DatabaseStatus {
  if (mongoose.connection.readyState === 1) return "connected";
  if (mongoose.connection.readyState === 2) return "connecting";
  return "disconnected";
}

const pingTimeoutMs = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function checkDatabaseStatus(): Promise<DatabaseStatus> {
  const status = getDatabaseStatus();
  if (status !== "connected") return status;
  try {
    const db = mongoose.connection.db;
    if (!db) return "disconnected";
    await withTimeout(db.admin().ping(), pingTimeoutMs);
    return "connected";
  } catch {
    return "disconnected";
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectDatabase();
  }, retryDelayMs);
  reconnectTimer.unref();
}

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) return;
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 3_000 });
    const { UserModel } = await import("../models/user.js");
    const { SurveyModel } = await import("../models/survey.js");
    const { SurveyVersionModel } = await import("../models/survey-version.js");
    await Promise.all([
      UserModel.init(),
      SurveyModel.init(),
      SurveyVersionModel.init(),
    ]);
    console.info("MongoDB 已连接");
  } catch (error) {
    console.error("MongoDB 连接失败，将在 5 秒后重试", error);
    await mongoose.disconnect().catch(() => undefined);
    scheduleReconnect();
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  await mongoose.disconnect();
}
