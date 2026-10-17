import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("reports the API and database states without requiring a database", async () => {
    const response = await request(createApp()).get("/api/health").expect(200);

    expect(response.body.services.api).toBe("connected");
    expect(["connected", "connecting", "disconnected"]).toContain(
      response.body.services.database,
    );
    expect(response.body.timestamp).toEqual(expect.any(String));
  });
});
