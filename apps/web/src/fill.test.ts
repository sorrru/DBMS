import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicFillVersion } from "./fill";
import {
  fillAccountExitRequest,
  clearFillDraftsForSession,
  fillDraftKey,
  fillStartControl,
  parseFillRoute,
  restoreFillDraft,
  safeFillReturnPath,
  saveFillDraft,
  submitFillSession,
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
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
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

  it("keeps an active session return path and warns before signing out", () => {
    expect(
      fillAccountExitRequest(
        { publicId: "public_1", sessionId: "abc123" },
        true,
      ),
    ).toEqual({
      returnPath: "/fill/public_1/session/abc123",
      confirmation:
        "未提交内容保存在本浏览器中。重新登录同一账号后可以继续；切换账号不能继续当前会话。确定退出登录吗？",
    });
    expect(
      fillAccountExitRequest(
        { publicId: "public_1", sessionId: "old-session" },
        false,
      ),
    ).toEqual({ returnPath: "/fill/public_1" });
  });
});

describe("fill start control", () => {
  it("disables a version already submitted by the current account", () => {
    expect(
      fillStartControl({
        status: "published",
        starting: false,
        authenticated: true,
        alreadySubmitted: true,
      }),
    ).toEqual({ disabled: true, label: "该账号已提交" });
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

  it("clears every local draft belonging to a rejected session", () => {
    sessionStorage.setItem("fill-draft:s1:v1", "first");
    sessionStorage.setItem("fill-draft:s1:v2", "second");
    sessionStorage.setItem("fill-draft:s2:v1", "keep");

    clearFillDraftsForSession("s1");

    expect(sessionStorage.getItem("fill-draft:s1:v1")).toBeNull();
    expect(sessionStorage.getItem("fill-draft:s1:v2")).toBeNull();
    expect(sessionStorage.getItem("fill-draft:s2:v1")).toBe("keep");
  });
});

describe("formal submission", () => {
  it("sends only the documented answers envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        submission: {
          id: "response1",
          submittedAt: "2027-01-01T00:00:00.000Z",
          versionId: "version1",
          questionPath: ["q_text"],
          ignoredQuestionIds: [],
          alreadySubmitted: false,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await submitFillSession("session1", [
      { questionId: "q_text", value: "answer" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/sessions/session1/submit",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({
          answers: [{ questionId: "q_text", value: "answer" }],
        }),
      }),
    );
  });
});
