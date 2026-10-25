<script setup lang="ts">
import { computed, ref, watch } from "vue";
import LibraryVersionDiff from "./LibraryVersionDiff.vue";
import {
  libraryStatisticsCatalog,
  queryLibraryStatistics,
  type StatisticsCatalog,
  type LibraryStatisticsResult,
  type StatisticsInput,
} from "./library-statistics";
const props = defineProps<{
  libraryQuestionId: string;
  disabled?: boolean;
  questionTitle?: string;
}>();
const emit = defineEmits<{ failure: [error: unknown] }>();
const opened = ref(false),
  busy = ref(false),
  error = ref(""),
  catalog = ref<StatisticsCatalog | null>(null),
  selectedIds = ref<string[]>([]),
  merge = ref(false),
  confirmed = ref(false),
  boundaries = ref("0,18,30,45,60,120"),
  result = ref<LibraryStatisticsResult | null>(null);
const selected = computed(
  () =>
    catalog.value?.versions.filter((v) =>
      selectedIds.value.includes(v.questionVersionId),
    ) ?? [],
);
const numeric = computed(() => selected.value[0]?.definition.type === "number");
watch(
  [selectedIds, merge, boundaries],
  () => {
    confirmed.value = false;
    result.value = null;
  },
  { deep: true },
);
watch(
  () => props.libraryQuestionId,
  () => {
    opened.value = false;
    catalog.value = null;
    result.value = null;
    selectedIds.value = [];
  },
);
async function run(work: () => Promise<void>) {
  busy.value = true;
  error.value = "";
  try {
    await work();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "统计失败";
    emit("failure", e);
  } finally {
    busy.value = false;
  }
}
async function load() {
  result.value = null;
  catalog.value = await libraryStatisticsCatalog(props.libraryQuestionId);
  selectedIds.value = catalog.value.versions
    .map((v) => v.questionVersionId)
    .slice(0, 50);
}
async function toggle() {
  opened.value = !opened.value;
  if (opened.value && !catalog.value) await run(load);
}
function input(): StatisticsInput {
  const parsed = boundaries.value
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(Number);
  if (
    numeric.value &&
    (parsed.length < 2 ||
      parsed.length > 31 ||
      parsed.some(
        (v, i) => !Number.isFinite(v) || (i > 0 && v <= parsed[i - 1]!),
      ))
  )
    throw Error("分桶边界需为 2–31 个严格递增的有限数字");
  return {
    questionVersionIds: [...selectedIds.value],
    merge: merge.value,
    confirmMerge: confirmed.value,
    boundaries: numeric.value ? parsed : [0, 18, 30, 45, 60, 120],
    limit: 20,
  };
}
async function query(more = false) {
  const previous = result.value,
    request = input();
  if (more && previous?.text?.nextCursor)
    request.cursor = previous.text.nextCursor;
  const data = await queryLibraryStatistics(props.libraryQuestionId, request);
  if (more && data.text && previous?.text)
    data.text.items = [...previous.text.items, ...data.text.items];
  result.value = data;
}
const groupName = (ids: string[]) =>
  ids
    .map(
      (id) =>
        `v${catalog.value?.versions.find((v) => v.questionVersionId === id)?.versionNumber ?? "?"}`,
    )
    .join("、");
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
</script>
<template>
  <section class="library-statistics" :aria-busy="busy">
    <button
      type="button"
      class="secondary compact"
      :aria-expanded="opened"
      :disabled="busy || disabled"
      @click="toggle"
    >
      {{ questionTitle ? `${questionTitle} · ` : ""
      }}{{ opened ? "收起跨问卷统计" : "跨问卷统计" }}
    </button>
    <div v-if="opened" class="statistics-body">
      <h4>自己问卷中的单题统计</h4>
      <p class="muted">
        仅统计自己已发布问卷（含历史版本）的已提交回答；共享权限不提供他人的回答。按题目实例计数，同一提交中的重复题目分别计入，不代表人数。草稿不计入。
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button
        type="button"
        class="secondary compact"
        :disabled="busy || disabled"
        @click="run(load)"
      >
        刷新统计来源
      </button>
      <template v-if="catalog">
        <p v-if="!catalog.versions.length">
          暂无自己已发布问卷的使用记录。请先选入问卷并发布。
        </p>
        <fieldset v-else :disabled="busy || disabled">
          <legend>选择题目版本（最多 50 个，默认分版本统计）</legend>
          <label
            v-for="v in catalog.versions"
            :key="v.questionVersionId"
            class="version-check"
            ><input
              v-model="selectedIds"
              type="checkbox"
              :value="v.questionVersionId"
            />v{{ v.versionNumber }} · {{ v.definition.title }} ·
            {{ v.sourceCount }} 个实例 / {{ v.surveyCount }} 份问卷</label
          >
          <label class="version-check"
            ><input v-model="merge" type="checkbox" />合并所选版本</label
          >
          <template v-if="merge && selected.length > 1">
            <p>
              先核对下面的版本差异。相同选项 ID
              合并计数，文字变化也会保留显示；不同含义的版本应分别统计。
            </p>
            <LibraryVersionDiff
              v-for="candidate in selected.slice(1)"
              :key="candidate.questionVersionId"
              :baseline="selected[0]!.definition"
              :candidate="candidate.definition"
            />
            <label class="version-check"
              ><input
                v-model="confirmed"
                type="checkbox"
              />我已核对差异，确认合并这些版本</label
            >
          </template>
          <label v-if="numeric"
            >数字分桶边界<input
              v-model="boundaries"
              placeholder="0,18,30,45,60,120"
            /><small
              >逗号分隔；区间左闭右开，并单列低于首边界、达到末边界的回答。</small
            ></label
          >
          <button
            type="button"
            class="primary compact"
            :disabled="
              !selectedIds.length ||
              selectedIds.length > 50 ||
              (merge && selected.length > 1 && !confirmed)
            "
            @click="run(() => query())"
          >
            查看统计
          </button>
        </fieldset>
      </template>
      <template v-if="result">
        <article
          v-for="g in result.groups"
          :key="g.groupId"
          class="result-group"
        >
          <h5>
            {{ result.merged ? "合并统计：" : ""
            }}{{ groupName(g.questionVersionIds) }}
          </h5>
          <p>
            {{ g.surveyCount }} 份问卷 · {{ g.sourceCount }} 个题目实例 ·
            {{ g.opportunityCount }} 次答题机会
          </p>
          <p>
            已答 {{ g.answeredCount }} · 到达未答
            {{ g.unansweredReachedCount }} · 未到达 {{ g.notReachedCount }}
          </p>
          <p>
            到达率 {{ percent(g.reachRate) }}（到达 / 答题机会）；回答率
            {{ percent(g.answerRate) }}（已答 / 到达）
          </p>
          <table v-if="g.options.length">
            <thead>
              <tr>
                <th>选项</th>
                <th>次数</th>
                <th>占已答比例</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in g.options" :key="o.optionId">
                <td>{{ o.labels.join(" / ") }}</td>
                <td>{{ o.count }}</td>
                <td>{{ percent(o.percentageOfAnswered) }}</td>
              </tr>
            </tbody>
          </table>
          <template v-if="g.number"
            ><p>
              有效数值 {{ g.number.count }} · 总和 {{ g.number.sum }} · 平均
              {{ g.number.average ?? "无" }} · 最小
              {{ g.number.minimum ?? "无" }} · 最大
              {{ g.number.maximum ?? "无" }}
            </p>
            <table>
              <thead>
                <tr>
                  <th>区间</th>
                  <th>次数</th>
                  <th>分布</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(b, i) in g.number.buckets" :key="i">
                  <td>
                    {{
                      b.lower === null
                        ? `小于 ${b.upper}`
                        : b.upper === null
                          ? `大于等于 ${b.lower}`
                          : `[${b.lower}, ${b.upper})`
                    }}
                  </td>
                  <td>{{ b.count }}</td>
                  <td>
                    <meter
                      :value="b.count"
                      :max="Math.max(1, g.number.count)"
                      :aria-label="`区间回答 ${b.count} 次`"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </article>
        <section v-if="result.text">
          <h5>文本回答</h5>
          <p class="muted">
            仅显示内容、题目版本及 UTC 日期，不显示账号、响应 ID 或精确时间。
          </p>
          <p v-if="!result.text.items.length">暂无文本回答。</p>
          <p v-for="(row, i) in result.text.items" :key="i">
            {{ groupName([row.questionVersionId]) }} · {{ row.submittedDate }} ·
            {{ row.value }}
          </p>
          <button
            v-if="result.text.nextCursor"
            type="button"
            class="secondary compact"
            :disabled="busy || disabled"
            @click="run(() => query(true))"
          >
            更多文本回答
          </button>
        </section>
      </template>
    </div>
  </section>
</template>
<style scoped>
.library-statistics {
  margin-top: 1rem;
}
.statistics-body {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 0;
  overflow-wrap: anywhere;
}
.statistics-body p,
.statistics-body h4,
.statistics-body h5 {
  margin: 0;
}
fieldset {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.version-check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.version-check input {
  width: auto;
}
.result-group {
  display: grid;
  gap: 0.5rem;
  border-top: 1px solid #dce5ed;
  padding-top: 1rem;
}
table {
  width: 100%;
  text-align: left;
  border-collapse: collapse;
}
th,
td {
  padding: 0.4rem;
  border-bottom: 1px solid #dce5ed;
}
</style>
