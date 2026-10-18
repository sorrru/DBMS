<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import {
  composeDeadline,
  splitDeadline,
  stepDeadlinePart,
  TIMEZONE_OPTIONS,
  type DeadlineParts,
} from "./deadline";

const props = defineProps<{
  modelValue: string | null;
  error?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string | null];
  change: [];
  validity: [valid: boolean];
}>();

const parts = reactive<DeadlineParts>(splitDeadline(props.modelValue));
const localError = ref("");

function update(): void {
  emit("change");
  const result = composeDeadline(parts);
  if (result.error) {
    localError.value = result.error;
    emit("validity", false);
    return;
  }
  localError.value = "";
  emit("validity", true);
  emit("update:modelValue", result.value!);
}

function step(
  field: "year" | "minute",
  event: WheelEvent,
  minimum: number,
  maximum: number,
): void {
  parts[field] = stepDeadlinePart(
    parts[field],
    event.deltaY < 0 ? 1 : -1,
    minimum,
    maximum,
  );
  update();
}

watch(
  () => props.modelValue,
  (value) => {
    const next = splitDeadline(value);
    Object.assign(parts, next);
    localError.value = "";
    emit("validity", true);
  },
);
</script>

<template>
  <fieldset class="deadline-fieldset">
    <legend>截止时间</legend>
    <label class="deadline-toggle">
      <input v-model="parts.enabled" type="checkbox" @change="update" />
      设置截止时间
    </label>
    <div class="deadline-parts" :aria-disabled="!parts.enabled">
      <label>
        <span>年</span>
        <input
          v-model="parts.year"
          aria-label="截止年份"
          inputmode="numeric"
          :disabled="!parts.enabled"
          @input="update"
          @wheel.prevent="step('year', $event, 1000, 9999)"
        />
      </label>
      <label>
        <span>月</span>
        <select
          v-model="parts.month"
          aria-label="截止月份"
          :disabled="!parts.enabled"
          @change="update"
        >
          <option v-for="number in 12" :key="number" :value="String(number)">
            {{ number }}
          </option>
        </select>
      </label>
      <label>
        <span>日</span>
        <select
          v-model="parts.day"
          aria-label="截止日期"
          :disabled="!parts.enabled"
          @change="update"
        >
          <option v-for="number in 31" :key="number" :value="String(number)">
            {{ number }}
          </option>
        </select>
      </label>
      <label>
        <span>时</span>
        <select
          v-model="parts.hour"
          aria-label="截止小时"
          :disabled="!parts.enabled"
          @change="update"
        >
          <option
            v-for="number in 24"
            :key="number"
            :value="String(number - 1)"
          >
            {{ String(number - 1).padStart(2, "0") }}
          </option>
        </select>
      </label>
      <label>
        <span>分</span>
        <input
          v-model="parts.minute"
          aria-label="截止分钟"
          inputmode="numeric"
          :disabled="!parts.enabled"
          @input="update"
          @wheel.prevent="step('minute', $event, 0, 59)"
        />
      </label>
      <label class="timezone-part">
        <span>时区</span>
        <select
          v-model="parts.timezone"
          aria-label="截止时区"
          :disabled="!parts.enabled"
          @change="update"
        >
          <option
            v-for="timezone in TIMEZONE_OPTIONS"
            :key="timezone"
            :value="timezone"
          >
            {{ timezone }}
          </option>
        </select>
      </label>
    </div>
    <small v-if="parts.enabled" class="deadline-help">
      年份和分钟可直接输入或用滚轮微调；其余项目使用滚动选择。秒固定为 00。
    </small>
    <span v-if="localError || error" class="field-error" role="alert">
      {{ localError || error }}
    </span>
  </fieldset>
</template>
