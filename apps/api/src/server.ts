import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./database/connection.js";

const app = createApp();
const server = app.listen(env.apiPort, () => {
  console.info(`API 已启动：http://localhost:${env.apiPort}`);
});

void connectDatabase();

async function shutdown(signal: string): Promise<void> {
  console.info(`收到 ${signal}，正在关闭服务`);
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
