<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  connectionLabel,
  fetchHealth,
  type ConnectionState,
  type HealthResponse,
} from "./health";

const health = ref<HealthResponse>();
const errorMessage = ref("");
const loading = ref(true);
let refreshTimer: number | undefined;

const apiState = computed<ConnectionState>(
  () => health.value?.services.api ?? "unknown",
);
const databaseState = computed<ConnectionState>(
  () => health.value?.services.database ?? "unknown",
);

async function refreshHealth(): Promise<void> {
  try {
    health.value = await fetchHealth();
    errorMessage.value = "";
  } catch (error) {
    health.value = undefined;
    errorMessage.value =
      error instanceof Error ? error.message : "无法连接后端";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refreshHealth();
  refreshTimer = window.setInterval(() => void refreshHealth(), 10_000);
});

onBeforeUnmount(() => {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
});
</script>

<template>
  <main class="page-shell">
    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">数据库系统大作业一</p>
      <h1 id="page-title">版本化问卷系统</h1>
      <p>
        第一阶段开发环境已经建立。本页面只显示基础服务状态，账号与问卷功能将在后续阶段逐步加入。
      </p>
    </section>

    <section class="status-panel" aria-labelledby="status-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">开发环境</p>
          <h2 id="status-title">服务连接状态</h2>
        </div>
        <button type="button" :disabled="loading" @click="refreshHealth">
          {{ loading ? "检查中" : "重新检查" }}
        </button>
      </div>

      <div class="status-grid">
        <article class="status-card">
          <span
            class="status-dot"
            :data-state="apiState"
            aria-hidden="true"
          ></span>
          <div>
            <h3>Express API</h3>
            <p>{{ connectionLabel(apiState) }}</p>
          </div>
        </article>

        <article class="status-card">
          <span
            class="status-dot"
            :data-state="databaseState"
            aria-hidden="true"
          ></span>
          <div>
            <h3>MongoDB</h3>
            <p>{{ connectionLabel(databaseState) }}</p>
          </div>
        </article>
      </div>

      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
      <p v-else-if="health" class="checked-at">
        最后检查：{{ new Date(health.timestamp).toLocaleString("zh-CN") }}
      </p>
    </section>
  </main>
</template>
