<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ApiClientError } from "./auth";
import {
  addQuestion,
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
}>();
const emit = defineEmits<{
  updated: [version: SurveyVersion];
  busy: [value: boolean];
  dirty: [value: boolean];
  failure: [error: unknown];
}>();

interface Card extends EditableQuestion {
  key: string;
  questionId?: string;
  type: QuestionType;
  original: string;
}

const cards = ref<Card[]>([]);
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
watch(hasDirty, (value) => emit("dirty", value), { immediate: true });

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
      <div class="question-add">
        <select v-model="newType" :disabled="busy">
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
    </div>

    <p v-if="!cards.length" class="empty-state">尚未添加题目。</p>
    <article
      v-for="(card, cardIndex) in cards"
      :key="card.key"
      class="question-card"
    >
      <header class="question-card-header">
        <strong>第 {{ cardIndex + 1 }} 题 · {{ typeLabel(card.type) }}</strong>
        <span v-if="isDirtyCard(card)" class="unsaved">未保存</span>
      </header>
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
  </section>
</template>
