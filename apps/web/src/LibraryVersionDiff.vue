<script setup lang="ts">
import { computed } from "vue";
import {
  describeLibraryValidation,
  type LibraryDefinition,
  type EditableLibraryDefinition,
} from "./library";
const props = defineProps<{
  baseline: LibraryDefinition;
  candidate: EditableLibraryDefinition;
}>();
const changes = computed(() => {
  const items: Array<{ label: string; before: string; after: string }> = [];
  for (const [key, label] of [
    ["title", "标题"],
    ["required", "必答"],
    ["validation", "校验规则"],
    ["options", "选项"],
  ] as const) {
    const show = (value: unknown) =>
      key === "options"
        ? (value as Array<{ text: string }>)
            .map((o, i) => `${i + 1}. ${o.text}`)
            .join("；")
        : key === "validation"
          ? describeLibraryValidation(
              props.baseline.type,
              value as Record<string, unknown>,
            )
          : key === "required"
            ? value
              ? "必答"
              : "非必答"
            : String(value);
    const before = show(props.baseline[key]),
      after = show(props.candidate[key]);
    if (
      before !== after ||
      (key === "options" &&
        JSON.stringify(props.baseline.options.map((o) => o.optionId)) !==
          JSON.stringify(props.candidate.options.map((o) => o.optionId)))
    )
      items.push({
        label,
        before,
        after: before === after ? `${after}（选项身份有变化）` : after,
      });
  }
  return items;
});
</script>
<template>
  <section aria-label="版本差异">
    <h4>版本差异</h4>
    <p v-if="!changes.length" class="muted">与来源版本内容相同。</p>
    <dl
      v-for="change in changes"
      :key="change.label"
      class="library-difference"
    >
      <dt>{{ change.label }}</dt>
      <dd><strong>原内容：</strong>{{ change.before }}</dd>
      <dd><strong>新内容：</strong>{{ change.after }}</dd>
    </dl>
  </section>
</template>

<style scoped>
dd {
  margin: 0.4rem 0 0.4rem 1rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.library-difference {
  padding-bottom: 0.6rem;
}
</style>
