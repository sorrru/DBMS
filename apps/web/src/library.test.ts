import { createSSRApp, reactive } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, it, expect, vi, afterEach } from "vitest";
import LibraryVersionDiff from "./LibraryVersionDiff.vue";
import {
  branchLibraryVersion,
  editableLibraryDefinition,
  restoreLibraryVersion,
  editLibraryVersion,
} from "./library";
import type { LibraryDefinition } from "./library";
const base: LibraryDefinition = {
  type: "single",
  title: "原题",
  required: true,
  validation: {},
  options: [
    { optionId: "o_yes", text: "同意" },
    { optionId: "o_no", text: "不同意" },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe("library version comparison and mutations", () => {
  it("opens a Vue reactive version for editing without cloning a Proxy or mutating the original", () => {
    const selected = reactive(base);
    const editable = editableLibraryDefinition(selected);
    editable.options[0]!.text = "修改后";
    editable.validation.newValue = 1;
    expect(selected.options[0]!.text).toBe("同意");
    expect(selected.validation).not.toHaveProperty("newValue");
  });
  it("renders changes as safe text, including option identity differences without exposing raw config JSON", async () => {
    const html = await renderToString(
      createSSRApp(LibraryVersionDiff, {
        baseline: base,
        candidate: {
          ...base,
          title: "<img src=x onerror=alert(1)>",
          options: [
            { optionId: "o_new", text: "同意" },
            { optionId: "o_no", text: "不同意" },
          ],
        },
      }),
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("选项身份有变化");
    expect(html).toContain("标题");
  });
  it("distinguishes in-place modification, branching, and restoration API contracts", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", mock);
    await editLibraryVersion("identity", "v1", {
      contentRevision: 3,
      title: "修正",
    });
    await branchLibraryVersion("identity", {
      sourceVersionId: "v1",
      contentRevision: 3,
      title: "新版本",
    });
    await restoreLibraryVersion("identity", {
      restoredFromVersionId: "v1",
      sourceContentRevision: 3,
      baseVersionId: "v4",
      baseContentRevision: 1,
    });
    expect(
      mock.mock.calls.map((call) => [
        call[0],
        call[1].method,
        JSON.parse(call[1].body),
      ]),
    ).toEqual([
      [
        "/api/questions/identity/versions/v1",
        "PATCH",
        { contentRevision: 3, title: "修正" },
      ],
      [
        "/api/questions/identity/versions",
        "POST",
        { sourceVersionId: "v1", contentRevision: 3, title: "新版本" },
      ],
      [
        "/api/questions/identity/restore",
        "POST",
        {
          restoredFromVersionId: "v1",
          sourceContentRevision: 3,
          baseVersionId: "v4",
          baseContentRevision: 1,
        },
      ],
    ]);
    expect(
      mock.mock.calls.every((call) => call[1].credentials === "include"),
    ).toBe(true);
  });
  it("shows normalized numeric validation differences using reader-facing labels", async () => {
    const baseline: LibraryDefinition = {
      ...base,
      type: "number",
      options: [],
      validation: { integerOnly: true, minValue: 0, maxValue: 120 },
    };
    const html = await renderToString(
      createSSRApp(LibraryVersionDiff, {
        baseline,
        candidate: {
          ...baseline,
          validation: { integerOnly: true, minValue: 18, maxValue: 120 },
        },
      }),
    );
    expect(html).toContain("最小值 0");
    expect(html).toContain("最小值 18");
    expect(html).not.toContain("integerOnly");
  });
});
