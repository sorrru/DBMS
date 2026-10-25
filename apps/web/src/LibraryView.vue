<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from "vue";
import type { QuestionType } from "@survey/survey-logic";
import { ApiClientError } from "./auth";
import {
  listLibraryQuestions,
  listSharedQuestions,
  type LibraryOwnUsage,
  getLibraryVersion,
  listLibraryVersions,
  createLibraryQuestion,
  editLibraryVersion,
  branchLibraryVersion,
  restoreLibraryVersion,
  copyLibraryQuestion,
  describeLibraryValidation,
  editableLibraryDefinition,
  type LibraryDefinition,
  type LibraryDetail,
  type LibraryPage,
  type LibraryVersionView,
} from "./library";
import LibraryStatisticsPanel from "./LibraryStatisticsPanel.vue";
import LibraryAccessPanel from "./LibraryAccessPanel.vue";
import LibraryVersionDiff from "./LibraryVersionDiff.vue";
const emit = defineEmits<{
  failure: [error: unknown];
  locate: [usage: LibraryOwnUsage];
  dirty: [value: boolean];
  busy: [value: boolean];
}>();
const items = ref<LibraryPage["items"]>([]),
  cursor = ref<string | null>(null);
const collection = ref<"mine" | "shared">("mine");
const selected = ref<LibraryDetail>(),
  history = ref<LibraryVersionView[]>([]),
  historyCursor = ref<string | null>(null);
const mode = ref<"view" | "new" | "edit" | "branch">("view"),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const labels: Record<QuestionType, string> = {
  single: "单选",
  multiple: "多选",
  text: "文本",
  number: "数字",
};
interface Form extends Omit<LibraryDefinition, "validation" | "options"> {
  validation: Record<string, unknown>;
  options: Array<{ optionId?: string; text: string }>;
}
const form = reactive<Form>({
  type: "single",
  title: "",
  required: false,
  validation: {},
  options: [{ text: "" }, { text: "" }],
});
const fieldErrors = reactive<Record<string, string>>({});
function clearFieldErrors() {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
}
function clearFieldError(path: string) {
  delete fieldErrors[path];
  if (
    [
      "validation.minValue",
      "validation.maxValue",
      "validation.integerOnly",
    ].includes(path)
  )
    for (const key of [
      "validation.minValue",
      "validation.maxValue",
      "validation.integerOnly",
    ])
      delete fieldErrors[key];
}
const errorId = (path: string) =>
  `library-error-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;
function formErrorMessage(path: string): string | undefined {
  const messages: Record<string, string> = {
    title: "请输入符合长度要求的题目标题。",
    "validation.minValue": "请输入有效的最小值。",
    "validation.maxValue":
      typeof form.validation.minValue === "number" &&
      typeof form.validation.maxValue === "number" &&
      form.validation.minValue > form.validation.maxValue
        ? "最大值不能小于最小值。"
        : "请输入有效的最大值。",
    "validation.integerOnly": "启用仅整数时，最小值和最大值也必须是整数。",
    "validation.minSelections": "请输入有效的最少选择数。",
    "validation.maxSelections":
      "最多选择数不能小于最少选择数，也不能超过选项数量。",
    "validation.minLength": "请输入有效的最少字数。",
    "validation.maxLength": "最多字数不能小于最少字数，且不能超过 2000。",
  };
  return messages[path];
}
const showHistory = ref(false);
const historyChoice = ref("");
const isCurrent = computed(
  () =>
    selected.value?.version.questionVersionId ===
    selected.value?.question.latestVersionId,
);
const compareVersionId = ref("");
const compared = computed(() =>
  history.value.find((v) => v.questionVersionId === compareVersionId.value),
);
const dirty = computed(() => mode.value !== "view");
watch(dirty, (v) => emit("dirty", v), { immediate: true });
onBeforeUnmount(() => {
  emit("dirty", false);
  emit("busy", false);
});
function allowed(): boolean {
  return (
    !busy.value &&
    (!dirty.value || window.confirm("仍有未保存的题目内容，确定放弃吗？"))
  );
}
async function run(action: () => Promise<void>, formSave = false) {
  busy.value = true;
  emit("busy", true);
  error.value = "";
  let invalidPath: string | undefined;
  try {
    await action();
  } catch (e) {
    const path =
      e instanceof ApiClientError
        ? (e.details?.path ?? e.details?.field)
        : undefined;
    const message =
      formSave &&
      e instanceof ApiClientError &&
      e.code === "VALIDATION_ERROR" &&
      typeof path === "string"
        ? formErrorMessage(path)
        : undefined;
    if (message && typeof path === "string") {
      fieldErrors[path] = message;
      invalidPath = path;
    } else {
      error.value = e instanceof Error ? e.message : "操作失败";
      emit("failure", e);
    }
  } finally {
    busy.value = false;
    emit("busy", false);
    if (invalidPath) {
      await nextTick();
      if (typeof document !== "undefined") {
        const input = document.querySelector<HTMLElement>(
          `[aria-describedby="${errorId(invalidPath)}"]`,
        );
        input?.focus();
        input?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }
}
async function loadList(more = false) {
  const data = await (
    collection.value === "mine" ? listLibraryQuestions : listSharedQuestions
  )(more ? (cursor.value ?? undefined) : undefined);
  items.value = more ? [...items.value, ...data.items] : data.items;
  cursor.value = data.nextCursor;
}
async function loadHistory(more = false) {
  if (!selected.value) return;
  const data = await listLibraryVersions(
    selected.value.question.libraryQuestionId,
    more ? (historyCursor.value ?? undefined) : undefined,
  );
  history.value = more ? [...history.value, ...data.items] : data.items;
  historyCursor.value = data.nextCursor;
}
function fill(d: LibraryDefinition) {
  Object.assign(form, editableLibraryDefinition(d));
}
async function accept(d: LibraryDetail, keepHistory = false) {
  selected.value = d;
  compareVersionId.value = "";
  historyChoice.value = keepHistory ? d.version.questionVersionId : "";
  if (!keepHistory) {
    showHistory.value = false;
    history.value = [];
    historyCursor.value = null;
  }
  mode.value = "view";
  fill(d.version.definition);
  await loadList();
}
async function open(q: string, v?: string) {
  if (!allowed()) return;
  await run(async () => {
    const keep =
      showHistory.value &&
      q === selected.value?.question.libraryQuestionId &&
      v !== undefined;
    await accept(await getLibraryVersion(q, v), keep);
    notice.value = "";
  });
}
async function toggleHistory() {
  if (!selected.value || busy.value) return;
  if (showHistory.value) {
    if (!isCurrent.value) {
      await open(selected.value.question.libraryQuestionId);
      return;
    }
    showHistory.value = false;
    return;
  }
  await run(async () => {
    await loadHistory();
    showHistory.value = true;
  });
}
async function chooseHistory(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id && selected.value)
    await open(selected.value.question.libraryQuestionId, id);
}
async function switchCollection(value: "mine" | "shared") {
  if (!allowed()) return;
  collection.value = value;
  selected.value = undefined;
  mode.value = "view";
  await run(() => loadList());
}
function defaults() {
  clearFieldErrors();
  form.options = ["single", "multiple"].includes(form.type)
    ? [{ text: "" }, { text: "" }]
    : [];
  form.validation =
    form.type === "multiple"
      ? { minSelections: 1, maxSelections: 2 }
      : form.type === "text"
        ? { minLength: 0, maxLength: 2000, digitsOnly: false }
        : form.type === "number"
          ? { integerOnly: false, minValue: null, maxValue: null }
          : {};
}
function newQuestion() {
  if (!allowed()) return;
  const wasShared = collection.value === "shared";
  selected.value = undefined;
  history.value = [];
  collection.value = "mine";
  mode.value = "new";
  form.type = "single";
  form.title = "";
  form.required = false;
  defaults();
  error.value = "";
  notice.value = "";
  if (wasShared) void run(() => loadList());
}
function startEdit(kind: "edit" | "branch") {
  clearFieldErrors();
  if (
    !selected.value ||
    busy.value ||
    selected.value.access !== "owner" ||
    !isCurrent.value
  )
    return;
  if (kind === "edit" && !selected.value.modificationStatus.canEditInPlace)
    return;
  fill(selected.value.version.definition);
  mode.value = kind;
  notice.value = "";
}
function cancel() {
  if (!allowed()) return;
  mode.value = "view";
  if (selected.value) fill(selected.value.version.definition);
}
function payload() {
  const validation = { ...form.validation };
  if (form.type === "number")
    for (const key of ["minValue", "maxValue"])
      if (validation[key] === "") validation[key] = null;
  return {
    title: form.title,
    required: form.required,
    validation,
    options: form.options.map((o) => ({ ...o })),
  };
}
async function save() {
  clearFieldErrors();
  await run(async () => {
    const d = selected.value,
      p = payload();
    let result: LibraryDetail;
    if (mode.value === "new")
      result = await createLibraryQuestion({
        ...p,
        type: form.type,
        options: p.options.map((o) => ({ text: o.text })),
      });
    else if (d && mode.value === "edit")
      result = await editLibraryVersion(
        d.question.libraryQuestionId,
        d.version.questionVersionId,
        { ...p, contentRevision: d.version.contentRevision },
      );
    else if (d && mode.value === "branch")
      result = await branchLibraryVersion(d.question.libraryQuestionId, {
        ...p,
        sourceVersionId: d.version.questionVersionId,
        contentRevision: d.version.contentRevision,
      });
    else return;
    await accept(result);
    notice.value = "题目已保存。";
  }, true);
}
async function copy() {
  const d = selected.value;
  if (
    !d ||
    busy.value ||
    !window.confirm("另存为独立的新题目？原版本将永久冻结，新题目统计独立。")
  )
    return;
  await run(async () => {
    const result = await copyLibraryQuestion(
      d.question.libraryQuestionId,
      d.version.questionVersionId,
      d.version.contentRevision,
    );
    collection.value = "mine";
    await accept(result);
    notice.value = "已另存为新的题目身份。";
  });
}
async function restore() {
  const d = selected.value;
  if (
    !d ||
    busy.value ||
    !window.confirm(
      `将此历史版本恢复为最新版本？现有问卷保持原样，历史记录继续保留。`,
    )
  )
    return;
  await run(async () => {
    const latest = await getLibraryVersion(d.question.libraryQuestionId);
    await accept(
      await restoreLibraryVersion(d.question.libraryQuestionId, {
        restoredFromVersionId: d.version.questionVersionId,
        sourceContentRevision: d.version.contentRevision,
        baseVersionId: latest.version.questionVersionId,
        baseContentRevision: latest.version.contentRevision,
      }),
    );
    notice.value = "已恢复为最新版本。";
  });
}
onMounted(() => run(() => loadList()));
</script>
<template>
  <div class="library-workspace" :aria-busy="busy">
    <p class="muted">
      保存常用题目，管理版本与修改来源。在问卷草稿的题目区点击“从常用题目选入”即可复用；可在下方管理共享给你的题目。
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <button class="primary" type="button" :disabled="busy" @click="newQuestion">
      创建独立题目
    </button>
    <div class="library-layout">
      <aside aria-label="我的题目">
        <div class="library-actions">
          <button
            class="secondary"
            :class="{ 'library-version-selected': collection === 'mine' }"
            :disabled="busy"
            @click="switchCollection('mine')"
          >
            我的题目</button
          ><button
            class="secondary"
            :class="{ 'library-version-selected': collection === 'shared' }"
            :disabled="busy"
            @click="switchCollection('shared')"
          >
            共享给我
          </button>
        </div>
        <button
          v-for="item in items"
          :key="item.question.libraryQuestionId"
          class="survey-row"
          type="button"
          :disabled="busy"
          @click="open(item.question.libraryQuestionId)"
        >
          <span
            ><strong>{{ item.version.definition.title }}</strong
            ><small
              >{{ labels[item.question.type] }} · v{{
                item.version.versionNumber
              }}
              · 当前版本</small
            ></span
          >
        </button>
        <p v-if="!items.length && !busy" class="muted">暂无可显示的题目。</p>
        <button
          v-if="cursor"
          class="secondary"
          :disabled="busy"
          @click="run(() => loadList(true))"
        >
          更多题目
        </button>
      </aside>
      <section aria-label="题目与版本">
        <template v-if="selected">
          <h3>{{ selected.version.definition.title }}</h3>
          <p>
            {{ isCurrent ? "当前版本" : "正在查看历史版本" }} v{{
              selected.version.versionNumber
            }}
            · {{ labels[selected.question.type] }}
          </p>
          <p v-if="!isCurrent" class="muted">
            历史版本仅供查看。需要重新采用它作为当前内容时，可恢复为最新版本。
          </p>
          <p v-else-if="selected.access === 'shared'" class="muted">
            共享题目只读，可以选入问卷或另存为自己的题目。
          </p>
          <p v-else-if="selected.version.frozenAt" class="muted">
            此版本已被使用，修改内容请创建新版本；使用和共享不受影响。
          </p>
          <p v-else class="muted">
            可以直接修改当前版本；使用或派生后将保留原内容。
          </p>
          <div class="library-actions" v-if="mode === 'view'">
            <button
              v-if="isCurrent && selected.access === 'owner'"
              class="secondary"
              :disabled="busy || !selected.modificationStatus.canEditInPlace"
              @click="startEdit('edit')"
            >
              原地修改
            </button>
            <button
              v-if="isCurrent && selected.access === 'owner'"
              class="primary"
              :disabled="busy"
              @click="startEdit('branch')"
            >
              创建新版本
            </button>
            <button
              v-if="isCurrent"
              class="secondary"
              :disabled="busy"
              @click="copy"
            >
              另存为新题目
            </button>
            <button
              v-if="!isCurrent && selected.access === 'owner'"
              class="primary"
              :disabled="busy"
              @click="restore"
            >
              恢复为最新版本
            </button>
            <button
              v-if="!isCurrent"
              class="secondary"
              :disabled="busy"
              @click="open(selected.question.libraryQuestionId)"
            >
              返回当前版本
            </button>
          </div>
          <details v-if="mode === 'view'" open>
            <summary>{{ isCurrent ? "当前版本内容" : "历史版本内容" }}</summary>
            <p>
              {{ selected.version.definition.required ? "必答" : "非必答" }}
            </p>
            <ul>
              <li
                v-for="o in selected.version.definition.options"
                :key="o.optionId"
              >
                {{ o.text }}
              </li>
            </ul>
            <p class="library-rule">
              校验：{{
                describeLibraryValidation(
                  selected.version.definition.type,
                  selected.version.definition.validation,
                )
              }}
            </p>
          </details>
          <button
            v-if="mode === 'view'"
            type="button"
            class="secondary"
            :aria-expanded="showHistory"
            :disabled="busy"
            @click="toggleHistory"
          >
            {{ showHistory ? "收起历史版本" : "历史版本" }}
          </button>
          <section
            v-if="showHistory && mode === 'view'"
            aria-label="历史版本"
            class="library-history"
          >
            <label
              >查看历史版本<select
                :value="historyChoice"
                :disabled="busy"
                @change="chooseHistory"
              >
                <option value="">请选择历史版本</option>
                <option
                  v-for="v in history.filter(
                    (v) =>
                      v.questionVersionId !==
                      selected?.question.latestVersionId,
                  )"
                  :key="v.questionVersionId"
                  :value="v.questionVersionId"
                >
                  v{{ v.versionNumber }} · {{ v.definition.title }}
                </option>
              </select></label
            >
            <p
              v-if="
                !historyCursor &&
                history.every(
                  (v) =>
                    v.questionVersionId === selected?.question.latestVersionId,
                )
              "
              class="muted"
            >
              暂无历史版本。
            </p>
            <button
              v-if="historyCursor"
              type="button"
              class="secondary compact"
              :disabled="busy"
              @click="run(() => loadHistory(true))"
            >
              更多历史版本
            </button>
            <details>
              <summary>修改来源</summary>
              <p v-if="selected.version.parentVersionId" class="muted">
                从 v{{
                  history.find(
                    (v) =>
                      v.questionVersionId === selected?.version.parentVersionId,
                  )?.versionNumber ?? "较早"
                }}
                产生。
              </p>
              <p
                v-if="
                  selected.version.parentUnavailable ||
                  selected.version.restoredFromUnavailable
                "
                class="muted"
              >
                部分来源版本未获授权。
              </p>
              <button
                v-if="selected.version.restoredFromVersionId"
                type="button"
                class="secondary compact"
                :disabled="busy"
                @click="
                  open(
                    selected.question.libraryQuestionId,
                    selected.version.restoredFromVersionId,
                  )
                "
              >
                查看恢复来源</button
              ><button
                v-if="selected.question.copiedFrom"
                type="button"
                class="secondary compact"
                :disabled="busy"
                @click="
                  open(
                    selected.question.copiedFrom.libraryQuestionId,
                    selected.question.copiedFrom.questionVersionId,
                  )
                "
              >
                查看另存来源
              </button>
            </details>
            <template v-if="showHistory && mode === 'view'"
              ><label
                >选择版本比较<select v-model="compareVersionId">
                  <option value="">不比较</option>
                  <option
                    v-for="v in history.filter(
                      (v) =>
                        v.questionVersionId !==
                        selected?.version.questionVersionId,
                    )"
                    :key="v.questionVersionId"
                    :value="v.questionVersionId"
                  >
                    v{{ v.versionNumber }}
                  </option>
                </select></label
              ><LibraryVersionDiff
                v-if="compared"
                :baseline="compared.definition"
                :candidate="selected.version.definition"
            /></template>
          </section>
          <LibraryStatisticsPanel
            :key="selected.question.libraryQuestionId"
            :library-question-id="selected.question.libraryQuestionId"
            :disabled="busy"
            @failure="emit('failure', $event)"
          />
          <LibraryAccessPanel
            v-if="isCurrent && mode === 'view'"
            :key="
              selected.question.libraryQuestionId +
              selected.version.questionVersionId
            "
            :library-question-id="selected.question.libraryQuestionId"
            :version="selected.version"
            :is-owner="selected.access === 'owner'"
            :disabled="busy"
            @failure="emit('failure', $event)"
            @locate="emit('locate', $event)"
          />
        </template>
        <form
          v-if="mode !== 'view'"
          class="settings-card"
          @submit.prevent="save"
        >
          <h3>
            {{
              mode === "new"
                ? "创建题目"
                : mode === "edit"
                  ? "原地修改当前版本"
                  : "基于所选版本创建新版本"
            }}
          </h3>
          <fieldset :disabled="busy" class="library-fields">
            <label
              >题型<select
                v-model="form.type"
                :disabled="mode !== 'new'"
                @change="defaults"
              >
                <option
                  v-for="(label, type) in labels"
                  :key="type"
                  :value="type"
                >
                  {{ label }}
                </option>
              </select></label
            >
            <label
              >标题<input
                v-model="form.title"
                required
                maxlength="600"
                :aria-invalid="!!fieldErrors.title"
                :aria-describedby="
                  fieldErrors.title ? errorId('title') : undefined
                "
                @input="clearFieldError('title')"
              /><span
                v-if="fieldErrors.title"
                :id="errorId('title')"
                class="field-error"
                role="alert"
                >{{ fieldErrors.title }}</span
              ></label
            >
            <label class="check-row"
              ><input type="checkbox" v-model="form.required" />必须回答</label
            >
            <template v-if="form.type === 'single' || form.type === 'multiple'">
              <p class="muted">
                只修正文字可保留选项身份；含义改变时删除原选项并添加新选项。
              </p>
              <div
                v-for="(o, i) in form.options"
                :key="o.optionId ?? `new-${i}`"
                class="library-option"
              >
                <label
                  >选项 {{ i + 1
                  }}<input v-model="o.text" required maxlength="400" /></label
                ><button
                  type="button"
                  class="secondary"
                  :disabled="form.options.length <= 2"
                  @click="form.options.splice(i, 1)"
                >
                  删除
                </button>
              </div>
              <button
                type="button"
                class="secondary"
                :disabled="form.options.length >= 50"
                @click="form.options.push({ text: '' })"
              >
                添加新选项
              </button>
            </template>
            <template v-if="form.type === 'multiple'"
              ><label
                >最少选择<input
                  type="number"
                  v-model.number="form.validation.minSelections"
                  min="1"
                  :max="form.options.length"
                  required
                  :aria-invalid="!!fieldErrors['validation.minSelections']"
                  :aria-describedby="
                    fieldErrors['validation.minSelections']
                      ? errorId('validation.minSelections')
                      : undefined
                  "
                  @input="clearFieldError('validation.minSelections')"
                /><span
                  v-if="fieldErrors['validation.minSelections']"
                  :id="errorId('validation.minSelections')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.minSelections"] }}</span
                ></label
              ><label
                >最多选择<input
                  type="number"
                  v-model.number="form.validation.maxSelections"
                  min="1"
                  :max="form.options.length"
                  required
                  :aria-invalid="!!fieldErrors['validation.maxSelections']"
                  :aria-describedby="
                    fieldErrors['validation.maxSelections']
                      ? errorId('validation.maxSelections')
                      : undefined
                  "
                  @input="clearFieldError('validation.maxSelections')"
                /><span
                  v-if="fieldErrors['validation.maxSelections']"
                  :id="errorId('validation.maxSelections')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.maxSelections"] }}</span
                ></label
              ></template
            >
            <template v-if="form.type === 'text'"
              ><label
                >最少字数<input
                  type="number"
                  v-model.number="form.validation.minLength"
                  min="0"
                  max="2000"
                  required
                  :aria-invalid="!!fieldErrors['validation.minLength']"
                  :aria-describedby="
                    fieldErrors['validation.minLength']
                      ? errorId('validation.minLength')
                      : undefined
                  "
                  @input="clearFieldError('validation.minLength')"
                /><span
                  v-if="fieldErrors['validation.minLength']"
                  :id="errorId('validation.minLength')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.minLength"] }}</span
                ></label
              ><label
                >最多字数<input
                  type="number"
                  v-model.number="form.validation.maxLength"
                  min="0"
                  max="2000"
                  required
                  :aria-invalid="!!fieldErrors['validation.maxLength']"
                  :aria-describedby="
                    fieldErrors['validation.maxLength']
                      ? errorId('validation.maxLength')
                      : undefined
                  "
                  @input="clearFieldError('validation.maxLength')"
                /><span
                  v-if="fieldErrors['validation.maxLength']"
                  :id="errorId('validation.maxLength')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.maxLength"] }}</span
                ></label
              ><label class="check-row"
                ><input
                  type="checkbox"
                  v-model="form.validation.digitsOnly"
                />仅 ASCII 数字</label
              ></template
            >
            <template v-if="form.type === 'number'"
              ><label
                >最小值 可留空<input
                  type="number"
                  step="any"
                  v-model.number="form.validation.minValue"
                  :aria-invalid="!!fieldErrors['validation.minValue']"
                  :aria-describedby="
                    fieldErrors['validation.minValue']
                      ? errorId('validation.minValue')
                      : undefined
                  "
                  @input="clearFieldError('validation.minValue')"
                /><span
                  v-if="fieldErrors['validation.minValue']"
                  :id="errorId('validation.minValue')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.minValue"] }}</span
                ></label
              ><label
                >最大值 可留空<input
                  type="number"
                  step="any"
                  v-model.number="form.validation.maxValue"
                  :aria-invalid="!!fieldErrors['validation.maxValue']"
                  :aria-describedby="
                    fieldErrors['validation.maxValue']
                      ? errorId('validation.maxValue')
                      : undefined
                  "
                  @input="clearFieldError('validation.maxValue')"
                /><span
                  v-if="fieldErrors['validation.maxValue']"
                  :id="errorId('validation.maxValue')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.maxValue"] }}</span
                ></label
              ><label class="check-row"
                ><input
                  type="checkbox"
                  v-model="form.validation.integerOnly"
                  :aria-invalid="!!fieldErrors['validation.integerOnly']"
                  :aria-describedby="
                    fieldErrors['validation.integerOnly']
                      ? errorId('validation.integerOnly')
                      : undefined
                  "
                  @change="clearFieldError('validation.integerOnly')"
                />仅整数<span
                  v-if="fieldErrors['validation.integerOnly']"
                  :id="errorId('validation.integerOnly')"
                  class="field-error"
                  role="alert"
                  >{{ fieldErrors["validation.integerOnly"] }}</span
                ></label
              ></template
            >
          </fieldset>
          <LibraryVersionDiff
            v-if="selected"
            :baseline="selected.version.definition"
            :candidate="form"
          />
          <div class="library-actions">
            <button class="primary" :disabled="busy">保存</button
            ><button
              type="button"
              class="secondary"
              :disabled="busy"
              @click="cancel"
            >
              取消
            </button>
          </div>
        </form>
        <p v-else-if="!selected" class="muted">
          选择题目查看内容、历史和使用情况，或创建一道常用题。
        </p>
      </section>
    </div>
  </div>
</template>
<style scoped>
.field-error {
  display: block;
  color: #b42318;
  font-size: 0.9rem;
  margin-top: 0.35rem;
}
.library-fields input[aria-invalid="true"] {
  border-color: #b42318;
  outline: 1px solid #b42318;
}
.library-fields .check-row:has(.field-error) {
  flex-wrap: wrap;
}
.library-fields .check-row .field-error {
  flex-basis: 100%;
}
.library-layout {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(0, 2fr);
  gap: 1.5rem;
  margin-top: 1.5rem;
}
.library-layout aside {
  display: grid;
  align-content: start;
  gap: 0.6rem;
}
.library-layout section,
.library-layout aside {
  min-width: 0;
}
.library-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}
.library-version-selected {
  color: white;
  background: #245b8f;
}
.library-history {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}
.library-fields {
  display: grid;
  gap: 1rem;
  border: 0;
  padding: 0;
  min-width: 0;
}
.library-option {
  display: flex;
  gap: 0.5rem;
  align-items: end;
}
.library-option label {
  flex: 1;
}
.library-rule {
  overflow-wrap: anywhere;
}
.library-layout p {
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .library-layout {
    grid-template-columns: 1fr;
  }
}
</style>
