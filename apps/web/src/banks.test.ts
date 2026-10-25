import { createRenderer, nextTick, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import LibraryQuestionPicker from "./LibraryQuestionPicker.vue";
import QuestionBanksView from "./QuestionBanksView.vue";
import { saveBankItem } from "./banks";
const state = vi.hoisted(() => ({
  listBanks: vi.fn(),
  listBankItems: vi.fn(),
  listLibraryQuestions: vi.fn(),
  getLibraryVersion: vi.fn(),
}));
vi.mock("./banks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./banks")>()),
  listBanks: state.listBanks,
  listBankItems: state.listBankItems,
}));
vi.mock("./library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./library")>()),
  listLibraryQuestions: state.listLibraryQuestions,
  getLibraryVersion: state.getLibraryVersion,
}));
type Node = {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: Node[];
  parent: Node | null;
};
function node(tag: string, text = ""): Node {
  return { tag, text, props: {}, children: [], parent: null };
}
const renderer = createRenderer<Node, Node>({
  createElement: (tag) => node(tag),
  createText: (text) => node("text", text),
  createComment: (text) => node("comment", text),
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.text = text;
    n.children = [];
  },
  patchProp: (n, key, _old, value) => {
    n.props[key] = value;
  },
  insert: (n, parent, anchor) => {
    if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n);
    n.parent = parent;
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i < 0) parent.children.push(n);
    else parent.children.splice(i, 0, n);
  },
  remove: (n) => {
    if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n);
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) =>
    n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
});
const version = {
  libraryQuestionId: "a".repeat(24),
  questionVersionId: "b".repeat(24),
  versionNumber: 1,
  contentRevision: 1,
  frozenAt: null,
  freezeReasons: [],
  parentVersionId: null,
  restoredFromVersionId: null,
  definition: {
    type: "number",
    title: "固定旧年龄题",
    required: true,
    validation: { integerOnly: true },
    options: [],
  },
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};
async function settle() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await nextTick();
  }
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("selects the bank's pinned version instead of silently replacing it with current", async () => {
  state.listLibraryQuestions.mockResolvedValue({ items: [], nextCursor: null });
  state.listBanks.mockResolvedValue({
    items: [{ bankId: "bank", name: "基本信息" }],
    nextCursor: null,
  });
  state.listBankItems.mockResolvedValue({
    items: [
      {
        libraryQuestionId: version.libraryQuestionId,
        versionPolicy: "pinned",
        version,
      },
    ],
    nextCursor: null,
  });
  state.getLibraryVersion.mockResolvedValue({
    version: { ...version, versionNumber: 9 },
  });
  const selected = vi.fn(),
    root = node("root");
  const app = renderer.createApp(
    { ...LibraryQuestionPicker, render: () => null },
    { busy: false, onSelect: selected },
  );
  app.provide(ssrContextKey, { modules: new Set() });
  const instance = app.mount(root);
  const pickerState = (
    instance.$ as unknown as { setupState: Record<string, unknown> }
  ).setupState as {
    switchCollection: (value: string) => Promise<void>;
    chooseBank: (value: string) => Promise<void>;
    chooseIdentity: (value: string) => Promise<void>;
    selected: typeof version;
    showHistory: boolean;
  };
  await settle();
  await pickerState.switchCollection("banks");
  await pickerState.chooseBank("bank");
  await pickerState.chooseIdentity(version.libraryQuestionId);
  expect(pickerState.selected).toEqual(version);
  expect(pickerState.showHistory).toBe(false);
  expect(state.getLibraryVersion).not.toHaveBeenCalled();
  app.unmount();
});
it("renders bank classification controls and suppresses recursive bank selection when adding members", async () => {
  const html = await renderToString(createSSRApp(QuestionBanksView));
  expect(html).toContain("创建题库");
  expect(html).toContain("更新不影响已有问卷");
  const picker = await renderToString(
    createSSRApp(LibraryQuestionPicker, { busy: false, hideBanks: true }),
  );
  expect(picker).not.toContain("按题库选择");
  expect(picker).toContain("共享给我");
});
it("uses distinct latest and pinned API contracts with member revision", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ accepted: true }),
  });
  vi.stubGlobal("fetch", fetch);
  await saveBankItem(
    "bank",
    version.libraryQuestionId,
    "latest",
    version.questionVersionId,
  );
  await saveBankItem(
    "bank",
    version.libraryQuestionId,
    "pinned",
    version.questionVersionId,
    {
      itemId: "member",
      revision: 3,
      libraryQuestionId: version.libraryQuestionId,
      versionPolicy: "latest",
      questionVersionId: null,
      available: true,
      version: null,
    },
  );
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({
    versionPolicy: "latest",
    questionVersionId: null,
  });
  expect(fetch.mock.calls[1]![0]).toBe("/api/question-banks/bank/items/member");
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({
    versionPolicy: "pinned",
    questionVersionId: version.questionVersionId,
    revision: 3,
  });
});
it("refreshes the preview when switching a pinned historical selection to follow latest", async () => {
  state.listBanks.mockResolvedValue({ items: [], nextCursor: null });
  const latest = {
    ...version,
    versionNumber: 4,
    questionVersionId: "c".repeat(24),
    definition: { ...version.definition, title: "最新年龄题" },
  };
  state.getLibraryVersion.mockResolvedValue({ version: latest });
  const app = renderer.createApp({ ...QuestionBanksView, render: () => null });
  app.provide(ssrContextKey, { modules: new Set() });
  const instance = app.mount(node("root"));
  const bankState = (
    instance.$ as unknown as {
      setupState: {
        candidate: typeof version | null;
        policy: string;
        choose: (v: typeof version) => void;
        changePolicy: () => Promise<void>;
      };
    }
  ).setupState;
  await settle();
  bankState.choose(version);
  expect(bankState.policy).toBe("pinned");
  bankState.policy = "latest";
  await bankState.changePolicy();
  expect(bankState.candidate).toEqual(latest);
  app.unmount();
});
