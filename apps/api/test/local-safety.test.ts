import { describe, expect, it } from "vitest";
import { assertLocalMongoUri } from "../src/database/local-safety.js";

describe("assertLocalMongoUri", () => {
  it("accepts only local hosts and optional test suffix", () => {
    expect(() =>
      assertLocalMongoUri("mongodb://127.0.0.1:27017/survey_stage1_test", true),
    ).not.toThrow();
    expect(() =>
      assertLocalMongoUri(
        "mongodb://localhost:27017,mongodb:27018/survey_stage1_test",
        true,
      ),
    ).not.toThrow();
  });
  it.each([
    "mongodb+srv://cluster.example/survey_test",
    "mongodb://127.0.0.1:27017,evil.example:27017/survey_test",
    "mongodb://127.0.0.1:27017/survey_stage1",
  ])("rejects unsafe test URI %s", (uri) => {
    expect(() => assertLocalMongoUri(uri, true)).toThrow();
  });
});
