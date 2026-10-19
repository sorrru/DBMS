import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { SurveyCursorService } from "../src/surveys/cursor.js";

describe("survey cursor kinds", () => {
  const cursors = new SurveyCursorService("cursor-test-secret");

  it("round trips each cursor and rejects cross-endpoint reuse", () => {
    const id = new Types.ObjectId().toString();
    const updatedAt = new Date("2026-10-19T00:00:00.000Z");
    const surveyCursor = cursors.encode({ id, updatedAt });
    expect(cursors.decode(surveyCursor)).toEqual({ id, updatedAt });
    expect(() => cursors.decodeVersion(surveyCursor, id)).toThrow();

    const versionCursor = cursors.encodeVersion({
      surveyId: id,
      versionNumber: 3,
    });
    expect(cursors.decodeVersion(versionCursor, id)).toEqual({
      surveyId: id,
      versionNumber: 3,
    });
    expect(() => cursors.decode(versionCursor)).toThrow();
    expect(() =>
      cursors.decodeVersion(versionCursor, new Types.ObjectId().toString()),
    ).toThrow();
  });
});
