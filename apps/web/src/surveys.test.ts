import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changedDraftFields,
  buildQuestionPatch,
  clearSettingsDraft,
  deleteQuestion,
  findSettingsDraft,
  saveSettingsDraft,
  type DraftFields,
} from "./surveys";

const values = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  setItem: (key: string, value: string) => values.set(key, value),
  getItem: (key: string) => values.get(key) ?? null,
  removeItem: (key: string) => values.delete(key),
  get length() {
    return values.size;
  },
  key: (index: number) => [...values.keys()][index] ?? null,
});
const base: DraftFields = {
  title: "标题",
  description: "",
  identityMode: "anonymous",
  allowMultipleSubmissions: false,
  deadline: "2026-01-01T00:00:00.000Z",
};

describe("survey settings drafts", () => {
  beforeEach(() => values.clear());
  it("keys recovery data by survey, version and revision and clears it", () => {
    saveSettingsDraft("s1", "v1", 3, base);
    const stored = findSettingsDraft("s1", "v1")!;
    expect(stored.key).toContain("s1:v1:3");
    expect(stored.draft.revision).toBe(3);
    clearSettingsDraft(stored.key);
    expect(findSettingsDraft("s1", "v1")).toBeUndefined();
  });
  it("sends only changed fields and does not resubmit an unchanged stale deadline", () => {
    expect(changedDraftFields(base, { ...base, title: "新标题" })).toEqual({
      title: "新标题",
    });
  });
});

describe("question request whitelist", () => {
  it("does not echo immutable response fields", () => {
    const body = buildQuestionPatch(4, {
      title: "问题",
      required: true,
      validation: { minLength: 0, maxLength: 20, digitsOnly: false },
      options: [],
    });
    expect(body).toEqual({
      revision: 4,
      title: "问题",
      required: true,
      validation: { minLength: 0, maxLength: 20, digitsOnly: false },
      options: [],
    });
    expect(body).not.toHaveProperty("type");
    expect(body).not.toHaveProperty("questionId");
    expect(body).not.toHaveProperty("jumpRules");
  });

  it("sends DELETE revision as a JSON request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: { id: "v1" },
          surveyUpdatedAt: "2026-10-18T00:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await deleteQuestion("s1", "v1", "q_first", 7);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/surveys/s1/versions/v1/questions/q_first",
      expect.objectContaining({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 7 }),
      }),
    );
  });
});
