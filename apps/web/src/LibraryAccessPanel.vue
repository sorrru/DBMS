<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  grantLibraryVersions,
  listLibraryGrants,
  revokeLibraryGrant,
  listOwnLibraryUsages,
  listOtherLibraryUsages,
  type LibraryVersionView,
  type LibraryGrant,
  type LibraryOwnUsage,
  type LibraryOtherUsage,
} from "./library";
const props = defineProps<{
  libraryQuestionId: string;
  version: LibraryVersionView;
  isOwner: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{
  failure: [error: unknown];
  locate: [usage: LibraryOwnUsage];
}>();
const busy = ref(false),
  error = ref(""),
  notice = ref(""),
  usernames = ref("");
const grants = ref<LibraryGrant[]>([]),
  grantsCursor = ref<string | null>(null),
  own = ref<LibraryOwnUsage[]>([]),
  ownCursor = ref<string | null>(null),
  other = ref<LibraryOtherUsage[]>([]),
  otherCursor = ref<string | null>(null);
async function run(task: () => Promise<void>) {
  busy.value = true;
  error.value = "";
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
    emit("failure", e);
  } finally {
    busy.value = false;
  }
}
async function loadGrants(more = false) {
  const data = await listLibraryGrants(
    props.libraryQuestionId,
    more ? (grantsCursor.value ?? undefined) : undefined,
  );
  grants.value = more ? [...grants.value, ...data.items] : data.items;
  grantsCursor.value = data.nextCursor;
}
async function loadOwn(more = false) {
  const data = await listOwnLibraryUsages(
    props.libraryQuestionId,
    more ? (ownCursor.value ?? undefined) : undefined,
  );
  own.value = more ? [...own.value, ...data.items] : data.items;
  ownCursor.value = data.nextCursor;
}
async function loadOther(more = false) {
  const data = await listOtherLibraryUsages(
    props.libraryQuestionId,
    more ? (otherCursor.value ?? undefined) : undefined,
  );
  other.value = more ? [...other.value, ...data.items] : data.items;
  otherCursor.value = data.nextCursor;
}
async function refresh() {
  await loadOwn();
  if (props.isOwner) await Promise.all([loadGrants(), loadOther()]);
}
async function share() {
  await run(async () => {
    await grantLibraryVersions(
      props.libraryQuestionId,
      usernames.value.split(/[\s,，;；]+/).filter(Boolean),
      [props.version.questionVersionId],
    );
    notice.value =
      "共享请求已受理。请在授权列表核对已建立的权限；新版本不会自动共享。";
    await loadGrants();
  });
}
async function revoke(g: LibraryGrant) {
  if (
    !window.confirm(
      `撤销 ${g.username} 使用 v${g.versionNumber} 的授权？已有问卷快照继续有效。`,
    )
  )
    return;
  await run(async () => {
    await revokeLibraryGrant(props.libraryQuestionId, g.shareId);
    await loadGrants();
    notice.value = "已撤销该版本授权，已有问卷不受影响。";
  });
}
onMounted(() => run(refresh));
</script>
<template>
  <section class="library-access" :aria-busy="busy">
    <h4>共享与使用情况</h4>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <button
      type="button"
      class="secondary compact"
      :disabled="busy || disabled"
      @click="run(refresh)"
    >
      刷新授权与使用
    </button>
    <template v-if="isOwner">
      <form @submit.prevent="share">
        <fieldset :disabled="busy || disabled" class="access-fields">
          <legend>共享当前版本 v{{ version.versionNumber }}</legend>
          <label
            >用户名 最多 50 个<textarea
              v-model="usernames"
              rows="2"
              required
              placeholder="用空格、逗号或换行分隔"
            ></textarea>
          </label>
          <p class="muted">
            仅共享当前版本。接收者可选入或另存，不能修改或转授原题。统一受理结果不代表每个用户名都存在。
          </p>
          <button class="primary compact">共享当前版本</button>
        </fieldset>
      </form>
      <h5>已建立的授权</h5>
      <p v-if="!grants.length" class="muted">暂无授权。</p>
      <div v-for="g in grants" :key="g.shareId" class="access-row">
        <span>{{ g.username }} · v{{ g.versionNumber }}</span
        ><button
          type="button"
          class="secondary compact"
          :disabled="busy || disabled"
          @click="revoke(g)"
        >
          撤销
        </button>
      </div>
      <button
        v-if="grantsCursor"
        type="button"
        class="secondary compact"
        :disabled="busy || disabled"
        @click="run(() => loadGrants(true))"
      >
        更多授权
      </button>
    </template>
    <h5>自己问卷中的使用</h5>
    <p class="muted">按实例计数，同一问卷的多个版本分别列出。</p>
    <p v-if="!own.length" class="muted">暂无自己的引用。</p>
    <div v-for="(u, i) in own" :key="i" class="access-row">
      <span
        >{{ u.internalName }} · 问卷 v{{ u.surveyVersionNumber }} · 题目 v{{
          u.questionVersionNumber
        }}
        · {{ u.status === "draft" ? "草稿" : "已发布" }}</span
      ><button
        type="button"
        class="secondary compact"
        :disabled="busy || disabled"
        @click="emit('locate', u)"
      >
        打开定位
      </button>
    </div>
    <button
      v-if="ownCursor"
      type="button"
      class="secondary compact"
      :disabled="busy || disabled"
      @click="run(() => loadOwn(true))"
    >
      更多自己的引用
    </button>
    <template v-if="isOwner"
      ><h5>他人使用汇总</h5>
      <p class="muted">
        仅显示用户名、题目版本、实例数量与状态，不提供问卷名称或回答。
      </p>
      <p v-if="!other.length" class="muted">暂无他人引用。</p>
      <p v-for="(u, i) in other" :key="i">
        {{ u.username }} · v{{ u.versionNumber }} ·
        {{ u.status === "draft" ? "草稿" : "已发布" }} · {{ u.count }} 次
      </p>
      <button
        v-if="otherCursor"
        type="button"
        class="secondary compact"
        :disabled="busy || disabled"
        @click="run(() => loadOther(true))"
      >
        更多他人汇总
      </button></template
    >
  </section>
</template>
<style scoped>
.library-access {
  border-top: 1px solid #dce5ed;
  margin-top: 1.5rem;
  padding-top: 1rem;
  display: grid;
  gap: 0.75rem;
}
.library-access h4,
.library-access h5,
.library-access p {
  margin: 0;
}
.access-fields {
  border: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.access-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}
.access-row span {
  overflow-wrap: anywhere;
  min-width: 0;
}
</style>
