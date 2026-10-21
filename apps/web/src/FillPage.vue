<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  computePath,
  evaluateNextQuestion,
  validateAnswer,
  type SurveyQuestion,
} from "@survey/survey-logic";
import { ApiClientError, type PublicUser } from "./auth";
import {
  clearFillDraft,
  clearFillDraftsForSession,
  createFillSession,
  fetchPublicSurvey,
  fillAccountExitRequest,
  fillStartControl,
  restoreFillDraft,
  resumeFillSession,
  saveFillDraft,
  submitFillSession,
  type FillRoute,
  type FillSessionResponse,
  type PublicSurvey,
  type SubmissionIssue,
  type SubmissionResponse,
} from "./fill";

const props = defineProps<{ route: FillRoute; user?: PublicUser }>();
const emit = defineEmits<{
  requireLogin: [path: string];
  routeChanged: [route: FillRoute];
  signOut: [request: ReturnType<typeof fillAccountExitRequest>];
}>();

const loading = ref(true);
const starting = ref(false);
const submitting = ref(false);
const summary = ref<PublicSurvey>();
const active = ref<FillSessionResponse>();
const completed = ref<SubmissionResponse["submission"]>();
const error = ref("");
const answerError = ref("");
const currentIndex = ref(0);
const visited = ref<string[]>([]);
const reviewing = ref(false);
const remainingSeconds = ref(0);
const storageWarning = ref("");
const alreadySubmitted = ref(false);
const answers = reactive<Record<string, string | string[] | number>>({});
const numberInputs = reactive<Record<string, string>>({});
const serverIssues = reactive<Record<string, SubmissionIssue>>({});
let timer: number | undefined;
let draftTimer: number | undefined;
let serverStartedAt = 0;
let performanceStartedAt = 0;

const questions = computed(() => active.value?.version.questions ?? []);
const currentQuestion = computed(() => {
  const id = visited.value[currentIndex.value];
  return questions.value.find((question) => question.questionId === id);
});
const countdown = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60);
  const seconds = remainingSeconds.value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});
const startControl = computed(() =>
  fillStartControl({
    status: summary.value?.status ?? "closed",
    starting: starting.value,
    authenticated: Boolean(props.user),
    alreadySubmitted: alreadySubmitted.value,
  }),
);

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作失败，请稍后重试";
}

function removeDraft(): void {
  if (active.value)
    clearFillDraft(active.value.session.id, active.value.version.id);
}

function handleSessionError(cause: unknown): void {
  if (cause instanceof ApiClientError) {
    if (cause.code === "AUTH_REQUIRED" || cause.code === "AUTH_INVALID") {
      emit("requireLogin", window.location.pathname);
      return;
    }
    if (cause.code === "ALREADY_SUBMITTED") alreadySubmitted.value = true;
    if (
      [
        "SESSION_NOT_FOUND",
        "SESSION_EXPIRED",
        "SURVEY_EXPIRED",
        "SURVEY_CLOSED",
      ].includes(cause.code)
    ) {
      removeDraft();
      if (props.route.sessionId)
        clearFillDraftsForSession(props.route.sessionId);
    }
  }
  error.value = messageOf(cause);
}

function requestSignOut(): void {
  if (active.value) persistDraft();
  emit("signOut", fillAccountExitRequest(props.route, Boolean(active.value)));
}

function beginCountdown(data: FillSessionResponse): void {
  serverStartedAt = new Date(data.session.serverNow).getTime();
  performanceStartedAt = performance.now();
  const update = () => {
    const estimatedNow =
      serverStartedAt + (performance.now() - performanceStartedAt);
    const effectiveEnd = Math.min(
      new Date(data.session.expiresAt).getTime(),
      data.version.deadline
        ? new Date(data.version.deadline).getTime()
        : Number.POSITIVE_INFINITY,
    );
    remainingSeconds.value = Math.max(
      0,
      Math.ceil((effectiveEnd - estimatedNow) / 1_000),
    );
    if (remainingSeconds.value === 0) {
      error.value = "填写会话已过期，请重新开始。";
      removeDraft();
      if (timer !== undefined) window.clearInterval(timer);
    }
  };
  update();
  timer = window.setInterval(update, 1_000);
}

function installSession(data: FillSessionResponse): void {
  active.value = data;
  visited.value = data.version.questions[0]
    ? [data.version.questions[0].questionId]
    : [];
  currentIndex.value = 0;
  const draft = restoreFillDraft(data.session.id, data.version);
  if (draft) {
    Object.assign(answers, draft.answers);
    for (const [questionId, value] of Object.entries(draft.answers))
      if (typeof value === "number") numberInputs[questionId] = String(value);
    const restoredPath = computePath(data.version.questions, draft.answers);
    const position = restoredPath.questionIds.indexOf(draft.currentQuestionId);
    if (position >= 0) {
      visited.value = restoredPath.questionIds.slice(0, position + 1);
      currentIndex.value = visited.value.length - 1;
    }
  }
  beginCountdown(data);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    summary.value = (await fetchPublicSurvey(props.route.publicId)).survey;
    if (props.route.sessionId && props.user)
      installSession(await resumeFillSession(props.route.sessionId));
  } catch (cause) {
    handleSessionError(cause);
  } finally {
    loading.value = false;
  }
}

async function start(): Promise<void> {
  if (!props.user) {
    emit("requireLogin", `/fill/${props.route.publicId}`);
    return;
  }
  starting.value = true;
  error.value = "";
  alreadySubmitted.value = false;
  try {
    const data = await createFillSession(props.route.publicId);
    installSession(data);
    const route = {
      publicId: props.route.publicId,
      sessionId: data.session.id,
    };
    history.pushState(
      {},
      "",
      `/fill/${route.publicId}/session/${route.sessionId}`,
    );
    emit("routeChanged", route);
  } catch (cause) {
    handleSessionError(cause);
  } finally {
    starting.value = false;
  }
}

function multipleValues(questionId: string): string[] {
  const value = answers[questionId];
  return Array.isArray(value) ? value : [];
}

function toggleMultiple(
  questionId: string,
  optionId: string,
  checked: boolean,
) {
  const values = multipleValues(questionId);
  answers[questionId] = checked
    ? [...values, optionId]
    : values.filter((value) => value !== optionId);
}

function candidate(question: SurveyQuestion): unknown {
  if (question.type !== "number") return answers[question.questionId];
  const raw = numberInputs[question.questionId] ?? "";
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : raw;
}

function goNext(): void {
  const question = currentQuestion.value;
  if (!question) return;
  answerError.value = "";
  delete serverIssues[question.questionId];
  const result = validateAnswer(question, candidate(question));
  if (!result.ok) {
    answerError.value = result.reason;
    return;
  }
  if (result.answered && result.value !== null)
    answers[question.questionId] = result.value;
  else delete answers[question.questionId];
  const next = evaluateNextQuestion(
    questions.value,
    question.questionId,
    result.value,
  );
  const prefix = visited.value.slice(0, currentIndex.value + 1);
  const previousFuture = visited.value.slice(currentIndex.value + 1);
  if (next.kind === "end") {
    visited.value = prefix;
    const kept = new Set(prefix);
    for (const id of Object.keys(answers))
      if (!kept.has(id)) delete answers[id];
    reviewing.value = true;
    return;
  }
  if (previousFuture[0] === next.questionId)
    visited.value = [...prefix, ...previousFuture];
  else {
    visited.value = [...prefix, next.questionId];
    const kept = new Set(visited.value);
    for (const id of Object.keys(answers))
      if (!kept.has(id)) delete answers[id];
  }
  currentIndex.value += 1;
}

function submissionIssues(cause: ApiClientError): SubmissionIssue[] {
  const raw = cause.details?.issues;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SubmissionIssue =>
    Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as SubmissionIssue).questionId === "string" &&
      typeof (item as SubmissionIssue).message === "string",
    ),
  );
}

async function submitAnswers(): Promise<void> {
  if (!active.value || submitting.value) return;
  submitting.value = true;
  error.value = "";
  Object.keys(serverIssues).forEach((questionId) => {
    delete serverIssues[questionId];
  });
  try {
    const payload = Object.entries(answers).map(([questionId, value]) => ({
      questionId,
      value,
    }));
    const result = await submitFillSession(active.value.session.id, payload);
    result.submission.ignoredQuestionIds.forEach((questionId) => {
      delete answers[questionId];
      delete numberInputs[questionId];
    });
    clearFillDraft(active.value.session.id, active.value.version.id);
    completed.value = result.submission;
    if (timer !== undefined) window.clearInterval(timer);
  } catch (cause) {
    if (
      cause instanceof ApiClientError &&
      cause.code === "ANSWER_VALIDATION_FAILED"
    ) {
      const issues = submissionIssues(cause);
      issues.forEach((issue) => {
        serverIssues[issue.questionId] = issue;
      });
      const first = issues[0];
      if (first) {
        reviewing.value = false;
        const position = visited.value.indexOf(first.questionId);
        if (position >= 0) currentIndex.value = position;
        answerError.value = first.message;
      }
      error.value = "请修改标出的回答后重新提交。";
    } else handleSessionError(cause);
  } finally {
    submitting.value = false;
  }
}

function goBack(): void {
  answerError.value = "";
  if (reviewing.value) {
    reviewing.value = false;
    currentIndex.value = Math.max(0, visited.value.length - 1);
  } else if (currentIndex.value > 0) currentIndex.value -= 1;
}

function answerLabel(question: SurveyQuestion): string {
  const value = answers[question.questionId];
  if (Array.isArray(value))
    return value
      .map(
        (id) => question.options.find((option) => option.optionId === id)?.text,
      )
      .filter(Boolean)
      .join("、");
  if (question.type === "single")
    return (
      question.options.find((option) => option.optionId === value)?.text ??
      "未回答"
    );
  return value === undefined ? "未回答" : String(value);
}

function persistDraft(): void {
  if (!active.value || !currentQuestion.value) return;
  try {
    saveFillDraft(active.value.session.id, active.value.version.id, {
      answers: { ...answers },
      currentQuestionId: currentQuestion.value.questionId,
      savedAt: new Date().toISOString(),
    });
    storageWarning.value = "";
  } catch {
    storageWarning.value = "本地临时保存失败，请勿关闭页面。";
  }
}

watch(
  [answers, currentIndex],
  () => {
    if (draftTimer !== undefined) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(persistDraft, 400);
  },
  { deep: true },
);

onMounted(load);
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
  if (draftTimer !== undefined) window.clearTimeout(draftTimer);
});
</script>

<template>
  <section class="fill-panel" aria-live="polite">
    <p v-if="loading" class="muted">正在读取问卷…</p>
    <template v-else-if="summary">
      <header class="fill-header">
        <div>
          <p class="eyebrow">公开问卷</p>
          <h2>{{ active?.version.title ?? summary.title }}</h2>
        </div>
        <div class="fill-header-actions">
          <span v-if="active" class="fill-timer">剩余 {{ countdown }}</span>
          <div v-if="user" class="fill-account">
            <span
              >当前账号：<strong>{{ user.username }}</strong></span
            >
            <button
              class="secondary compact"
              type="button"
              @click="requestSignOut"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>
      <p v-if="!active" class="fill-description">{{ summary.description }}</p>
      <p class="identity-notice">
        {{
          summary.identityMode === "anonymous"
            ? "匿名填写：创建者看不到您的账号；登录仅用于防止重复填写。"
            : "实名填写：创建者将看到您的账号身份。"
        }}
      </p>
      <p v-if="error" class="error message-bar">{{ error }}</p>
      <p v-if="storageWarning" class="warning">{{ storageWarning }}</p>

      <div v-if="!active" class="fill-summary-card">
        <span>{{ summary.questionCount }} 道题</span>
        <span>预计会话 {{ summary.sessionDurationMinutes }} 分钟</span>
        <span v-if="summary.deadline">
          截止：{{ new Date(summary.deadline).toLocaleString("zh-CN") }}
        </span>
        <button
          class="primary"
          type="button"
          :disabled="startControl.disabled"
          @click="start"
        >
          {{ startControl.label }}
        </button>
        <button
          v-if="alreadySubmitted && user"
          class="secondary"
          type="button"
          @click="requestSignOut"
        >
          切换账号填写
        </button>
      </div>

      <section v-if="completed" class="fill-question-card fill-success">
        <p class="eyebrow">提交成功</p>
        <h3>
          {{
            completed.alreadySubmitted ? "该回答此前已提交成功" : "感谢您的填写"
          }}
        </h3>
        <p>提交编号：{{ completed.id }}</p>
        <p>
          提交时间：{{
            new Date(completed.submittedAt).toLocaleString("zh-CN")
          }}
        </p>
      </section>

      <template v-else-if="questions.length">
        <section v-if="reviewing" class="fill-question-card">
          <p class="eyebrow">提交前检查</p>
          <h3>请确认本次填写内容</h3>
          <ol class="fill-review">
            <li v-for="questionId in visited" :key="questionId">
              <template
                v-for="question in questions.filter(
                  (item) => item.questionId === questionId,
                )"
                :key="question.questionId"
              >
                <strong>{{ question.title }}</strong>
                <span>{{ answerLabel(question) }}</span>
              </template>
            </li>
          </ol>
          <p class="notice">提交后不能修改，请确认内容无误。</p>
          <div class="fill-actions">
            <button
              class="secondary"
              type="button"
              :disabled="submitting"
              @click="goBack"
            >
              返回修改
            </button>
            <button
              class="primary"
              type="button"
              :disabled="submitting"
              @click="submitAnswers"
            >
              {{ submitting ? "正在提交…" : "确认提交" }}
            </button>
          </div>
        </section>

        <section v-else-if="currentQuestion" class="fill-question-card">
          <p class="fill-progress">
            第 {{ currentIndex + 1 }} 题（最多 {{ questions.length }} 题）
          </p>
          <h3>
            {{ currentQuestion.title }}
            <span v-if="currentQuestion.required" class="required">必答</span>
          </h3>
          <div v-if="currentQuestion.type === 'single'" class="fill-options">
            <label
              v-for="option in currentQuestion.options"
              :key="option.optionId"
            >
              <input
                v-model="answers[currentQuestion.questionId]"
                type="radio"
                :name="currentQuestion.questionId"
                :value="option.optionId"
              />{{ option.text }}
            </label>
          </div>
          <div
            v-else-if="currentQuestion.type === 'multiple'"
            class="fill-options"
          >
            <label
              v-for="option in currentQuestion.options"
              :key="option.optionId"
            >
              <input
                type="checkbox"
                :checked="
                  multipleValues(currentQuestion.questionId).includes(
                    option.optionId,
                  )
                "
                @change="
                  toggleMultiple(
                    currentQuestion.questionId,
                    option.optionId,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />{{ option.text }}
            </label>
          </div>
          <textarea
            v-else-if="currentQuestion.type === 'text'"
            :value="answers[currentQuestion.questionId] ?? ''"
            rows="6"
            placeholder="请输入回答"
            @input="
              answers[currentQuestion.questionId] = (
                $event.target as HTMLTextAreaElement
              ).value
            "
          ></textarea>
          <input
            v-else
            v-model="numberInputs[currentQuestion.questionId]"
            type="text"
            inputmode="decimal"
            placeholder="请输入数字"
          />
          <p v-if="answerError" class="field-error">{{ answerError }}</p>
          <p
            v-else-if="serverIssues[currentQuestion.questionId]"
            class="field-error"
          >
            {{ serverIssues[currentQuestion.questionId]?.message }}
          </p>
          <div class="fill-actions">
            <button
              class="secondary"
              type="button"
              :disabled="currentIndex === 0"
              @click="goBack"
            >
              上一题
            </button>
            <button class="primary" type="button" @click="goNext">
              {{ currentIndex + 1 === visited.length ? "下一题" : "继续" }}
            </button>
          </div>
        </section>
      </template>
      <p v-else-if="active" class="empty-state">这份问卷没有可填写题目。</p>
    </template>
  </section>
</template>
