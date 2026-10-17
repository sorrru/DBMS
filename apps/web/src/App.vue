<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  ApiClientError,
  currentUser,
  login,
  logout,
  register,
  type PublicUser,
} from "./auth";
import { fetchHealth, type HealthResponse } from "./health";

type Mode = "login" | "register";
const mode = ref<Mode>("login");
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const user = ref<PublicUser>();
const health = ref<HealthResponse>();
const loading = ref(true);
const submitting = ref(false);
const message = ref("");

function showError(error: unknown): void {
  message.value =
    error instanceof ApiClientError || error instanceof Error
      ? error.message
      : "操作失败，请稍后重试";
}

async function submit(): Promise<void> {
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
  } catch (error) {
    password.value = "";
    confirmPassword.value = "";
    showError(error);
  } finally {
    submitting.value = false;
  }
}

async function signOut(): Promise<void> {
  try {
    await logout();
  } catch (error) {
    showError(error);
    return;
  }
  user.value = undefined;
  mode.value = "login";
}

function switchMode(next: Mode): void {
  mode.value = next;
  password.value = "";
  confirmPassword.value = "";
  message.value = "";
}

onMounted(async () => {
  const [healthResult, userResult] = await Promise.allSettled([
    fetchHealth(),
    currentUser(),
  ]);
  if (healthResult.status === "fulfilled") health.value = healthResult.value;
  if (userResult.status === "fulfilled") user.value = userResult.value.user;
  else if (
    !(userResult.reason instanceof ApiClientError) ||
    !["AUTH_REQUIRED", "AUTH_INVALID"].includes(userResult.reason.code)
  )
    showError(userResult.reason);
  loading.value = false;
});
</script>

<template>
  <main class="page-shell">
    <section class="brand-panel">
      <p class="eyebrow">数据库系统大作业一</p>
      <h1>版本化问卷系统</h1>
      <p class="lead">
        登录后创建和管理问卷。每次发布都会保留独立版本，让问题与回答始终对应。
      </p>
      <div class="service-line">
        <span
          class="status-dot"
          :data-state="health?.services.database ?? 'unknown'"
        ></span>
        <span
          >数据库
          {{
            health?.services.database === "connected" ? "已连接" : "状态待确认"
          }}</span
        >
      </div>
    </section>

    <section class="auth-panel" aria-live="polite">
      <p v-if="loading" class="muted">正在恢复登录状态…</p>
      <template v-else-if="user">
        <p class="eyebrow">当前账号</p>
        <h2>你好，{{ user.username }}</h2>
        <p class="muted">
          注册于 {{ new Date(user.registeredAt).toLocaleString("zh-CN") }}
        </p>
        <div class="success-card">
          身份认证已经完成。问卷工作台将在下一个里程碑加入。
        </div>
        <button class="secondary" type="button" @click="signOut">
          退出登录
        </button>
      </template>
      <template v-else>
        <div class="mode-tabs" role="tablist">
          <button
            type="button"
            :class="{ active: mode === 'login' }"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            :class="{ active: mode === 'register' }"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>
        <h2>{{ mode === "login" ? "欢迎回来" : "创建账号" }}</h2>
        <form @submit.prevent="submit">
          <label
            >用户名<input
              v-model="username"
              autocomplete="username"
              maxlength="20"
              required
              placeholder="英文、数字或下划线"
          /></label>
          <label
            >密码<input
              v-model="password"
              type="password"
              :autocomplete="
                mode === 'login' ? 'current-password' : 'new-password'
              "
              maxlength="128"
              required
              placeholder="至少 10 位，包含字母和数字"
          /></label>
          <label v-if="mode === 'register'"
            >确认密码<input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              maxlength="128"
              required
          /></label>
          <p v-if="message" class="error" role="alert">{{ message }}</p>
          <button class="primary" type="submit" :disabled="submitting">
            {{
              submitting ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"
            }}
          </button>
        </form>
      </template>
    </section>
  </main>
</template>
