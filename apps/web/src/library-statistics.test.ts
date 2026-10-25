import { createRenderer, createSSRApp, nextTick, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { afterEach, expect, it, vi } from "vitest";
import LibraryStatisticsPanel from "./LibraryStatisticsPanel.vue";
import {
  queryLibraryStatistics,
  type LibraryStatisticsResult,
  type StatisticsCatalog,
} from "./library-statistics";
const api = vi.hoisted(() => ({ catalog: vi.fn(), query: vi.fn() }));
vi.mock("./library-statistics", async (original) => ({
  ...(await original<typeof import("./library-statistics")>()),
  libraryStatisticsCatalog: api.catalog,
  queryLibraryStatistics: api.query,
}));
const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
});
function mount() {
  const app = renderer.createApp(
    { ...LibraryStatisticsPanel, render: () => null },
    { libraryQuestionId: "a".repeat(24) },
  );
  app.provide(ssrContextKey, { modules: new Set() });
  const instance = app.mount({});
  return {
    app,
    state: (
      instance.$ as unknown as {
        setupState: {
          toggle: () => Promise<void>;
          query: (more?: boolean) => Promise<void>;
          selectedIds: string[];
          merge: boolean;
          confirmed: boolean;
          result: LibraryStatisticsResult | null;
          boundaries: string;
          input: () => unknown;
          numeric: boolean;
        };
      }
    ).setupState,
  };
}
const catalog: StatisticsCatalog = {
  libraryQuestionId: "a".repeat(24),
  scope: "own-published-surveys",
  sourceCount: 2,
  versions: [1, 2].map((n) => ({
    questionVersionId: String(n).repeat(24),
    versionNumber: n,
    sourceCount: 1,
    surveyCount: 1,
    definition: {
      type: "number",
      title: `年龄${n}`,
      required: true,
      validation: { integerOnly: true, minValue: null, maxValue: null },
      options: [],
    },
  })),
};
const empty: LibraryStatisticsResult = {
  libraryQuestionId: catalog.libraryQuestionId,
  merged: false,
  versions: [],
  groups: [],
  text: null,
  generatedAt: "2026-10-22T00:00:00Z",
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("keeps the default interface collapsed without reading any answers", async () => {
  const html = await renderToString(
    createSSRApp(LibraryStatisticsPanel, {
      libraryQuestionId: catalog.libraryQuestionId,
    }),
  );
  expect(html).toContain("跨问卷统计");
  expect(html).toContain('aria-expanded="false"');
  expect(api.catalog).not.toHaveBeenCalled();
  expect(api.query).not.toHaveBeenCalled();
});
it("defaults to separate versions and clears stale merge confirmation and results when filters change", async () => {
  api.catalog.mockResolvedValue(catalog);
  api.query.mockResolvedValue(empty);
  const { app, state } = mount();
  await state.toggle();
  await nextTick();
  expect(state.selectedIds).toHaveLength(2);
  expect(state.merge).toBe(false);
  await state.query();
  expect(api.query.mock.calls[0]![1]).toMatchObject({
    merge: false,
    confirmMerge: false,
  });
  state.merge = true;
  await nextTick();
  state.confirmed = true;
  await state.query();
  expect(api.query.mock.calls[1]![1]).toMatchObject({
    merge: true,
    confirmMerge: true,
  });
  state.selectedIds = [state.selectedIds[0]!];
  await nextTick();
  expect(state.confirmed).toBe(false);
  expect(state.result).toBeNull();
  app.unmount();
});
it("validates numeric bucket inputs before sending a request", async () => {
  api.catalog.mockResolvedValue(catalog);
  const { app, state } = mount();
  await state.toggle();
  await nextTick();
  state.boundaries = "18,0";
  expect(() => state.input()).toThrow("严格递增");
  state.boundaries = "0,18,30";
  expect(state.input()).toMatchObject({ boundaries: [0, 18, 30] });
  app.unmount();
});
it("appends text pages with the same explicit filters and encrypted cursor", async () => {
  api.catalog.mockResolvedValue({
    ...catalog,
    versions: catalog.versions.map((v) => ({
      ...v,
      definition: { ...v.definition, type: "text" },
    })),
  });
  api.query
    .mockResolvedValueOnce({
      ...empty,
      text: {
        items: [
          {
            value: "first",
            submittedDate: "2026-10-22",
            questionVersionId: "1".repeat(24),
          },
        ],
        nextCursor: "encrypted",
      },
    })
    .mockResolvedValueOnce({
      ...empty,
      text: {
        items: [
          {
            value: "second",
            submittedDate: "2026-10-22",
            questionVersionId: "2".repeat(24),
          },
        ],
        nextCursor: null,
      },
    });
  const { app, state } = mount();
  await state.toggle();
  await nextTick();
  await state.query();
  await state.query(true);
  expect(api.query.mock.calls[1]![1]).toMatchObject({
    cursor: "encrypted",
    merge: false,
  });
  expect(state.result!.text!.items.map((i) => i.value)).toEqual([
    "first",
    "second",
  ]);
  app.unmount();
});
it("sends the statistics query with JSON, origin credentials and explicit merge confirmation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => empty });
  vi.stubGlobal("fetch", fetch);
  const actual = await vi.importActual<typeof import("./library-statistics")>(
    "./library-statistics",
  );
  await actual.queryLibraryStatistics("identity", {
    questionVersionIds: ["version"],
    merge: true,
    confirmMerge: true,
    boundaries: [0, 18],
  });
  expect(fetch.mock.calls[0]![0]).toBe(
    "/api/questions/identity/statistics/query",
  );
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({
    merge: true,
    confirmMerge: true,
  });
});
