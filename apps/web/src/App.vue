<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from "vue";
import {
  ApiClientError,
  currentUser,
  login,
  logout,
  register,
  type PublicUser,
} from "./auth";
import DeadlineInput from "./DeadlineInput.vue";
import FillPage from "./FillPage.vue";
import JumpRuleEditor from "./JumpRuleEditor.vue";
import PublishedVersionView from "./PublishedVersionView.vue";
import QuestionEditor from "./QuestionEditor.vue";
import StatisticsView from "./StatisticsView.vue";
import { fetchHealth, type HealthResponse } from "./health";
import { parseFillRoute, safeFillReturnPath, type FillRoute } from "./fill";
import {
  changedDraftFields,
  clearSettingsDraft,
  createNextVersion,
  createSurvey,
  discardDraft,
  findSettingsDraft,
  getVersion,
  listSurveys,
  listVersions,
  patchDraft,
  publishVersion,
  renameSurvey,
  saveSettingsDraft,
  setSurveyStatus,
  type DraftFields,
  type PublishCheck,
  type StoredDraft,
  type SurveySummary,
  type SurveyVersion,
  type VersionHistorySummary,
} from "./surveys";

type Mode = "login" | "register";
const mode = ref<Mode>("login");
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const user = ref<PublicUser>();
const health = ref<HealthResponse>();
const loading = ref(true);
const submitting = ref(false);
const writing = ref(false);
const questionsDirty = ref(false);
const rulesDirty = ref(false);
const publishCheck = ref<PublishCheck>();
const showingPreview = ref(false);
const message = ref("");
const publishError = ref("");
const surveys = ref<SurveySummary[]>([]);
const nextCursor = ref<string | null>(null);
const newSurveyName = ref("");
const page = ref<"list" | "edit">("list");
const selectedSurvey = ref<SurveySummary>();
const selectedVersion = ref<SurveyVersion>();
const versionHistory = ref<VersionHistorySummary[]>([]);
const historyCursor = ref<string | null>(null);
const questionNavigation = ref<Array<{ id: string; label: string }>>([]);
const internalName = ref("");
const original = ref<DraftFields>();
const form = reactive<DraftFields>({
  title: "",
  description: "",
  identityMode: "anonymous",
  allowMultipleSubmissions: false,
  deadline: null,
});
const recovery = ref<{ key: string; draft: StoredDraft }>();
const savedAt = ref("");
const fieldErrors = reactive<Record<string, string>>({});
const deadlineInputValid = ref(true);
const fillRoute = ref<FillRoute | undefined>(
  parseFillRoute(window.location.pathname),
);
const fillLogin = ref(false);
const pendingFillPath = ref<string>();

const changed = computed(() =>
  original.value ? changedDraftFields(original.value, form) : {},
);
const dirty = computed(() => Object.keys(changed.value).length > 0);
const hasUnsaved = computed(
  () => dirty.value || questionsDirty.value || rulesDirty.value,
);
const previewAvailable = computed(
  () =>
    publishCheck.value?.valid === true &&
    publishCheck.value.revision === selectedVersion.value?.revision &&
    !hasUnsaved.value,
);
const recoveryChanges = computed(() =>
  recovery.value && original.value
    ? changedDraftFields(original.value, recovery.value.draft.fields)
    : {},
);
const fieldLabels: Record<string, string> = {
  title: "公开标题",
  description: "说明",
  identityMode: "身份模式",
  allowMultipleSubmissions: "重复填写",
  deadline: "截止时间",
};
const editableFieldNames = new Set([
  "internalName",
  "title",
  "description",
  "identityMode",
  "allowMultipleSubmissions",
  "deadline",
]);
function displayValue(value: unknown): string {
  if (value === null || value === "") return "无";
  if (typeof value === "boolean") return value ? "允许" : "不允许";
  return String(value);
}

async function scrollToEditorTarget(id: string): Promise<void> {
  await nextTick();
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function fieldsOf(version: SurveyVersion): DraftFields {
  return {
    title: version.title,
    description: version.description,
    identityMode: version.identityMode,
    allowMultipleSubmissions: version.allowMultipleSubmissions,
    deadline: version.deadline,
  };
}
function assignForm(fields: DraftFields): void {
  Object.assign(form, fields);
}
function stashIfNeeded(): void {
  if (dirty.value && selectedSurvey.value && selectedVersion.value)
    saveSettingsDraft(
      selectedSurvey.value.id,
      selectedVersion.value.id,
      selectedVersion.value.revision,
      { ...form },
    );
}
function showError(error: unknown): void {
  if (
    error instanceof ApiClientError &&
    ["AUTH_REQUIRED", "AUTH_INVALID"].includes(error.code)
  ) {
    stashIfNeeded();
    user.value = undefined;
    page.value = "list";
    message.value = "登录已过期，请重新登录。未保存的设置已临时保留。";
    return;
  }
  if (
    error instanceof ApiClientError &&
    page.value === "edit" &&
    typeof error.details?.field === "string" &&
    editableFieldNames.has(error.details.field)
  ) {
    fieldErrors[error.details.field] = error.message;
    return;
  }
  message.value =
    error instanceof Error ? error.message : "操作失败，请稍后重试";
}
function showQuestionError(error: unknown): void {
  if (
    error instanceof ApiClientError &&
    error.code === "VALIDATION_ERROR" &&
    typeof error.details?.path === "string"
  )
    return;
  showError(error);
}
function clearFieldError(field: string): void {
  delete fieldErrors[field];
  message.value = "";
}

async function loadSurveyList(append = false): Promise<void> {
  const result = await listSurveys(
    append ? (nextCursor.value ?? undefined) : undefined,
  );
  surveys.value = append ? [...surveys.value, ...result.items] : result.items;
  nextCursor.value = result.nextCursor;
}

async function submitAuth(): Promise<void> {
  message.value = "";
  if (mode.value === "register" && password.value !== confirmPassword.value) {
    message.value = "两次输入的密码不一致";
    password.value = "";
    confirmPassword.value = "";
    return;
  }
  submitting.value = true;
  try {
    const result =
      mode.value === "register"
        ? await register(username.value, password.value)
        : await login(username.value, password.value);
    user.value = result.user;
    password.value = "";
    confirmPassword.value = "";
    if (pendingFillPath.value) {
      const path = safeFillReturnPath(pendingFillPath.value);
      pendingFillPath.value = undefined;
      fillLogin.value = false;
      if (path) {
        history.replaceState({}, "", path);
        fillRoute.value = parseFillRoute(path);
        return;
      }
    }
    await loadSurveyList();
  } catch (error) {
    password.value = "";
    confirmPassword.value = "";
    showError(error);
  } finally {
    submitting.value = false;
    showPassword.value = false;
    showConfirmPassword.value = false;
  }
}

function requireFillLogin(path: string): void {
  const safePath = safeFillReturnPath(path);
  if (!safePath) return;
  pendingFillPath.value = safePath;
  fillLogin.value = true;
  mode.value = "login";
  message.value = "请登录后继续填写；登录成功后会返回当前问卷。";
}

function updateFillRoute(route: FillRoute): void {
  fillRoute.value = route;
}

async function copyPublicLink(): Promise<void> {
  if (!selectedSurvey.value) return;
  try {
    await navigator.clipboard.writeText(
      `${window.location.origin}/fill/${selectedSurvey.value.publicId}`,
    );
    message.value = "公开填写链接已复制。";
  } catch {
    message.value = "复制失败，请手动复制公开链接。";
  }
}

async function addSurvey(): Promise<void> {
  try {
    const result = await createSurvey(newSurveyName.value);
    newSurveyName.value = "";
    surveys.value.unshift(result.survey);
    await openEditor(result.survey);
  } catch (error) {
    showError(error);
  }
}

async function openEditor(survey: SurveySummary): Promise<void> {
  const target = survey.draftVersion ?? survey.currentVersion;
  if (!target) return;
  try {
    const [result, history] = await Promise.all([
      getVersion(survey.id, target.id),
      listVersions(survey.id),
    ]);
    selectedSurvey.value = survey;
    selectedVersion.value = result.version;
    versionHistory.value = history.items;
    historyCursor.value = history.nextCursor;
    internalName.value = survey.internalName;
    original.value = fieldsOf(result.version);
    assignForm(original.value);
    recovery.value = findSettingsDraft(survey.id, result.version.id);
    page.value = "edit";
    Object.keys(fieldErrors).forEach((field) => delete fieldErrors[field]);
    message.value = "";
    publishError.value = "";
    publishCheck.value = undefined;
    showingPreview.value = false;
    savedAt.value = "";
    questionsDirty.value = false;
    rulesDirty.value = false;
    questionNavigation.value = result.version.questions.map(
      (question, index) => ({
        id: `question-${question.questionId}`,
        label: `第 ${index + 1} 题`,
      }),
    );
  } catch (error) {
    showError(error);
  }
}

function replaceSurvey(summary: SurveySummary): void {
  selectedSurvey.value = summary;
  surveys.value = surveys.value.map((item) =>
    item.id === summary.id ? summary : item,
  );
}

async function refreshHistory(append = false): Promise<void> {
  if (!selectedSurvey.value) return;
  const result = await listVersions(
    selectedSurvey.value.id,
    append ? (historyCursor.value ?? undefined) : undefined,
  );
  versionHistory.value = append
    ? [...versionHistory.value, ...result.items]
    : result.items;
  historyCursor.value = result.nextCursor;
}

async function openHistoryVersion(versionId: string): Promise<void> {
  if (!selectedSurvey.value || hasUnsaved.value) return;
  try {
    const result = await getVersion(selectedSurvey.value.id, versionId);
    selectedVersion.value = result.version;
    original.value = fieldsOf(result.version);
    assignForm(original.value);
    publishCheck.value = undefined;
    showingPreview.value = false;
    message.value = "";
  } catch (error) {
    showError(error);
  }
}

async function publishSelected(acknowledgeWarnings = false): Promise<void> {
  if (!selectedSurvey.value || !selectedVersion.value) return;
  writing.value = true;
  message.value = "";
  publishError.value = "";
  try {
    const result = await publishVersion(
      selectedSurvey.value.id,
      selectedVersion.value.id,
      selectedVersion.value.revision,
      acknowledgeWarnings,
    );
    replaceSurvey(result.survey);
    selectedVersion.value = result.version;
    original.value = fieldsOf(result.version);
    await refreshHistory();
    message.value =
      result.survey.status === "closed"
        ? "新版本已发布，但问卷仍处于关闭状态。"
        : "版本发布成功。";
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      error.code === "PUBLISH_WARNINGS_UNCONFIRMED" &&
      window.confirm("发布检查存在警告，确认仍要发布吗？")
    ) {
      writing.value = false;
      await publishSelected(true);
      return;
    }
    if (error instanceof ApiClientError && error.code === "PUBLISH_BLOCKED") {
      const check = error.details?.check as
        { errors?: Array<{ message?: string }> } | undefined;
      publishError.value = `发布检查未通过：${
        check?.errors
          ?.map((item) => item.message)
          .filter(Boolean)
          .join("；") || "请重新执行上方检查"
      }`;
      return;
    }
    if (
      error instanceof ApiClientError &&
      error.code === "VERSION_NOT_EDITABLE"
    ) {
      await loadSurveyList();
      const refreshed = surveys.value.find(
        (item) => item.id === selectedSurvey.value?.id,
      );
      if (
        refreshed?.currentVersion?.id === selectedVersion.value?.id &&
        selectedSurvey.value
      ) {
        replaceSurvey(refreshed);
        selectedVersion.value = (
          await getVersion(refreshed.id, refreshed.currentVersion.id)
        ).version;
        await refreshHistory();
        message.value = "该版本已经发布，页面状态已刷新。";
        return;
      }
    }
    showError(error);
  } finally {
    writing.value = false;
  }
}

async function createDraftFromCurrent(): Promise<void> {
  if (!selectedSurvey.value?.currentVersion) return;
  writing.value = true;
  try {
    const result = await createNextVersion(
      selectedSurvey.value.id,
      selectedSurvey.value.currentVersion.id,
    );
    replaceSurvey(result.survey);
    selectedVersion.value = result.version;
    original.value = fieldsOf(result.version);
    assignForm(original.value);
    await refreshHistory();
    if (
      result.version.deadline &&
      new Date(result.version.deadline) <= new Date()
    )
      message.value = "复制来的截止时间已经过去，请修改后再发布。";
  } catch (error) {
    showError(error);
  } finally {
    writing.value = false;
  }
}

async function discardSelectedDraft(): Promise<void> {
  if (
    !selectedSurvey.value ||
    !selectedVersion.value ||
    !window.confirm("确定放弃这个草稿吗？未发布修改将永久删除。")
  )
    return;
  writing.value = true;
  try {
    const result = await discardDraft(
      selectedSurvey.value.id,
      selectedVersion.value.id,
      selectedVersion.value.revision,
    );
    replaceSurvey(result.survey);
    const current = result.survey.currentVersion;
    if (current)
      selectedVersion.value = (
        await getVersion(result.survey.id, current.id)
      ).version;
    await refreshHistory();
    message.value = "草稿已放弃。";
  } catch (error) {
    showError(error);
  } finally {
    writing.value = false;
  }
}

async function changeManualStatus(manualStatus: "open" | "closed") {
  if (!selectedSurvey.value) return;
  writing.value = true;
  try {
    const result = await setSurveyStatus(selectedSurvey.value.id, manualStatus);
    replaceSurvey(result.survey);
    message.value =
      manualStatus === "closed"
        ? "问卷已关闭。"
        : result.survey.status === "expired"
          ? "问卷已重新开放，但当前版本仍已过期。"
          : "问卷已重新开放。";
  } catch (error) {
    showError(error);
  } finally {
    writing.value = false;
  }
}

function useRecovery(): void {
  if (!recovery.value) return;
  assignForm(recovery.value.draft.fields);
  clearSettingsDraft(recovery.value.key);
  recovery.value = undefined;
}
function discardRecovery(): void {
  if (recovery.value) clearSettingsDraft(recovery.value.key);
  recovery.value = undefined;
}

async function saveName(): Promise<void> {
  if (!selectedSurvey.value) return;
  clearFieldError("internalName");
  writing.value = true;
  try {
    const result = await renameSurvey(
      selectedSurvey.value.id,
      internalName.value,
    );
    selectedSurvey.value = result.survey;
    surveys.value = surveys.value.map((item) =>
      item.id === result.survey.id ? result.survey : item,
    );
    savedAt.value = new Date().toLocaleTimeString("zh-CN");
  } catch (error) {
    showError(error);
  } finally {
    writing.value = false;
  }
}

async function saveDraft(): Promise<void> {
  if (
    !selectedSurvey.value ||
    !selectedVersion.value ||
    !dirty.value ||
    !deadlineInputValid.value
  )
    return;
  Object.keys(fieldErrors).forEach((field) => delete fieldErrors[field]);
  message.value = "";
  writing.value = true;
  try {
    const result = await patchDraft(
      selectedSurvey.value.id,
      selectedVersion.value.id,
      { revision: selectedVersion.value.revision, ...changed.value },
    );
    selectedVersion.value = result.version;
    original.value = fieldsOf(result.version);
    assignForm(original.value);
    savedAt.value = new Date(result.version.updatedAt).toLocaleString("zh-CN");
    const stored = findSettingsDraft(
      selectedSurvey.value.id,
      result.version.id,
    );
    if (stored) clearSettingsDraft(stored.key);
    await loadSurveyList();
    selectedSurvey.value = surveys.value.find(
      (item) => item.id === selectedSurvey.value?.id,
    );
  } catch (error) {
    showError(error);
  } finally {
    writing.value = false;
  }
}

function updateQuestionVersion(version: SurveyVersion): void {
  selectedVersion.value = version;
  publishCheck.value = undefined;
  showingPreview.value = false;
  savedAt.value = new Date(version.updatedAt).toLocaleString("zh-CN");
  message.value = "";
}

function backToList(): void {
  if (hasUnsaved.value && !window.confirm("仍有未保存内容，确定离开吗？"))
    return;
  page.value = "list";
  selectedSurvey.value = undefined;
  selectedVersion.value = undefined;
  original.value = undefined;
  recovery.value = undefined;
  questionsDirty.value = false;
  rulesDirty.value = false;
  publishCheck.value = undefined;
  showingPreview.value = false;
  Object.keys(fieldErrors).forEach((field) => delete fieldErrors[field]);
  message.value = "";
}

function handlePublishCheck(check: PublishCheck | undefined): void {
  publishCheck.value = check;
  if (!check?.valid) showingPreview.value = false;
}

async function signOut(): Promise<void> {
  if (hasUnsaved.value && !window.confirm("仍有未保存内容，确定退出吗？"))
    return;
  try {
    await logout();
  } catch (error) {
    showError(error);
    return;
  }
  user.value = undefined;
  surveys.value = [];
  page.value = "list";
  mode.value = "login";
}
function switchMode(next: Mode): void {
  mode.value = next;
  password.value = "";
  confirmPassword.value = "";
  showPassword.value = false;
  showConfirmPassword.value = false;
  message.value = "";
}
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (hasUnsaved.value) event.preventDefault();
};

onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnload);
  const [healthResult, userResult] = await Promise.allSettled([
    fetchHealth(),
    currentUser(),
  ]);
  if (healthResult.status === "fulfilled") health.value = healthResult.value;
  if (userResult.status === "fulfilled") {
    user.value = userResult.value.user;
    if (!fillRoute.value)
      try {
        await loadSurveyList();
      } catch (error) {
        showError(error);
      }
  } else if (
    !(userResult.reason instanceof ApiClientError) ||
    !["AUTH_REQUIRED", "AUTH_INVALID"].includes(userResult.reason.code)
  )
    showError(userResult.reason);
  else if (fillRoute.value?.sessionId)
    requireFillLogin(window.location.pathname);
  loading.value = false;
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<template>
  <main class="page-shell" :class="{ workspace: user }">
    <section class="brand-panel">
      <p class="eyebrow">数据库系统大作业一</p>
      <h1>版本化问卷系统</h1>
      <p class="lead">每次发布保留独立版本，让问题、规则与回答始终对应。</p>
      <div class="service-line">
        <span
          class="status-dot"
          :data-state="health?.services.database ?? 'unknown'"
        ></span
        ><span
          >数据库
          {{
            health?.services.database === "connected" ? "已连接" : "状态待确认"
          }}</span
        >
      </div>
    </section>

    <section v-if="loading" class="auth-panel">
      <p class="muted">正在恢复登录状态…</p>
    </section>
    <FillPage
      v-else-if="fillRoute && (!fillLogin || user)"
      :route="fillRoute"
      :user="user"
      @require-login="requireFillLogin"
      @route-changed="updateFillRoute"
    />
    <section v-else-if="!user" class="auth-panel" aria-live="polite">
      <div class="mode-tabs">
        <button
          type="button"
          :class="{ active: mode === 'login' }"
          @click="switchMode('login')"
        >
          登录</button
        ><button
          type="button"
          :class="{ active: mode === 'register' }"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>
      <h2>{{ mode === "login" ? "欢迎回来" : "创建账号" }}</h2>
      <form @submit.prevent="submitAuth">
        <label
          >用户名<input
            v-model="username"
            autocomplete="username"
            maxlength="20"
            required
        /></label>
        <label
          >密码
          <span class="password-field">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="
                mode === 'login' ? 'current-password' : 'new-password'
              "
              maxlength="128"
              required
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                />
                <circle cx="12" cy="12" r="2.6" />
                <path v-if="showPassword" d="m4 4 16 16" />
              </svg>
            </button>
          </span>
        </label>
        <label v-if="mode === 'register'"
          >确认密码
          <span class="password-field">
            <input
              v-model="confirmPassword"
              :type="showConfirmPassword ? 'text' : 'password'"
              autocomplete="new-password"
              maxlength="128"
              required
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="
                showConfirmPassword ? '隐藏确认密码' : '显示确认密码'
              "
              :title="showConfirmPassword ? '隐藏确认密码' : '显示确认密码'"
              @click="showConfirmPassword = !showConfirmPassword"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                />
                <circle cx="12" cy="12" r="2.6" />
                <path v-if="showConfirmPassword" d="m4 4 16 16" />
              </svg>
            </button>
          </span>
        </label>
        <p v-if="message" class="error">{{ message }}</p>
        <button class="primary" :disabled="submitting">
          {{
            submitting ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"
          }}
        </button>
      </form>
    </section>

    <section v-else class="workspace-panel">
      <header class="workspace-header">
        <div>
          <p class="eyebrow">{{ user.username }}</p>
          <h2>{{ page === "list" ? "我的问卷" : "问卷编辑" }}</h2>
        </div>
        <button class="secondary compact" type="button" @click="signOut">
          退出登录
        </button>
      </header>
      <p v-if="message" class="error message-bar">{{ message }}</p>

      <template v-if="page === 'list'">
        <form class="create-row" @submit.prevent="addSurvey">
          <input
            v-model="newSurveyName"
            maxlength="80"
            required
            placeholder="输入新问卷名称"
          /><button class="primary">创建问卷</button>
        </form>
        <div v-if="surveys.length" class="survey-list">
          <button
            v-for="survey in surveys"
            :key="survey.id"
            class="survey-row"
            type="button"
            @click="openEditor(survey)"
          >
            <span
              ><strong>{{ survey.internalName }}</strong
              ><small
                >{{
                  survey.draftVersion?.title ?? survey.currentVersion?.title
                }}
                ·
                <template v-if="survey.draftVersion"
                  >v{{ survey.draftVersion.versionNumber }} 草稿</template
                ><template v-else-if="survey.currentVersion"
                  >v{{ survey.currentVersion.versionNumber }} ·
                  {{ survey.status }}</template
                ></small
              ></span
            ><span>{{ survey.draftVersion ? "编辑" : "查看" }} →</span>
          </button>
        </div>
        <p v-else class="empty-state">还没有问卷。创建第一份 v1 草稿吧。</p>
        <button
          v-if="nextCursor"
          class="secondary"
          type="button"
          @click="loadSurveyList(true)"
        >
          加载更多
        </button>
      </template>

      <template v-else-if="selectedSurvey && selectedVersion">
        <button class="back-link" type="button" @click="backToList">
          ← 返回问卷列表
        </button>
        <div class="editor-layout">
          <nav class="editor-nav" aria-label="问卷编辑导航">
            <strong>编辑导航</strong>
            <button
              type="button"
              @click="scrollToEditorTarget('version-lifecycle')"
            >
              版本与历史
            </button>
            <button
              type="button"
              @click="scrollToEditorTarget('management-settings')"
            >
              管理名称
            </button>
            <template v-if="selectedVersion.status === 'draft'">
              <button
                type="button"
                @click="scrollToEditorTarget('survey-settings')"
              >
                基础设置
              </button>
              <div class="editor-nav-group">
                <span>题目</span>
                <button
                  type="button"
                  @click="scrollToEditorTarget('question-editor')"
                >
                  题目总览
                </button>
                <button
                  v-for="question in questionNavigation"
                  :key="`nav-${question.id}`"
                  type="button"
                  @click="scrollToEditorTarget(question.id)"
                >
                  {{ question.label }}
                </button>
              </div>
              <div class="editor-nav-group">
                <span>跳转</span>
                <button
                  type="button"
                  @click="scrollToEditorTarget('jump-editor')"
                >
                  跳转总览
                </button>
                <button
                  v-for="(question, index) in selectedVersion.questions"
                  :key="`nav-jump-${question.questionId}`"
                  type="button"
                  @click="
                    scrollToEditorTarget(`jump-question-${question.questionId}`)
                  "
                >
                  第 {{ index + 1 }} 题
                </button>
              </div>
              <button
                type="button"
                @click="scrollToEditorTarget('publish-action')"
              >
                检查与发布
              </button>
            </template>
            <div v-else class="editor-nav-group">
              <span>发布版本内容</span>
              <button
                type="button"
                @click="scrollToEditorTarget('published-version')"
              >
                问卷总览
              </button>
              <button
                v-for="(question, index) in selectedVersion.questions"
                :key="`nav-published-${question.questionId}`"
                type="button"
                @click="
                  scrollToEditorTarget(
                    `published-question-${question.questionId}`,
                  )
                "
              >
                第 {{ index + 1 }} 题
              </button>
              <button
                type="button"
                @click="scrollToEditorTarget('version-statistics')"
              >
                回答统计
              </button>
            </div>
          </nav>
          <div class="editor-content">
            <div v-if="recovery" class="recovery-card">
              <strong>发现未保存的本地设置</strong>
              <p>
                本地基于 revision {{ recovery.draft.revision }}，服务器当前为
                {{ selectedVersion.revision }}。请比较后决定是否恢复。
              </p>
              <ul
                v-if="Object.keys(recoveryChanges).length"
                class="comparison-list"
              >
                <li v-for="(localValue, field) in recoveryChanges" :key="field">
                  <strong>{{ fieldLabels[field] ?? field }}</strong>
                  <span
                    >服务器：{{
                      displayValue(original?.[field as keyof DraftFields])
                    }}</span
                  >
                  <span>本地：{{ displayValue(localValue) }}</span>
                </li>
              </ul>
              <div>
                <button class="primary compact" @click="useRecovery">
                  恢复本地内容</button
                ><button class="secondary compact" @click="discardRecovery">
                  放弃恢复
                </button>
              </div>
            </div>
            <div class="settings-grid">
              <section
                id="version-lifecycle"
                class="settings-card lifecycle-card"
              >
                <div class="question-heading">
                  <div>
                    <h3>版本生命周期</h3>
                    <p class="muted">
                      当前查看 v{{ selectedVersion.versionNumber }} ·
                      {{
                        selectedVersion.status === "draft" ? "草稿" : "已发布"
                      }}
                    </p>
                  </div>
                  <div class="lifecycle-actions">
                    <button
                      v-if="
                        selectedSurvey.currentVersion &&
                        !selectedSurvey.draftVersion
                      "
                      class="primary compact"
                      type="button"
                      :disabled="writing"
                      @click="createDraftFromCurrent"
                    >
                      创建下一版本草稿
                    </button>
                    <button
                      v-if="
                        selectedVersion.status === 'draft' &&
                        selectedSurvey.currentVersion
                      "
                      class="danger compact"
                      type="button"
                      :disabled="writing"
                      @click="discardSelectedDraft"
                    >
                      放弃草稿
                    </button>
                    <button
                      v-if="
                        selectedSurvey.currentVersion &&
                        selectedSurvey.status !== 'closed'
                      "
                      class="secondary compact"
                      type="button"
                      :disabled="writing"
                      @click="changeManualStatus('closed')"
                    >
                      关闭问卷
                    </button>
                    <button
                      v-if="selectedSurvey.status === 'closed'"
                      class="secondary compact"
                      type="button"
                      :disabled="writing"
                      @click="changeManualStatus('open')"
                    >
                      重新开放
                    </button>
                  </div>
                </div>
                <div class="version-history">
                  <button
                    v-for="version in versionHistory"
                    :key="version.id"
                    type="button"
                    :class="{ active: version.id === selectedVersion.id }"
                    :disabled="hasUnsaved"
                    @click="openHistoryVersion(version.id)"
                  >
                    v{{ version.versionNumber }} ·
                    {{
                      version.isDraft
                        ? "编辑中草稿"
                        : version.isCurrent
                          ? "当前版本"
                          : "历史版本"
                    }}
                    · {{ version.questionCount }} 题
                  </button>
                  <button
                    v-if="historyCursor"
                    class="secondary compact"
                    type="button"
                    @click="refreshHistory(true)"
                  >
                    更多版本
                  </button>
                </div>
                <div
                  v-if="selectedSurvey.currentVersion"
                  class="public-link-row"
                >
                  <a
                    :href="`/fill/${selectedSurvey.publicId}`"
                    target="_blank"
                    rel="noopener"
                    >打开公开填写页</a
                  >
                  <button
                    class="secondary compact"
                    type="button"
                    @click="copyPublicLink"
                  >
                    复制公开链接
                  </button>
                </div>
              </section>
              <form
                id="management-settings"
                class="settings-card"
                @submit.prevent="saveName"
              >
                <h3>仅自己可见</h3>
                <label
                  >管理名称<input
                    v-model="internalName"
                    maxlength="80"
                    required
                    @input="clearFieldError('internalName')"
                  /><span v-if="fieldErrors.internalName" class="field-error">{{
                    fieldErrors.internalName
                  }}</span></label
                ><button
                  class="secondary"
                  :disabled="
                    writing || internalName === selectedSurvey.internalName
                  "
                >
                  保存管理名称
                </button>
              </form>
              <form
                v-if="selectedVersion.status === 'draft'"
                id="survey-settings"
                class="settings-card"
                @submit.prevent="saveDraft"
              >
                <h3>公开基础设置</h3>
                <label
                  >公开标题<input
                    v-model="form.title"
                    maxlength="120"
                    required
                    @input="clearFieldError('title')"
                  /><span v-if="fieldErrors.title" class="field-error">{{
                    fieldErrors.title
                  }}</span></label
                >
                <label
                  >说明<textarea
                    v-model="form.description"
                    maxlength="2000"
                    rows="4"
                    @input="clearFieldError('description')"
                  ></textarea>
                  <span v-if="fieldErrors.description" class="field-error">{{
                    fieldErrors.description
                  }}</span>
                </label>
                <label
                  >身份模式<select
                    v-model="form.identityMode"
                    @change="clearFieldError('identityMode')"
                  >
                    <option value="anonymous">匿名</option>
                    <option value="identified">实名</option>
                  </select>
                  <span v-if="fieldErrors.identityMode" class="field-error">{{
                    fieldErrors.identityMode
                  }}</span></label
                >
                <label class="check-row"
                  ><input
                    v-model="form.allowMultipleSubmissions"
                    type="checkbox"
                    @change="clearFieldError('allowMultipleSubmissions')"
                  />允许同一用户重复提交</label
                >
                <span
                  v-if="fieldErrors.allowMultipleSubmissions"
                  class="field-error"
                  >{{ fieldErrors.allowMultipleSubmissions }}</span
                >
                <DeadlineInput
                  v-model="form.deadline"
                  :error="fieldErrors.deadline"
                  @change="clearFieldError('deadline')"
                  @validity="deadlineInputValid = $event"
                />
                <div class="save-row">
                  <span :class="dirty ? 'unsaved' : 'muted'">{{
                    dirty
                      ? "有未保存内容"
                      : savedAt
                        ? `已保存：${savedAt}`
                        : `revision ${selectedVersion.revision}`
                  }}</span
                  ><button
                    class="primary"
                    :disabled="!dirty || writing || !deadlineInputValid"
                  >
                    保存设置
                  </button>
                </div>
              </form>
              <QuestionEditor
                v-if="selectedVersion.status === 'draft'"
                id="question-editor"
                :survey-id="selectedSurvey.id"
                :version="selectedVersion"
                :busy="writing"
                @updated="updateQuestionVersion"
                @busy="writing = $event"
                @dirty="questionsDirty = $event"
                @failure="showQuestionError"
                @navigation="questionNavigation = $event"
              />
              <JumpRuleEditor
                v-if="selectedVersion.status === 'draft'"
                id="jump-editor"
                :survey-id="selectedSurvey.id"
                :version="selectedVersion"
                :busy="writing"
                :questions-dirty="questionsDirty"
                :settings-dirty="dirty"
                @updated="updateQuestionVersion"
                @busy="writing = $event"
                @dirty="rulesDirty = $event"
                @failure="showQuestionError"
                @checked="handlePublishCheck"
              />
              <section
                v-if="selectedVersion.status === 'draft'"
                id="publish-action"
                class="settings-card publish-action-card"
              >
                <div>
                  <h3>发布草稿</h3>
                  <p class="muted">
                    请先在上方完成“检查能否发布”；服务器会在事务内再次执行同一检查。
                  </p>
                </div>
                <div class="publish-action-buttons">
                  <button
                    v-if="previewAvailable"
                    class="secondary"
                    type="button"
                    :disabled="writing"
                    @click="showingPreview = true"
                  >
                    预览发布效果
                  </button>
                  <button
                    class="primary"
                    type="button"
                    :disabled="writing || hasUnsaved"
                    @click="publishSelected(false)"
                  >
                    发布当前草稿
                  </button>
                </div>
                <p v-if="publishError" class="field-error">
                  {{ publishError }}
                </p>
              </section>
              <section
                v-if="
                  selectedVersion.status === 'draft' &&
                  showingPreview &&
                  previewAvailable
                "
                class="draft-preview-shell"
              >
                <div class="draft-preview-toolbar">
                  <div>
                    <strong>发布效果预览</strong>
                    <span class="muted">
                      基于 revision {{ publishCheck?.revision }}
                    </span>
                  </div>
                  <button
                    class="secondary compact"
                    type="button"
                    @click="showingPreview = false"
                  >
                    返回编辑
                  </button>
                </div>
                <PublishedVersionView :version="selectedVersion" preview />
              </section>
              <PublishedVersionView
                v-if="selectedVersion.status === 'published'"
                :version="selectedVersion"
              />
              <StatisticsView
                v-if="selectedVersion.status === 'published'"
                :survey-id="selectedSurvey.id"
                :version-id="selectedVersion.id"
                @failure="showError"
              />
            </div>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>
