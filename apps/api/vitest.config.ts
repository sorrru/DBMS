import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters",
      ANONYMOUS_ID_SECRET: "test-anonymous-secret-different-and-at-least-32",
      MONGODB_URI:
        "mongodb://127.0.0.1:27017/survey_stage1_test?replicaSet=rs0&directConnection=true",
      WEB_ORIGIN: "http://localhost:5173",
      NODE_ENV: "test",
    },
  },
});
