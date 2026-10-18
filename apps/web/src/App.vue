<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  ApiClientError,
  currentUser,
  login,
  logout,
  register,
  type PublicUser,
} from "./auth";
import DeadlineInput from "./DeadlineInput.vue";
import { fetchHealth, type HealthResponse } from "./health";
import {
  changedDraftFields,
  clearSettingsDraft,
  createSurvey,
  findSettingsDraft,
  getVersion,
  listSurveys,
  patchDraft,
  renameSurvey,
  saveSettingsDraft,
  type DraftFields,
  type StoredDraft,
  type SurveySummary,
  type SurveyVersion,
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
const message = ref("");
const surveys = ref<SurveySummary[]>([]);
const nextCursor = ref<string | null>(null);
const newSurveyName = ref("");
const page = ref<"list" | "edit">("list");
const selectedSurvey = ref<SurveySummary>();
const selectedVersion = ref<SurveyVersion>();
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

const changed = computed(() =>
  original.value ? changedDraftFields(original.value, form) : {},
);
const dirty = computed(() => Object.keys(changed.value).length > 0);
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
  if (!survey.draftVersion) return;
  try {
    const result = await getVersion(survey.id, survey.draftVersion.id);
    selectedSurvey.value = survey;
    selectedVersion.value = result.version;
    internalName.value = survey.internalName;
    original.value = fieldsOf(result.version);
    assignForm(original.value);
    recovery.value = findSettingsDraft(survey.id, result.version.id);
    page.value = "edit";
    Object.keys(fieldErrors).forEach((field) => delete fieldErrors[field]);
    message.value = "";
    savedAt.value = "";
  } catch (error) {
    showError(error);
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
  submitting.value = true;
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
    submitting.value = false;
  }
}

function backToList(): void {
  if (dirty.value && !window.confirm("仍有未保存的设置，确定离开吗？")) return;
  page.value = "list";
  selectedSurvey.value = undefined;
  selectedVersion.value = undefined;
  original.value = undefined;
  recovery.value = undefined;
  Object.keys(fieldErrors).forEach((field) => delete fieldErrors[field]);
  message.value = "";
}

async function signOut(): Promise<void> {
  if (dirty.value && !window.confirm("仍有未保存的设置，确定退出吗？")) return;
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
  if (dirty.value) event.preventDefault();
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
          <h2>{{ page === "list" ? "我的问卷" : "基础设置" }}</h2>
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
                >{{ survey.draftVersion?.title }} · v{{
                  survey.draftVersion?.versionNumber
                }}
                草稿</small
              ></span
            ><span>编辑 →</span>
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
          <form class="settings-card" @submit.prevent="saveName">
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
              :disabled="internalName === selectedSurvey.internalName"
            >
              保存管理名称
            </button>
          </form>
          <form class="settings-card" @submit.prevent="saveDraft">
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
                :disabled="!dirty || submitting || !deadlineInputValid"
              >
                保存设置
              </button>
            </div>
          </form>
        </div>
      </template>
    </section>
  </main>
</template>
