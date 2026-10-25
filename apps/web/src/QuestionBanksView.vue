<script setup lang="ts">
import { onMounted, ref } from "vue";
import LibraryQuestionPicker from "./LibraryQuestionPicker.vue";
import LibraryVersionDiff from "./LibraryVersionDiff.vue";
import { getLibraryVersion, type LibraryVersionView } from "./library";
import {
  listBanks,
  createBank,
  renameBank,
  deleteBank,
  listBankItems,
  saveBankItem,
  removeBankItem,
  type Bank,
  type BankItem,
} from "./banks";
const emit = defineEmits<{
  failure: [error: unknown];
  busy: [value: boolean];
}>();
const banks = ref<Bank[]>([]),
  cursor = ref<string | null>(null),
  selected = ref<Bank | null>(null),
  items = ref<BankItem[]>([]),
  itemCursor = ref<string | null>(null);
const name = ref(""),
  newName = ref(""),
  busy = ref(false),
  message = ref(""),
  adding = ref(false),
  editing = ref<BankItem | null>(null),
  candidate = ref<LibraryVersionView | null>(null),
  policy = ref<"latest" | "pinned">("latest"),
  deleting = ref(false);
async function run(task: () => Promise<void>) {
  busy.value = true;
  emit("busy", true);
  message.value = "";
  try {
    await task();
  } catch (e) {
    message.value = e instanceof Error ? e.message : "操作失败";
    emit("failure", e);
  } finally {
    busy.value = false;
    emit("busy", false);
  }
}
async function load(more = false) {
  const page = await listBanks(more ? (cursor.value ?? undefined) : undefined);
  banks.value = more ? [...banks.value, ...page.items] : page.items;
  cursor.value = page.nextCursor;
}
function closeEditor() {
  adding.value = false;
  editing.value = null;
  candidate.value = null;
  deleting.value = false;
}
async function open(bank: Bank, more = false) {
  const page = await listBankItems(
    bank.bankId,
    more ? (itemCursor.value ?? undefined) : undefined,
  );
  selected.value = page.bank;
  name.value = page.bank.name;
  items.value = more ? [...items.value, ...page.items] : page.items;
  itemCursor.value = page.nextCursor;
  if (!more) closeEditor();
}
async function addBank() {
  const bank = await createBank(newName.value);
  newName.value = "";
  await load();
  await open(bank);
}
async function changeName() {
  if (!selected.value) return;
  const bank = await renameBank(selected.value, name.value);
  await load();
  selected.value = bank;
}
async function removeBank() {
  if (!selected.value) return;
  await deleteBank(selected.value);
  selected.value = null;
  items.value = [];
  closeEditor();
  await load();
}
function choose(v: LibraryVersionView) {
  candidate.value = v;
  policy.value = "pinned";
  adding.value = false;
}
async function update(item: BankItem) {
  closeEditor();
  editing.value = item;
  policy.value = item.versionPolicy;
  candidate.value = (await getLibraryVersion(item.libraryQuestionId)).version;
}
async function changePolicy() {
  if (policy.value !== "latest" || !candidate.value) return;
  try {
    candidate.value = (
      await getLibraryVersion(candidate.value.libraryQuestionId)
    ).version;
  } catch (e) {
    policy.value = "pinned";
    throw e;
  }
}
async function save() {
  if (!selected.value || !candidate.value) return;
  await saveBankItem(
    selected.value.bankId,
    candidate.value.libraryQuestionId,
    policy.value,
    candidate.value.questionVersionId,
    editing.value ?? undefined,
  );
  await open(selected.value);
}
async function remove(item: BankItem) {
  if (!selected.value) return;
  await removeBankItem(selected.value.bankId, item);
  await open(selected.value);
}
onMounted(() => run(() => load()));
</script>
<template>
  <section class="banks" :aria-busy="busy">
    <p class="muted">
      题库用来分类常用题目，同一题目可以放入多个题库。题库的更新不影响已有问卷。
    </p>
    <p v-if="message" class="error" role="alert">{{ message }}</p>
    <form class="bank-actions" @submit.prevent="run(addBank)">
      <label
        >新题库名称<input
          v-model="newName"
          required
          maxlength="80"
          :disabled="busy" /></label
      ><button class="primary compact" :disabled="busy">创建题库</button>
    </form>
    <label
      >选择题库<select
        :value="selected?.bankId ?? ''"
        :disabled="busy"
        @change="
          run(async () => {
            const bank = banks.find(
              (b) => b.bankId === ($event.target as HTMLSelectElement).value,
            );
            if (bank) await open(bank);
          })
        "
      >
        <option value="" disabled>请选择题库</option>
        <option v-for="bank in banks" :key="bank.bankId" :value="bank.bankId">
          {{ bank.name }}
        </option>
      </select></label
    >
    <button
      v-if="cursor"
      class="secondary compact"
      :disabled="busy"
      @click="run(() => load(true))"
    >
      更多题库
    </button>
    <template v-if="selected">
      <form class="bank-actions" @submit.prevent="run(changeName)">
        <label
          >题库名称<input
            v-model="name"
            required
            maxlength="80"
            :disabled="busy" /></label
        ><button class="secondary compact" :disabled="busy">保存名称</button
        ><button
          type="button"
          class="secondary compact"
          :disabled="busy"
          @click="deleting = !deleting"
        >
          删除题库
        </button>
      </form>
      <div v-if="deleting">
        <p>只删除这个分类，不删除常用题目和问卷。</p>
        <button
          class="secondary compact"
          :disabled="busy"
          @click="run(removeBank)"
        >
          确认删除题库
        </button>
      </div>
      <div class="bank-actions">
        <button
          class="primary compact"
          :disabled="busy"
          @click="
            closeEditor();
            policy = 'latest';
            adding = true;
          "
        >
          加入题目</button
        ><button
          class="secondary compact"
          :disabled="busy"
          @click="run(() => open(selected!))"
        >
          刷新题库
        </button>
      </div>
      <article v-for="item in items" :key="item.itemId" class="bank-item">
        <strong>{{
          item.version?.definition.title ??
          "题目不可用（授权已撤销或版本不可访问）"
        }}</strong>
        <p>
          {{ item.versionPolicy === "latest" ? "跟随最新可用版本" : "固定版本"
          }}<template v-if="item.version">
            · v{{ item.version.versionNumber }}</template
          >
        </p>
        <p v-if="item.version && !item.version.frozenAt" class="muted">
          此版本尚未冻结，内容仍可被所有者原地修改；固定版本只固定版本编号。
        </p>
        <div class="bank-actions">
          <button
            v-if="item.available"
            class="secondary compact"
            :disabled="busy"
            @click="run(() => update(item))"
          >
            更新到新版本 / 设置策略</button
          ><button
            class="secondary compact"
            :disabled="busy"
            @click="run(() => remove(item))"
          >
            移出题库
          </button>
        </div>
      </article>
      <p v-if="!items.length">题库中暂无题目。</p>
      <button
        v-if="itemCursor"
        class="secondary compact"
        :disabled="busy"
        @click="run(() => open(selected!, true))"
      >
        更多成员
      </button>
      <LibraryQuestionPicker
        v-if="adding"
        :busy="busy"
        :hide-banks="true"
        @select="choose"
        @cancel="closeEditor"
        @failure="emit('failure', $event)"
      />
      <section v-if="candidate" class="bank-item">
        <h3>{{ editing ? "预览成员更新" : "确认加入题库" }}</h3>
        <p>{{ candidate.definition.title }} · v{{ candidate.versionNumber }}</p>
        <label
          >版本策略<select
            v-model="policy"
            :disabled="busy"
            @change="run(changePolicy)"
          >
            <option value="latest">跟随最新可用版本</option>
            <option value="pinned">固定到所选版本</option>
          </select></label
        >
        <p class="muted">
          跟随最新会在下次打开或刷新时解析最新的可用版本；固定版本需主动更新。两种策略均不改变已有问卷。
        </p>
        <p v-if="!candidate.frozenAt" class="muted">
          尚未冻结：固定此版本后，其内容仍可能原地修改。
        </p>
        <LibraryVersionDiff
          v-if="editing?.version"
          :baseline="editing.version.definition"
          :candidate="candidate.definition"
        />
        <LibraryQuestionPicker
          v-if="editing"
          :busy="busy"
          :library-question-id="editing.libraryQuestionId"
          :baseline="editing.version?.definition"
          @select="choose"
          @cancel="closeEditor"
          @failure="emit('failure', $event)"
        />
        <div class="bank-actions">
          <button class="primary compact" :disabled="busy" @click="run(save)">
            确认{{ editing ? "更新" : "加入" }}</button
          ><button
            class="secondary compact"
            :disabled="busy"
            @click="closeEditor"
          >
            取消
          </button>
        </div>
      </section>
    </template>
  </section>
</template>
<style scoped>
.banks {
  display: grid;
  gap: 1rem;
}
.bank-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
}
.bank-item {
  padding: 1rem;
  border: 1px solid #b9cce0;
  border-radius: 0.75rem;
  overflow-wrap: anywhere;
}
</style>
