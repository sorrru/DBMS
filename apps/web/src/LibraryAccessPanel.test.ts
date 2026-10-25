import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, it, expect } from "vitest";
import LibraryAccessPanel from "./LibraryAccessPanel.vue";
import LibraryQuestionPicker from "./LibraryQuestionPicker.vue";
import type { LibraryVersionView } from "./library";
const version: LibraryVersionView = {
  libraryQuestionId: "a".repeat(24),
  questionVersionId: "b".repeat(24),
  versionNumber: 1,
  contentRevision: 1,
  frozenAt: null,
  freezeReasons: [],
  parentVersionId: null,
  restoredFromVersionId: null,
  definition: {
    type: "text",
    title: "共享题",
    required: false,
    validation: { minLength: 0, maxLength: 100, digitsOnly: false },
    options: [],
  },
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};
describe("library sharing interface boundaries", () => {
  it("offers owner batch authorization and restricted aggregate view", async () => {
    const html = await renderToString(
      createSSRApp(LibraryAccessPanel, {
        libraryQuestionId: version.libraryQuestionId,
        version,
        isOwner: true,
        disabled: false,
      }),
    );
    expect(html).toContain("共享当前版本 v1");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("更多可共享版本");
    expect(html).toContain("他人使用汇总");
    expect(html).toContain("不提供问卷名称或回答");
  });
  it("shows recipients only their own usage and no grant or others controls", async () => {
    const html = await renderToString(
      createSSRApp(LibraryAccessPanel, {
        libraryQuestionId: version.libraryQuestionId,
        version,
        isOwner: false,
        disabled: false,
      }),
    );
    expect(html).toContain("自己问卷中的使用");
    expect(html).not.toContain("共享当前版本 v1");
    expect(html).not.toContain("他人使用汇总");
    expect(html).not.toContain("已建立的授权");
  });
  it("makes shared questions discoverable from the existing survey picker", async () => {
    const html = await renderToString(
      createSSRApp(LibraryQuestionPicker, { busy: false }),
    );
    expect(html).toContain("我的题目");
    expect(html).toContain("共享给我");
  });
});
