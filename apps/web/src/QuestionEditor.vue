<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ApiClientError } from "./auth";
import LibraryStatisticsPanel from "./LibraryStatisticsPanel.vue";
import LibraryQuestionPicker from "./LibraryQuestionPicker.vue";
import type { LibraryDefinition, LibraryVersionView } from "./library";
import {
  addQuestion,
  addLibraryQuestion,
  changeLibraryQuestion,
  detachLibraryQuestion,
  saveQuestionToLibrary,
  deleteQuestion,
  reorderQuestions,
  replaceQuestion,
  type EditableQuestion,
  type QuestionType,
  type SurveyQuestion,
  type SurveyVersion,
} from "./surveys";

const props = defineProps<{
  surveyId: string;
  version: SurveyVersion;
  busy: boolean;
  otherUnsaved?: boolean;
}>();
const emit = defineEmits<{
  updated: [version: SurveyVersion];
  busy: [value: boolean];
  dirty: [value: boolean];
  failure: [error: unknown];
  navigation: [items: Array<{ id: string; label: string }>];
}>();

interface Card extends EditableQuestion {
  key: string;
  questionId?: string;
  type: QuestionType;
  source?: SurveyQuestion["source"];
  original: string;
}

const cards = ref<Card[]>([]);
const pickerFor = ref<string>();
const libraryNotice = ref("");
const newType = ref<QuestionType>("single");
const errors = reactive<Record<string, Record<string, string>>>({});
let localSequence = 0;
let serverSignature = "";

const editable = (question: SurveyQuestion): EditableQuestion => ({
  title: question.title,
  required: question.required,
  validation: { ...question.validation },
  options: question.options.map((option) => ({ ...option })),
});
const signature = (question: EditableQuestion): string =>
  JSON.stringify(question);
const toCard = (question: SurveyQuestion): Card => {
  const value = editable(question);
  return {
    ...value,
    key: question.questionId,
    questionId: question.questionId,
    type: question.type,
    source: question.source,
    original: signature(value),
  };
};
function syncQuestions(
  questions: SurveyQuestion[],
  preserveDirty = false,
  excludeKey?: string,
): void {
  const preserved = preserveDirty
    ? cards.value.filter((card) => card.key !== excludeKey && isDirtyCard(card))
    : [];
  serverSignature = JSON.stringify(questions);
  const next = questions.map(toCard);
  preserved.forEach((card) => {
    const index = card.questionId
      ? next.findIndex((item) => item.questionId === card.questionId)
      : -1;
    if (index >= 0) next[index] = card;
    else next.push(card);
  });
  cards.value = next;
  Object.keys(errors).forEach((key) => {
    if (!preserved.some((card) => card.key === key)) delete errors[key];
  });
}
watch(
  () => props.version.questions,
  (questions) => {
    const next = JSON.stringify(questions);
    if (next !== serverSignature) syncQuestions(questions);
  },
  { immediate: true },
);

const isDirtyCard = (card: Card): boolean =>
  !card.questionId ||
  signature({
    title: card.title,
    required: card.required,
    validation: card.validation,
    options: card.options,
  }) !== card.original;
const hasDirty = computed(() => cards.value.some(isDirtyCard));
const libraryActionsBlocked = computed(
  () => hasDirty.value || props.otherUnsaved === true,
);
watch(hasDirty, (value) => emit("dirty", value), { immediate: true });
watch(
  cards,
  (items) =>
    emit(
      "navigation",
      items.map((card, index) => ({
        id: card.questionId
          ? `question-${card.questionId}`
          : `question-${card.key}`,
        label: `第 ${index + 1} 题`,
      })),
    ),
  { deep: true, immediate: true },
);

function defaultCard(type: QuestionType): Card {
  const options =
    type === "single" || type === "multiple"
      ? [{ text: "" }, { text: "" }]
      : [];
  const validation: Record<string, unknown> =
    type === "multiple"
      ? { minSelections: 1, maxSelections: 2 }
      : type === "text"
        ? { minLength: 0, maxLength: 2_000, digitsOnly: false }
        : type === "number"
          ? { integerOnly: false, minValue: null, maxValue: null }
          : {};
  return {
    key: `local_${(localSequence += 1)}`,
    type,
    title: "",
    required: false,
    validation,
    options,
    original: "",
  };
}
function addLocal(): void {
  cards.value.push(defaultCard(newType.value));
}
function addOption(card: Card): void {
  card.options.push({ text: "" });
  if (
    card.type === "multiple" &&
    Number(card.validation.maxSelections) < card.options.length
  )
    card.validation.maxSelections = card.options.length;
}
function removeOption(card: Card, index: number): void {
  card.options.splice(index, 1);
}
function fieldError(card: Card, path: string): string | undefined {
  return errors[card.key]?.[path];
}
function clearError(card: Card, path: string): void {
  if (errors[card.key]) delete errors[card.key]![path];
}
function setError(card: Card, error: unknown): void {
  const reportedPath =
    error instanceof ApiClientError && typeof error.details?.path === "string"
      ? error.details.path
      : "form";
  const path =
    reportedPath === "title" ||
    reportedPath === "options" ||
    reportedPath.startsWith("options[") ||
    reportedPath.startsWith("validation.")
      ? reportedPath
      : "form";
  errors[card.key] = {
    ...(errors[card.key] ?? {}),
    [path]: error instanceof Error ? error.message : "保存失败",
  };
  emit("failure", error);
}
async function withBusy(task: () => Promise<void>): Promise<void> {
  emit("busy", true);
  try {
    await task();
  } finally {
    emit("busy", false);
  }
}
async function save(card: Card): Promise<void> {
  errors[card.key] = {};
  await withBusy(async () => {
    try {
      const validation = { ...card.validation };
      if (card.type === "number") {
        if (validation.minValue === "") validation.minValue = null;
        if (validation.maxValue === "") validation.maxValue = null;
      }
      const body: EditableQuestion = {
        title: card.title,
        required: card.required,
        validation,
        options: card.options.map((option) => ({ ...option })),
      };
      const result = card.questionId
        ? await replaceQuestion(
            props.surveyId,
            props.version.id,
            card.questionId,
            props.version.revision,
            body,
          )
        : await addQuestion(
            props.surveyId,
            props.version.id,
            props.version.revision,
            card.type,
            body,
          );
      syncQuestions(result.version.questions, true, card.key);
      emit("updated", result.version);
    } catch (error) {
      setError(card, error);
    }
  });
}
async function remove(card: Card): Promise<void> {
  if (!card.questionId) {
    cards.value = cards.value.filter((item) => item.key !== card.key);
    return;
  }
  if (!window.confirm("确定删除这道题吗？")) return;
  await withBusy(async () => {
    try {
      const result = await deleteQuestion(
        props.surveyId,
        props.version.id,
        card.questionId!,
        props.version.revision,
      );
      syncQuestions(result.version.questions, true, card.key);
      emit("updated", result.version);
    } catch (error) {
      setError(card, error);
    }
  });
}
async function move(card: Card, offset: -1 | 1): Promise<void> {
  if (!card.questionId || hasDirty.value) return;
  const current = cards.value.findIndex((item) => item.key === card.key);
  const target = current + offset;
  if (target < 0 || target >= cards.value.length) return;
  const ids = cards.value.map((item) => item.questionId!);
  [ids[current], ids[target]] = [ids[target]!, ids[current]!];
  await withBusy(async () => {
    try {
      const result = await reorderQuestions(
        props.surveyId,
        props.version.id,
        props.version.revision,
        ids,
      );
      syncQuestions(result.version.questions);
      emit("updated", result.version);
    } catch (error) {
      setError(card, error);
    }
  });
}
function sourceDefinition(card: Card): LibraryDefinition | undefined {
  const q = props.version.questions.find(
    (q) => q.questionId === card.questionId,
  );
  if (!q?.source) return undefined;
  const mapped = new Map(
    q.source.optionSources.map((o) => [o.optionId, o.sourceOptionId]),
  );
  return {
    type: q.type,
    title: q.title,
    required: q.required,
    validation: q.validation,
    options: q.options.map((o) => ({
      text: o.text,
      optionId: mapped.get(o.optionId)!,
    })),
  };
}
async function selectLibrary(version: LibraryVersionView): Promise<void> {
  if (libraryActionsBlocked.value || props.busy) return;
  const replacing = pickerFor.value !== "add" ? pickerFor.value : undefined;
  const selection = {
    libraryQuestionId: version.libraryQuestionId,
    questionVersionId: version.questionVersionId,
    contentRevision: version.contentRevision,
  };
  await withBusy(async () => {
    try {
      const result = replacing
        ? await changeLibraryQuestion(
            props.surveyId,
            props.version.id,
            replacing,
            props.version.revision,
            selection,
          )
        : await addLibraryQuestion(
            props.surveyId,
            props.version.id,
            props.version.revision,
            selection,
          );
      syncQuestions(result.version.questions);
      emit("updated", result.version);
      pickerFor.value = undefined;
      libraryNotice.value = replacing
        ? "已换用所选版本，请检查题目顺序并按需配置跳转。"
        : "已选入常用题目，来源版本已冻结。";
    } catch (error) {
      const card = cards.value.find((c) => c.questionId === replacing);
      if (card) setError(card, error);
      else {
        libraryNotice.value =
          error instanceof Error ? error.message : "选入失败";
        emit("failure", error);
      }
    }
  });
}
async function detach(card: Card): Promise<void> {
  if (
    !card.questionId ||
    libraryActionsBlocked.value ||
    props.busy ||
    !window.confirm(
      "转为本地题目后可自由修改，并退出该常用题的统计归属；现有题目 ID、选项和跳转均保留。确定继续吗？",
    )
  )
    return;
  await withBusy(async () => {
    try {
      const result = await detachLibraryQuestion(
        props.surveyId,
        props.version.id,
        card.questionId!,
        props.version.revision,
      );
      syncQuestions(result.version.questions);
      emit("updated", result.version);
      libraryNotice.value = "已转为本地题目，可以编辑内容。";
    } catch (error) {
      setError(card, error);
    }
  });
}
async function saveToLibrary(card: Card): Promise<void> {
  if (
    !card.questionId ||
    libraryActionsBlocked.value ||
    props.busy ||
    !window.confirm(
      "保存已保存的题目定义为新的常用题目，不复制跳转，也不自动关联当前问卷。确定继续吗？",
    )
  )
    return;
  await withBusy(async () => {
    try {
      const result = await saveQuestionToLibrary(
        props.surveyId,
        props.version.id,
        card.questionId!,
        props.version.revision,
      );
      syncQuestions(result.version.questions);
      emit("updated", result.version);
      libraryNotice.value =
        "已保存为新的常用题目 v1。当前问卷仍是本地题目；可从常用题目重新选入，或返回题目管理查看。";
    } catch (error) {
      setError(card, error);
    }
  });
}
const typeLabel = (type: QuestionType): string =>
  ({ single: "单选题", multiple: "多选题", text: "文本题", number: "数字题" })[
    type
  ];
</script>

<template>
  <section class="question-section">
    <div class="question-heading">
      <div>
        <h3>题目</h3>
        <p class="muted">每张卡片单独保存；保存期间所有写操作会暂时锁定。</p>
      </div>
    </div>

    <p v-if="libraryNotice" role="status">{{ libraryNotice }}</p>
    <button
      class="secondary"
      type="button"
      :disabled="busy || libraryActionsBlocked"
      @click="pickerFor = 'add'"
    >
      从常用题目选入
    </button>
    <p v-if="libraryActionsBlocked" class="muted">
      请先保存未保存的题目、设置或跳转规则，再进行常用题目操作。
    </p>
    <LibraryQuestionPicker
      v-if="pickerFor === 'add'"
      :busy="busy || libraryActionsBlocked"
      @select="selectLibrary"
      @cancel="pickerFor = undefined"
      @failure="emit('failure', $event)"
    />
    <p v-if="!cards.length" class="empty-state">尚未添加题目。</p>
    <article
      v-for="(card, cardIndex) in cards"
      :key="card.key"
      :id="
        card.questionId ? `question-${card.questionId}` : `question-${card.key}`
      "
      class="question-card"
    >
      <header class="question-card-header">
        <strong>第 {{ cardIndex + 1 }} 题 · {{ typeLabel(card.type) }}</strong>
        <span v-if="isDirtyCard(card)" class="unsaved">未保存</span>
      </header>
      <p v-if="card.source" class="muted">
        来自常用题目 v{{
          card.source.versionNumber
        }}，内容只读；本问卷的排序和跳转仍可单独配置。
      </p>
      <div class="source-actions">
        <template v-if="card.source"
          ><button
            class="secondary compact"
            type="button"
            :disabled="busy || libraryActionsBlocked"
            @click="pickerFor = card.questionId"
          >
            换用版本</button
          ><button
            class="secondary compact"
            type="button"
            :disabled="busy || libraryActionsBlocked"
            @click="detach(card)"
          >
            转为本地题目
          </button></template
        >
        <button
          v-else-if="card.questionId"
          class="secondary compact"
          type="button"
          :disabled="busy || libraryActionsBlocked"
          @click="saveToLibrary(card)"
        >
          保存为常用题目
        </button>
      </div>
      <LibraryStatisticsPanel
        v-if="card.source"
        :key="card.source.libraryQuestionId"
        :library-question-id="card.source.libraryQuestionId"
        :disabled="busy"
        @failure="emit('failure', $event)"
      />
      <LibraryQuestionPicker
        v-if="card.source && pickerFor === card.questionId"
        :busy="busy || libraryActionsBlocked"
        :library-question-id="card.source.libraryQuestionId"
        :current-version-id="card.source.questionVersionId"
        :baseline="sourceDefinition(card)"
        @select="selectLibrary"
        @cancel="pickerFor = undefined"
        @failure="emit('failure', $event)"
      />
      <fieldset class="question-definition" :disabled="busy || !!card.source">
        <label>
          题目标题
          <input
            v-model="card.title"
            maxlength="300"
            @input="clearError(card, 'title')"
          />
          <span v-if="fieldError(card, 'title')" class="field-error">{{
            fieldError(card, "title")
          }}</span>
        </label>
        <label class="check-row">
          <input v-model="card.required" type="checkbox" />必答
        </label>

        <div
          v-if="card.type === 'single' || card.type === 'multiple'"
          class="option-list"
        >
          <label
            v-for="(option, optionIndex) in card.options"
            :key="option.optionId ?? optionIndex"
          >
            选项 {{ optionIndex + 1 }}
            <span class="option-row">
              <input
                v-model="option.text"
                maxlength="200"
                @input="clearError(card, `options[${optionIndex}].text`)"
              />
              <button
                class="secondary compact"
                type="button"
                :disabled="busy || card.options.length <= 2"
                @click="removeOption(card, optionIndex)"
              >
                删除
              </button>
            </span>
            <span
              v-if="
                fieldError(card, `options[${optionIndex}].text`) ||
                fieldError(card, `options[${optionIndex}].optionId`)
              "
              class="field-error"
            >
              {{
                fieldError(card, `options[${optionIndex}].text`) ??
                fieldError(card, `options[${optionIndex}].optionId`)
              }}
            </span>
          </label>
          <button
            class="secondary compact"
            type="button"
            :disabled="busy || card.options.length >= 50"
            @click="addOption(card)"
          >
            添加选项
          </button>
        </div>

        <div v-if="card.type === 'multiple'" class="validation-row">
          <label
            >最少选择<input
              v-model.number="card.validation.minSelections"
              type="number"
              min="1"
          /></label>
          <label
            >最多选择<input
              v-model.number="card.validation.maxSelections"
              type="number"
              min="1"
          /></label>
        </div>
        <div v-else-if="card.type === 'text'" class="validation-row">
          <label
            >最短长度<input
              v-model.number="card.validation.minLength"
              type="number"
              min="0"
              max="2000"
          /></label>
          <label
            >最长长度<input
              v-model.number="card.validation.maxLength"
              type="number"
              min="0"
              max="2000"
          /></label>
          <label class="check-row"
            ><input v-model="card.validation.digitsOnly" type="checkbox" />仅
            ASCII 数字</label
          >
        </div>
        <div v-else-if="card.type === 'number'" class="validation-row">
          <label
            >最小值<input
              v-model.number="card.validation.minValue"
              type="number"
              placeholder="不限制"
          /></label>
          <label
            >最大值<input
              v-model.number="card.validation.maxValue"
              type="number"
              placeholder="不限制"
          /></label>
          <label class="check-row"
            ><input
              v-model="card.validation.integerOnly"
              type="checkbox"
            />仅整数</label
          >
        </div>

        <span
          v-for="path in [
            'validation.minSelections',
            'validation.maxSelections',
            'validation.minLength',
            'validation.maxLength',
            'validation.digitsOnly',
            'validation.minValue',
            'validation.maxValue',
            'validation.integerOnly',
          ]"
          v-show="fieldError(card, path)"
          :key="path"
          class="field-error"
          >{{ fieldError(card, path) }}</span
        >
        <span v-if="fieldError(card, 'options')" class="field-error">{{
          fieldError(card, "options")
        }}</span>
        <span v-if="fieldError(card, 'form')" class="field-error">{{
          fieldError(card, "form")
        }}</span>
      </fieldset>
      <footer class="question-actions">
        <div>
          <button
            class="secondary compact"
            type="button"
            :disabled="busy || hasDirty || cardIndex === 0"
            @click="move(card, -1)"
          >
            上移
          </button>
          <button
            class="secondary compact"
            type="button"
            :disabled="busy || hasDirty || cardIndex === cards.length - 1"
            @click="move(card, 1)"
          >
            下移
          </button>
        </div>
        <div>
          <button
            class="secondary compact danger"
            type="button"
            :disabled="busy"
            @click="remove(card)"
          >
            删除
          </button>
          <button
            v-if="!card.source"
            class="primary compact"
            type="button"
            :disabled="busy || !isDirtyCard(card)"
            @click="save(card)"
          >
            保存本题
          </button>
        </div>
      </footer>
    </article>
    <div class="question-add question-add-bottom">
      <select v-model="newType" :disabled="busy" aria-label="新题题型">
        <option value="single">单选题</option>
        <option value="multiple">多选题</option>
        <option value="text">文本题</option>
        <option value="number">数字题</option>
      </select>
      <button
        class="secondary"
        type="button"
        :disabled="busy"
        @click="addLocal"
      >
        添加题目
      </button>
    </div>
  </section>
</template>

<style scoped>
.question-definition {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  gap: 1rem;
}
.source-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.75rem 0;
}
</style>
