import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changedDraftFields,
  clearSettingsDraft,
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
