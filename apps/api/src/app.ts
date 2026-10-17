import cors from "cors";
import express, { type Express } from "express";
import { env } from "./config/env.js";
import {
  checkDatabaseStatus,
  type DatabaseStatus,
} from "./database/connection.js";

export interface HealthResponse {
  status: "ok" | "degraded";
  services: {
    api: "connected";
    database: DatabaseStatus;
  };
  timestamp: string;
}

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: env.webOrigin }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", async (_request, response) => {
    const database = await checkDatabaseStatus();
    const body: HealthResponse = {
      status: database === "connected" ? "ok" : "degraded",
      services: { api: "connected", database },
      timestamp: new Date().toISOString(),
    };
    response.json(body);
  });

  return app;
}
