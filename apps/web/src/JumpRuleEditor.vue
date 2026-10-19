<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ApiClientError } from "./auth";
import {
  updateJumpRules,
  validateDraftForPublish,
  type CheckIssue,
  type EditableJumpRule,
  type JumpOperator,
  type PublishCheck,
  type SurveyQuestion,
  type SurveyVersion,
} from "./surveys";

const props = defineProps<{
  surveyId: string;
  version: SurveyVersion;
  busy: boolean;
  questionsDirty: boolean;
  settingsDirty: boolean;
}>();
const emit = defineEmits<{
  updated: [version: SurveyVersion];
  busy: [value: boolean];
  dirty: [value: boolean];
  failure: [error: unknown];
}>();

const drafts = reactive<Record<string, EditableJumpRule[]>>({});
const originals = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const check = ref<PublishCheck>();
const checking = ref(false);

const cloneRules = (question: SurveyQuestion): EditableJumpRule[] =>
  question.jumpRules.map((rule) => ({
    ...rule,
    value: Array.isArray(rule.value) ? [...rule.value] : rule.value,
  }));
const signature = (rules: EditableJumpRule[]): string => JSON.stringify(rules);
const isDirty = (questionId: string): boolean =>
  signature(drafts[questionId] ?? []) !== originals[questionId];
const hasDirty = computed(() =>
  props.version.questions.some((question) => isDirty(question.questionId)),
);
watch(hasDirty, (value) => emit("dirty", value), { immediate: true });

watch(
  () => props.version,
  (version, previous) => {
    for (const question of version.questions) {
      if (!(question.questionId in drafts) || !isDirty(question.questionId)) {
        const rules = cloneRules(question);
        drafts[question.questionId] = rules;
        originals[question.questionId] = signature(rules);
      }
    }
    for (const id of Object.keys(drafts)) {
      if (!version.questions.some((question) => question.questionId === id)) {
        delete drafts[id];
        delete originals[id];
        delete errors[id];
      }
    }
    if (previous && previous.revision !== version.revision)
      check.value = undefined;
  },
  { immediate: true },
);

const eligible = (question: SurveyQuestion): boolean =>
  question.type !== "text";
const indexOf = (question: SurveyQuestion): number =>
  props.version.questions.findIndex(
    (candidate) => candidate.questionId === question.questionId,
  );
const laterTargets = (question: SurveyQuestion): SurveyQuestion[] =>
  props.version.questions.slice(indexOf(question) + 1);
const targetLabel = (id: string): string => {
  const index = props.version.questions.findIndex(
    (question) => question.questionId === id,
  );
  return index < 0
    ? "题目已不存在"
    : `第 ${index + 1} 题：${props.version.questions[index]!.title}`;
};
const isBackward = (question: SurveyQuestion, targetId: string): boolean => {
  const target = props.version.questions.findIndex(
    (candidate) => candidate.questionId === targetId,
  );
  return target >= 0 && target <= indexOf(question);
};
const operators = (question: SurveyQuestion): Array<[JumpOperator, string]> => {
  if (question.type === "single") return [["equals", "等于"]];
  if (question.type === "multiple")
    return [
      ["contains", "包含选项"],
      ["containsAll", "同时包含"],
      ["containsAny", "包含任一"],
    ];
  return [
    ["equals", "等于"],
    ["gt", "大于"],
    ["gte", "大于等于"],
    ["lt", "小于"],
    ["lte", "小于等于"],
  ];
};
function defaultRule(question: SurveyQuestion): EditableJumpRule | undefined {
  const target = laterTargets(question)[0];
  if (!target) return undefined;
  return {
    operator:
      question.type === "multiple"
        ? "contains"
        : question.type === "number"
          ? "equals"
          : "equals",
    value:
      question.type === "number" ? 0 : (question.options[0]?.optionId ?? ""),
    targetQuestionId: target.questionId,
  };
}
function addRule(question: SurveyQuestion): void {
  const rule = defaultRule(question);
  if (rule) drafts[question.questionId]!.push(rule);
}
function removeRule(questionId: string, index: number): void {
  drafts[questionId]!.splice(index, 1);
}
function moveRule(questionId: string, index: number, offset: -1 | 1): void {
  const rules = drafts[questionId]!;
  const target = index + offset;
  if (target < 0 || target >= rules.length) return;
  [rules[index], rules[target]] = [rules[target]!, rules[index]!];
}
function changeOperator(
  question: SurveyQuestion,
  rule: EditableJumpRule,
): void {
  rule.value =
    question.type === "number"
      ? 0
      : rule.operator === "containsAll" || rule.operator === "containsAny"
        ? question.options[0]
          ? [question.options[0].optionId]
          : []
        : (question.options[0]?.optionId ?? "");
}
function selectedValues(rule: EditableJumpRule): string[] {
  return Array.isArray(rule.value) ? rule.value : [];
}
function setSelectedValues(rule: EditableJumpRule, event: Event): void {
  const select = event.target as HTMLSelectElement;
  rule.value = Array.from(select.selectedOptions, (option) => option.value);
}
async function save(question: SurveyQuestion): Promise<void> {
  errors[question.questionId] = "";
  emit("busy", true);
  try {
    const result = await updateJumpRules(
      props.surveyId,
      props.version.id,
      question.questionId,
      props.version.revision,
      drafts[question.questionId]!,
    );
    const saved = result.version.questions.find(
      (item) => item.questionId === question.questionId,
    )!;
    const rules = cloneRules(saved);
    drafts[question.questionId] = rules;
    originals[question.questionId] = signature(rules);
    check.value = undefined;
    emit("updated", result.version);
  } catch (error) {
    errors[question.questionId] =
      error instanceof Error ? error.message : "规则保存失败";
    emit("failure", error);
  } finally {
    emit("busy", false);
  }
}
async function runCheck(): Promise<void> {
  checking.value = true;
  try {
    check.value = await validateDraftForPublish(
      props.surveyId,
      props.version.id,
      props.version.revision,
    );
  } catch (error) {
    emit("failure", error);
  } finally {
    checking.value = false;
  }
}
function issueLocation(item: CheckIssue): string {
  if (!item.questionId) return "问卷设置";
  const index = props.version.questions.findIndex(
    (question) => question.questionId === item.questionId,
  );
  return index >= 0 ? `第 ${index + 1} 题` : item.questionId;
}
function focusIssue(item: CheckIssue): void {
  const id = item.ruleId
    ? `jump-rule-${item.ruleId}`
    : item.questionId
      ? `jump-question-${item.questionId}`
      : "survey-settings";
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}
</script>

<template>
  <section class="rule-section">
    <div class="question-heading">
      <div>
        <h3>跳转规则</h3>
        <p class="muted">
          规则按顺序匹配，第一条命中后立即跳转；未命中则进入下一题。
        </p>
      </div>
    </div>
    <p v-if="questionsDirty" class="notice">
      请先保存题目内容，再编辑跳转规则。
    </p>
    <article
      v-for="(question, questionIndex) in version.questions"
      :key="question.questionId"
      :id="`jump-question-${question.questionId}`"
      class="rule-card"
    >
      <header class="question-card-header">
        <strong>第 {{ questionIndex + 1 }} 题 · {{ question.title }}</strong>
        <span v-if="isDirty(question.questionId)" class="unsaved"
          >规则未保存</span
        >
      </header>
      <p v-if="question.type === 'text'" class="muted">
        文本题不设置跳转条件。
      </p>
      <p
        v-else-if="
          !laterTargets(question).length && !drafts[question.questionId]?.length
        "
        class="muted"
      >
        已是最后一题，没有可跳转的后续题。
      </p>
      <div
        v-for="(rule, ruleIndex) in drafts[question.questionId]"
        :key="rule.ruleId ?? `new-${ruleIndex}`"
        :id="rule.ruleId ? `jump-rule-${rule.ruleId}` : undefined"
        class="rule-row"
      >
        <span class="rule-number">规则 {{ ruleIndex + 1 }}</span>
        <select
          v-model="rule.operator"
          :disabled="busy || questionsDirty"
          @change="changeOperator(question, rule)"
        >
          <option
            v-for="[value, label] in operators(question)"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select>
        <input
          v-if="question.type === 'number'"
          v-model.number="rule.value"
          type="number"
          :disabled="busy || questionsDirty"
          aria-label="比较数值"
        />
        <select
          v-else-if="
            rule.operator === 'containsAll' || rule.operator === 'containsAny'
          "
          multiple
          :value="selectedValues(rule)"
          :disabled="busy || questionsDirty"
          aria-label="条件选项"
          @change="setSelectedValues(rule, $event)"
        >
          <option
            v-for="choice in question.options"
            :key="choice.optionId"
            :value="choice.optionId"
          >
            {{ choice.text }}
          </option>
        </select>
        <select
          v-else
          v-model="rule.value"
          :disabled="busy || questionsDirty"
          aria-label="条件选项"
        >
          <option
            v-for="choice in question.options"
            :key="choice.optionId"
            :value="choice.optionId"
          >
            {{ choice.text }}
          </option>
        </select>
        <span>跳到</span>
        <select
          v-model="rule.targetQuestionId"
          :disabled="busy || questionsDirty"
        >
          <option
            v-if="isBackward(question, rule.targetQuestionId)"
            :value="rule.targetQuestionId"
          >
            {{ targetLabel(rule.targetQuestionId) }}（回跳）
          </option>
          <option
            v-for="target in laterTargets(question)"
            :key="target.questionId"
            :value="target.questionId"
          >
            {{ targetLabel(target.questionId) }}
          </option>
        </select>
        <span
          v-if="isBackward(question, rule.targetQuestionId)"
          class="field-error"
          >该规则会回跳，发布检查将判定是否形成循环。</span
        >
        <span class="rule-actions">
          <button
            class="secondary compact"
            type="button"
            :disabled="busy || questionsDirty || ruleIndex === 0"
            @click="moveRule(question.questionId, ruleIndex, -1)"
          >
            上移
          </button>
          <button
            class="secondary compact"
            type="button"
            :disabled="
              busy ||
              questionsDirty ||
              ruleIndex === drafts[question.questionId]!.length - 1
            "
            @click="moveRule(question.questionId, ruleIndex, 1)"
          >
            下移
          </button>
          <button
            class="secondary compact"
            type="button"
            :disabled="busy || questionsDirty"
            @click="removeRule(question.questionId, ruleIndex)"
          >
            删除
          </button>
        </span>
      </div>
      <p v-if="errors[question.questionId]" class="field-error">
        {{ errors[question.questionId] }}
      </p>
      <div v-if="eligible(question)" class="save-row">
        <button
          class="secondary compact"
          type="button"
          :disabled="busy || questionsDirty || !laterTargets(question).length"
          @click="addRule(question)"
        >
          添加规则
        </button>
        <button
          class="primary compact"
          type="button"
          :disabled="busy || questionsDirty || !isDirty(question.questionId)"
          @click="save(question)"
        >
          保存本题规则
        </button>
      </div>
    </article>
    <div class="publish-check-card">
      <div class="question-heading">
        <div>
          <h3>发布前检查</h3>
          <p class="muted">
            保存全部设置、题目和规则后，再检查当前草稿能否发布。
          </p>
        </div>
        <button
          class="secondary"
          type="button"
          :disabled="
            busy || checking || questionsDirty || settingsDirty || hasDirty
          "
          @click="runCheck"
        >
          {{ checking ? "检查中…" : "检查能否发布" }}
        </button>
      </div>
      <p v-if="questionsDirty || hasDirty" class="notice">
        请先保存全部题目和跳转规则，再执行发布检查。
      </p>
      <p v-else-if="settingsDirty" class="notice">
        请先保存基础设置，再执行发布检查。
      </p>
      <div
        v-if="check && !questionsDirty && !settingsDirty && !hasDirty"
        class="check-results"
        aria-live="polite"
      >
        <strong>{{ check.valid ? "发布检查通过" : "发布检查未通过" }}</strong>
        <p class="muted">
          检查基于 revision {{ check.revision }}；任何保存操作后需要重新检查。
        </p>
        <ul v-if="check.errors.length">
          <li
            v-for="item in check.errors"
            :key="`e-${item.path}-${item.ruleId ?? ''}`"
            class="field-error"
          >
            <button class="issue-link" type="button" @click="focusIssue(item)">
              {{ issueLocation(item) }}：{{ item.message }}（{{ item.code }}）
            </button>
          </li>
        </ul>
        <ul v-if="check.warnings.length">
          <li
            v-for="item in check.warnings"
            :key="`w-${item.path}-${item.ruleId ?? ''}`"
            class="warning"
          >
            <button class="issue-link" type="button" @click="focusIssue(item)">
              {{ issueLocation(item) }}：{{ item.message }}（{{ item.code }}）
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
