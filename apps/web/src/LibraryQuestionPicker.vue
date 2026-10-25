<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { listBanks, listBankItems, type Bank } from "./banks";
import LibraryVersionDiff from "./LibraryVersionDiff.vue";
import {
  listLibraryQuestions,
  getLibraryVersion,
  listSharedQuestions,
  listLibraryVersions,
  type LibraryPage,
  type LibraryDefinition,
  type LibraryVersionView,
  describeLibraryValidation,
} from "./library";
const props = defineProps<{
  busy: boolean;
  hideBanks?: boolean;
  libraryQuestionId?: string;
  currentVersionId?: string;
  baseline?: LibraryDefinition;
}>();
const emit = defineEmits<{
  select: [version: LibraryVersionView];
  cancel: [];
  failure: [error: unknown];
}>();
const showHistory = ref(false);
const banks = ref<Bank[]>([]),
  bankCursor = ref<string | null>(null),
  selectedBank = ref("");
const collection = ref<"mine" | "shared" | "banks">("mine");
const items = ref<LibraryPage["items"]>([]),
  cursor = ref<string | null>(null),
  versions = ref<LibraryVersionView[]>([]),
  versionCursor = ref<string | null>(null),
  selectedIdentity = ref(""),
  selectedVersion = ref(""),
  loading = ref(false),
  error = ref("");
const selected = computed(() =>
  versions.value.find((v) => v.questionVersionId === selectedVersion.value),
);
async function run(task: () => Promise<void>) {
  loading.value = true;
  error.value = "";
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
    emit("failure", e);
  } finally {
    loading.value = false;
  }
}
async function loadQuestions(more = false) {
  if (collection.value === "banks") {
    if (!selectedBank.value) {
      items.value = [];
      cursor.value = null;
      return;
    }
    const page = await listBankItems(
      selectedBank.value,
      more ? (cursor.value ?? undefined) : undefined,
    );
    const available = page.items.flatMap((item) =>
      item.version
        ? [
            {
              question: { libraryQuestionId: item.libraryQuestionId },
              version: item.version,
            },
          ]
        : [],
    );
    items.value = (
      more ? [...items.value, ...available] : available
    ) as LibraryPage["items"];
    cursor.value = page.nextCursor;
    return;
  }
  const data = await (
    collection.value === "mine" ? listLibraryQuestions : listSharedQuestions
  )(more ? (cursor.value ?? undefined) : undefined);
  items.value = more ? [...items.value, ...data.items] : data.items;
  cursor.value = data.nextCursor;
}
async function loadVersions(more = false) {
  if (!selectedIdentity.value) return;
  const data = await listLibraryVersions(
    selectedIdentity.value,
    more ? (versionCursor.value ?? undefined) : undefined,
  );
  const all = [...versions.value, ...data.items];
  versions.value = [
    ...new Map(all.map((v) => [v.questionVersionId, v])).values(),
  ];
  versionCursor.value = data.nextCursor;
}
async function loadCurrent() {
  if (!selectedIdentity.value) return;
  const detail = await getLibraryVersion(selectedIdentity.value);
  versions.value = [detail.version];
  selectedVersion.value = detail.version.questionVersionId;
  versionCursor.value = null;
  showHistory.value = false;
}
async function toggleHistory() {
  if (showHistory.value) {
    await run(loadCurrent);
    return;
  }
  await run(async () => {
    await loadVersions();
    showHistory.value = true;
  });
}
async function switchCollection(value: "mine" | "shared" | "banks") {
  collection.value = value;
  selectedIdentity.value = "";
  showHistory.value = false;
  versions.value = [];
  selectedVersion.value = "";
  cursor.value = null;
  await run(async () => {
    if (value === "banks") await loadBanks();
    await loadQuestions();
  });
}
async function loadBanks(more = false) {
  const page = await listBanks(
    more ? (bankCursor.value ?? undefined) : undefined,
  );
  banks.value = more ? [...banks.value, ...page.items] : page.items;
  bankCursor.value = page.nextCursor;
}
async function chooseBank(id: string) {
  selectedBank.value = id;
  selectedIdentity.value = "";
  versions.value = [];
  selectedVersion.value = "";
  showHistory.value = false;
  await run(() => loadQuestions());
}
async function chooseIdentity(id: string) {
  selectedIdentity.value = id;
  versions.value = [];
  selectedVersion.value = "";
  versionCursor.value = null;
  if (collection.value === "banks") {
    const item = items.value.find((i) => i.question.libraryQuestionId === id);
    versions.value = item ? [item.version] : [];
    selectedVersion.value = item?.version.questionVersionId ?? "";
    showHistory.value = false;
  } else await run(loadCurrent);
}
onMounted(() =>
  run(async () => {
    if (props.libraryQuestionId) {
      selectedIdentity.value = props.libraryQuestionId;
      await loadCurrent();
    } else await loadQuestions();
  }),
);
</script>
<template>
  <section
    class="library-picker"
    aria-label="从常用题目选择版本"
    :aria-busy="loading"
  >
    <h4>
      {{ libraryQuestionId ? "换用常用题目的其他版本" : "从常用题目选入" }}
    </h4>
    <p class="muted">
      选入具体版本后保存完整快照，该库版本将永久冻结；以后创建新版本不会自动改变问卷。
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="!libraryQuestionId">
      <div class="library-picker-actions">
        <button
          type="button"
          class="secondary compact"
          :aria-pressed="collection === 'mine'"
          :disabled="busy || loading"
          @click="switchCollection('mine')"
        >
          我的题目</button
        ><button
          type="button"
          class="secondary compact"
          :aria-pressed="collection === 'shared'"
          :disabled="busy || loading"
          @click="switchCollection('shared')"
        >
          共享给我</button
        ><button
          v-if="!hideBanks"
          type="button"
          class="secondary compact"
          :aria-pressed="collection === 'banks'"
          :disabled="busy || loading"
          @click="switchCollection('banks')"
        >
          按题库选择
        </button>
      </div>
      <template v-if="collection === 'banks'">
        <label
          >选择题库<select
            :value="selectedBank"
            :disabled="busy || loading"
            @change="chooseBank(($event.target as HTMLSelectElement).value)"
          >
            <option value="">请选择题库</option>
            <option
              v-for="bank in banks"
              :key="bank.bankId"
              :value="bank.bankId"
            >
              {{ bank.name }}
            </option>
          </select></label
        >
        <button
          v-if="bankCursor"
          class="secondary compact"
          :disabled="busy || loading"
          @click="run(() => loadBanks(true))"
        >
          更多题库
        </button>
        <p class="muted">按题库成员策略选取版本；授权失效的成员不会列出。</p>
      </template>
      <label
        >选择题目<select
          :value="selectedIdentity"
          :disabled="busy || loading"
          @change="chooseIdentity(($event.target as HTMLSelectElement).value)"
        >
          <option value="">请选择</option>
          <option
            v-for="item in items"
            :key="item.question.libraryQuestionId"
            :value="item.question.libraryQuestionId"
          >
            {{ item.version.definition.title }}
          </option>
        </select></label
      >
      <p v-if="!items.length && !loading" class="muted">
        暂无常用题目，请先在题目管理中创建，或保存问卷中的现有题目。
      </p>
      <button
        v-if="cursor"
        type="button"
        class="secondary compact"
        :disabled="busy || loading"
        @click="run(() => loadQuestions(true))"
      >
        更多题目
      </button>
    </template>
    <p v-if="selected && !showHistory" class="muted">
      {{ collection === "banks" ? "题库选定版本" : "当前版本" }} v{{
        selected.versionNumber
      }}
    </p>
    <button
      v-if="versions.length && collection !== 'banks'"
      type="button"
      class="secondary compact"
      :disabled="busy || loading"
      :aria-expanded="showHistory"
      @click="toggleHistory"
    >
      {{ showHistory ? "返回当前版本" : "选择历史版本" }}
    </button>
    <label v-if="showHistory && versions.length"
      >选择版本<select v-model="selectedVersion" :disabled="busy || loading">
        <option
          v-for="version in versions"
          :key="version.questionVersionId"
          :value="version.questionVersionId"
        >
          v{{ version.versionNumber }} · {{ version.definition.title
          }}{{
            version.questionVersionId === currentVersionId ? "（当前已用）" : ""
          }}
        </option>
      </select></label
    >
    <button
      v-if="showHistory && versionCursor"
      type="button"
      class="secondary compact"
      :disabled="busy || loading"
      @click="run(() => loadVersions(true))"
    >
      更多历史版本
    </button>
    <div v-if="selected" class="library-picker-preview">
      <strong>{{ selected.definition.title }}</strong>
      <p>
        {{ selected.definition.required ? "必答" : "非必答" }} ·
        {{
          describeLibraryValidation(
            selected.definition.type,
            selected.definition.validation,
          )
        }}
      </p>
      <ul>
        <li
          v-for="option in selected.definition.options"
          :key="option.optionId"
        >
          {{ option.text }}
        </li>
      </ul>
    </div>
    <LibraryVersionDiff
      v-if="baseline && selected"
      :baseline="baseline"
      :candidate="selected.definition"
    />
    <div class="library-picker-actions">
      <button
        type="button"
        class="primary compact"
        :disabled="
          busy ||
          loading ||
          !selected ||
          selected.questionVersionId === currentVersionId
        "
        @click="selected && emit('select', selected)"
      >
        {{ libraryQuestionId ? "确认换用此版本" : "选入此版本" }}</button
      ><button
        type="button"
        class="secondary compact"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消</button
      ><button
        v-if="error"
        type="button"
        class="secondary compact"
        :disabled="busy || loading"
        @click="
          run(() => (selectedIdentity ? loadVersions() : loadQuestions()))
        "
      >
        重新加载
      </button>
    </div>
  </section>
</template>
<style scoped>
.library-picker {
  padding: 1rem;
  border: 1px solid #b9cce0;
  border-radius: 0.75rem;
  margin: 1rem 0;
  background: #f8fbfe;
  display: grid;
  gap: 0.75rem;
}
.library-picker h4,
.library-picker p {
  margin: 0;
}
.library-picker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.library-picker-preview {
  overflow-wrap: anywhere;
}
</style>
