<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  getVersionStatistics,
  listIdentifiedSubmissions,
  listTextResponses,
  type IdentifiedSubmissionItem,
  type QuestionStatistics,
  type TextResponseItem,
  type VersionStatistics,
} from "./surveys";

const props = defineProps<{ surveyId: string; versionId: string }>();
const emit = defineEmits<{ failure: [error: unknown] }>();
const statistics = ref<VersionStatistics>();
const loading = ref(false);
const textItems = ref<Record<string, TextResponseItem[]>>({});
const textCursors = ref<Record<string, string | null>>({});
const textModes = ref<Record<string, "anonymous" | "identified">>({});
const textLoading = ref<string>();
const submissionItems = ref<IdentifiedSubmissionItem[]>([]);
const submissionCursor = ref<string | null>(null);
const submissionsLoading = ref(false);

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const numberText = (value: number | null) =>
  value === null ? "暂无数据" : String(value);

async function loadStatistics(): Promise<void> {
  loading.value = true;
  try {
    const result = await getVersionStatistics(props.surveyId, props.versionId);
    statistics.value = result;
    textItems.value = {};
    textCursors.value = {};
    textModes.value = {};
    submissionItems.value = [];
    submissionCursor.value = null;
    if (result.identityMode === "identified") await loadSubmissions();
  } catch (error) {
    emit("failure", error);
  } finally {
    loading.value = false;
  }
}

async function loadSubmissions(): Promise<void> {
  submissionsLoading.value = true;
  try {
    const page = await listIdentifiedSubmissions(
      props.surveyId,
      props.versionId,
      submissionCursor.value ?? undefined,
    );
    submissionItems.value = [...submissionItems.value, ...page.items];
    submissionCursor.value = page.nextCursor;
  } catch (error) {
    emit("failure", error);
  } finally {
    submissionsLoading.value = false;
  }
}

async function loadText(question: QuestionStatistics): Promise<void> {
  textLoading.value = question.questionId;
  try {
    const page = await listTextResponses(
      props.surveyId,
      props.versionId,
      question.questionId,
      textCursors.value[question.questionId] ?? undefined,
    );
    textItems.value[question.questionId] = [
      ...(textItems.value[question.questionId] ?? []),
      ...page.items,
    ];
    textCursors.value[question.questionId] = page.nextCursor;
    textModes.value[question.questionId] = page.identityMode;
  } catch (error) {
    emit("failure", error);
  } finally {
    textLoading.value = undefined;
  }
}

onMounted(loadStatistics);
watch(() => props.versionId, loadStatistics);
</script>

<template>
  <section id="version-statistics" class="settings-card statistics-shell">
    <div class="question-heading">
      <div>
        <h3>回答统计</h3>
        <p class="muted">统计固定绑定当前已发布版本，不与其他版本混合。</p>
      </div>
      <button
        class="secondary compact"
        :disabled="loading"
        @click="loadStatistics"
      >
        {{ loading ? "统计中…" : "刷新统计" }}
      </button>
    </div>
    <p v-if="statistics" class="statistics-total">
      共 <strong>{{ statistics.submissionCount }}</strong> 份提交 · 生成于
      {{ new Date(statistics.generatedAt).toLocaleString() }}
    </p>
    <div v-if="statistics" class="statistics-list">
      <article
        v-for="(question, index) in statistics.questions"
        :key="question.questionId"
        class="statistics-question"
      >
        <header>
          <strong>第 {{ index + 1 }} 题 · {{ question.title }}</strong>
          <span>{{ question.required ? "必答" : "选答" }}</span>
        </header>
        <div class="statistics-metrics">
          <span
            >到达 {{ question.reachedCount }}（{{
              percent(question.reachRate)
            }}）</span
          >
          <span
            >回答 {{ question.answeredCount }}（{{
              percent(question.answerRate)
            }}）</span
          >
          <span>未到达（被跳转跳过） {{ question.notReachedCount }}</span>
          <span>到达但未回答 {{ question.unansweredReachedCount }}</span>
        </div>
        <ul v-if="question.options" class="statistics-options">
          <li v-for="option in question.options" :key="option.optionId">
            <span>{{ option.text }}</span>
            <strong
              >{{ option.count }} ·
              {{ percent(option.percentageOfAnswered) }}</strong
            >
          </li>
        </ul>
        <dl v-if="question.number" class="statistics-number">
          <div>
            <dt>数量</dt>
            <dd>{{ question.number.count }}</dd>
          </div>
          <div>
            <dt>平均值</dt>
            <dd>{{ numberText(question.number.average) }}</dd>
          </div>
          <div>
            <dt>最小值</dt>
            <dd>{{ numberText(question.number.minimum) }}</dd>
          </div>
          <div>
            <dt>最大值</dt>
            <dd>{{ numberText(question.number.maximum) }}</dd>
          </div>
        </dl>
        <div v-if="question.type === 'text'" class="text-responses">
          <button
            v-if="
              !textItems[question.questionId]?.length ||
              textCursors[question.questionId]
            "
            class="secondary compact"
            :disabled="textLoading === question.questionId"
            @click="loadText(question)"
          >
            {{
              textLoading === question.questionId
                ? "加载中…"
                : textItems[question.questionId]?.length
                  ? "加载更多文本回答"
                  : "查看文本回答"
            }}
          </button>
          <p
            v-if="textModes[question.questionId] === 'anonymous'"
            class="privacy-note"
          >
            匿名回答仅显示 UTC
            日期；页内顺序仍反映提交先后。样本很少时，内容本身可能让人推断填写者。
          </p>
          <ol
            v-if="textItems[question.questionId]?.length"
            class="text-response-list"
          >
            <li
              v-for="(item, itemIndex) in textItems[question.questionId]"
              :key="itemIndex"
            >
              <small v-if="item.submittedDate"
                >UTC 日期：{{ item.submittedDate }}</small
              >
              <small v-else>
                {{ item.respondent?.username ?? "账号已删除" }} ·
                {{
                  item.submittedAt
                    ? new Date(item.submittedAt).toLocaleString()
                    : ""
                }}
              </small>
              <p>{{ item.value }}</p>
            </li>
          </ol>
        </div>
      </article>
    </div>
    <section
      v-if="statistics?.identityMode === 'identified'"
      class="identified-submissions"
    >
      <h4>实名提交记录</h4>
      <p class="muted">每次正式提交单独列出；同一账号可能出现多次。</p>
      <ol v-if="submissionItems.length" class="submission-list">
        <li v-for="(item, index) in submissionItems" :key="index">
          <strong>{{ item.respondent?.username ?? "账号已删除" }}</strong>
          <span>{{ new Date(item.submittedAt).toLocaleString("zh-CN") }}</span>
        </li>
      </ol>
      <p v-else-if="!submissionsLoading" class="empty-state">
        暂无实名提交记录。
      </p>
      <button
        v-if="submissionCursor"
        class="secondary compact"
        type="button"
        :disabled="submissionsLoading"
        @click="loadSubmissions"
      >
        {{ submissionsLoading ? "加载中…" : "加载更多提交记录" }}
      </button>
    </section>
    <p v-if="!statistics && !loading" class="empty-state">尚未取得统计结果。</p>
  </section>
</template>
