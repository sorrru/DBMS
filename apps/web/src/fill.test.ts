import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicFillVersion } from "./fill";
import {
  fillDraftKey,
  parseFillRoute,
  restoreFillDraft,
  safeFillReturnPath,
  saveFillDraft,
} from "./fill";

const version: PublicFillVersion = {
  id: "version1",
  versionNumber: 1,
  title: "测试",
  description: "",
  identityMode: "anonymous",
  deadline: null,
  sessionDurationMinutes: 30,
  questions: [
    {
      questionId: "q_text",
      type: "text",
      title: "文本",
      required: false,
      validation: { minLength: 0, maxLength: 20, digitsOnly: false },
      options: [],
      jumpRules: [],
    },
  ],
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("fill routes", () => {
  it("accepts only the documented same-site return paths", () => {
    expect(parseFillRoute("/fill/public_1")).toEqual({ publicId: "public_1" });
    expect(parseFillRoute("/fill/public_1/session/abc123")).toEqual({
      publicId: "public_1",
      sessionId: "abc123",
    });
    expect(safeFillReturnPath("https://evil.example/fill/x")).toBeUndefined();
    expect(safeFillReturnPath("//evil.example/fill/x")).toBeUndefined();
  });
});

describe("untrusted local fill drafts", () => {
  it("keeps only known, valid answers and recomputes the current path", () => {
    sessionStorage.setItem(
      fillDraftKey("session1", version.id),
      JSON.stringify({
        answers: { q_text: "  hello  ", unknown: "secret" },
        currentQuestionId: "unknown",
        savedAt: "2027-01-01T00:00:00Z",
        token: "must-not-be-read",
      }),
    );
    expect(restoreFillDraft("session1", version)).toEqual({
      answers: { q_text: "hello" },
      currentQuestionId: "q_text",
      savedAt: "2027-01-01T00:00:00Z",
    });
  });

  it("uses a session-and-version-scoped key", () => {
    saveFillDraft("s1", version.id, {
      answers: { q_text: "answer" },
      currentQuestionId: "q_text",
      savedAt: "now",
    });
    expect(sessionStorage.getItem("fill-draft:s1:version1")).toContain(
      "answer",
    );
    expect(restoreFillDraft("s2", version)).toBeUndefined();
  });
});
