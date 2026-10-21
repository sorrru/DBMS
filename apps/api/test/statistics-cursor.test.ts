import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { StatisticsCursorService } from "../src/statistics/cursor.js";

describe("encrypted statistics text cursor", () => {
  const cursors = new StatisticsCursorService("s".repeat(40));
  const surveyId = new Types.ObjectId().toString();
  const versionId = new Types.ObjectId().toString();
  const id = new Types.ObjectId().toString();

  it("round trips only for the bound query without exposing plaintext", () => {
    const submittedAt = "2027-01-02T03:04:05.678Z";
    const token = cursors.encode({
      surveyId,
      versionId,
      questionId: "q_text",
      submittedAt,
      id,
    });
    expect(token).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(token).not.toContain(submittedAt);
    expect(token).not.toContain(id);
    expect(() =>
      JSON.parse(Buffer.from(token, "base64url").toString()),
    ).toThrow();
    expect(
      cursors.decode(token, { surveyId, versionId, questionId: "q_text" }),
    ).toMatchObject({
      submittedAt,
      id,
    });
    expect(() =>
      cursors.decode(token, { surveyId, versionId, questionId: "q_other" }),
    ).toThrow();
  });

  it("rejects tampering", () => {
    const token = cursors.encode({
      surveyId,
      versionId,
      questionId: "q_text",
      submittedAt: new Date().toISOString(),
      id,
    });
    const parts = token.split(".");
    const encrypted = parts[2]!;
    const first = encrypted[0]!;
    parts[2] = `${first === "A" ? "B" : "A"}${encrypted.slice(1)}`;
    expect(() =>
      cursors.decode(parts.join("."), {
        surveyId,
        versionId,
        questionId: "q_text",
      }),
    ).toThrow();
  });

  it("binds identified submission cursors to their survey and version", () => {
    const submittedAt = "2027-01-03T04:05:06.789Z";
    const token = cursors.encodeSubmissions({
      surveyId,
      versionId,
      submittedAt,
      id,
    });
    expect(token).not.toContain(submittedAt);
    expect(token).not.toContain(id);
    expect(
      cursors.decodeSubmissions(token, { surveyId, versionId }),
    ).toMatchObject({ submittedAt, id });
    expect(() =>
      cursors.decodeSubmissions(token, {
        surveyId,
        versionId: new Types.ObjectId().toString(),
      }),
    ).toThrow();
    expect(() =>
      cursors.decode(token, { surveyId, versionId, questionId: "q_text" }),
    ).toThrow();
  });
});
