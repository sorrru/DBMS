<script setup lang="ts">
import type {
  JumpOperator,
  JumpRule,
  SurveyQuestion,
  SurveyVersion,
} from "./surveys";

const props = withDefaults(
  defineProps<{ version: SurveyVersion; preview?: boolean }>(),
  { preview: false },
);

const typeLabels: Record<SurveyQuestion["type"], string> = {
  single: "单选题",
  multiple: "多选题",
  text: "文本题",
  number: "数字题",
};
const operatorLabels: Record<JumpOperator, string> = {
  equals: "等于",
  contains: "包含选项",
  containsAll: "同时包含",
  containsAny: "包含任一",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
};

function questionNumber(questionId: string): string {
  const index = props.version.questions.findIndex(
    (question) => question.questionId === questionId,
  );
  return index < 0 ? "未知题目" : `第 ${index + 1} 题`;
}

function optionText(question: SurveyQuestion, optionId: string): string {
  return (
    question.options.find((option) => option.optionId === optionId)?.text ??
    "未知选项"
  );
}

function ruleValue(question: SurveyQuestion, rule: JumpRule): string {
  if (typeof rule.value === "number") return String(rule.value);
  if (Array.isArray(rule.value))
    return rule.value.map((value) => optionText(question, value)).join("、");
  return question.type === "single" || question.type === "multiple"
    ? optionText(question, rule.value)
    : rule.value;
}

function validationSummary(question: SurveyQuestion): string[] {
  if (question.type === "multiple") {
    const validation = question.validation as {
      minSelections: number;
      maxSelections: number;
    };
    return [
      `选择数量：${validation.minSelections}–${validation.maxSelections} 项`,
    ];
  }
  if (question.type === "text") {
    const validation = question.validation as {
      minLength: number;
      maxLength: number;
      digitsOnly: boolean;
    };
    return [
      `长度：${validation.minLength}–${validation.maxLength} 个字符`,
      ...(validation.digitsOnly ? ["仅允许 ASCII 数字 0–9"] : []),
    ];
  }
  if (question.type === "number") {
    const validation = question.validation as {
      integerOnly: boolean;
      minValue: number | null;
      maxValue: number | null;
    };
    return [
      validation.integerOnly ? "仅允许整数" : "允许小数",
      `范围：${validation.minValue ?? "不限"} 至 ${validation.maxValue ?? "不限"}`,
    ];
  }
  return [];
}
</script>

<template>
  <section
    :id="preview ? 'draft-preview' : 'published-version'"
    class="settings-card"
  >
    <div class="published-heading">
      <div>
        <h3>{{ version.title }}</h3>
        <p>{{ version.description || "无说明" }}</p>
      </div>
      <span class="readonly-badge">{{
        preview ? "发布预览" : "只读版本"
      }}</span>
    </div>
    <p class="muted">
      {{
        preview
          ? "这是当前草稿通过发布检查后的只读预览；返回编辑不会发布问卷。"
          : "此版本已发布，只读保留；若要修改，请创建下一版本草稿。"
      }}
    </p>
    <div v-if="version.questions.length" class="published-questions">
      <article
        v-for="(question, questionIndex) in version.questions"
        :id="`${preview ? 'preview' : 'published'}-question-${question.questionId}`"
        :key="question.questionId"
        class="published-question-card"
      >
        <header>
          <span
            >第 {{ questionIndex + 1 }} 题 ·
            {{ typeLabels[question.type] }}</span
          >
          <span>{{ question.required ? "必答" : "选答" }}</span>
        </header>
        <h4>{{ question.title }}</h4>
        <ol
          v-if="question.type === 'single' || question.type === 'multiple'"
          class="published-options"
        >
          <li v-for="option in question.options" :key="option.optionId">
            {{ option.text }}
          </li>
        </ol>
        <ul
          v-if="validationSummary(question).length"
          class="published-validation"
        >
          <li v-for="item in validationSummary(question)" :key="item">
            {{ item }}
          </li>
        </ul>
        <div v-if="question.jumpRules.length" class="published-rules">
          <strong>跳转规则</strong>
          <ol>
            <li v-for="rule in question.jumpRules" :key="rule.ruleId">
              {{ operatorLabels[rule.operator] }}“{{
                ruleValue(question, rule)
              }}” → {{ questionNumber(rule.targetQuestionId) }}
            </li>
          </ol>
          <small>按顺序采用第一条命中的规则；未命中则进入下一题。</small>
        </div>
      </article>
    </div>
    <p v-else class="empty-state">此发布版本没有题目。</p>
  </section>
</template>
