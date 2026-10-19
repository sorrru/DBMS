import { randomBytes } from "node:crypto";
import type {
  JumpOperator,
  JumpRule,
  SurveyQuestion,
} from "@survey/survey-logic";
import { validationError } from "../errors/api-error.js";

export interface RawJumpRule {
  ruleId?: string;
  operator: JumpOperator;
  value: string | string[] | number;
  targetQuestionId: string;
}
export interface RawJumpRulesUpdate {
  revision: number;
  rules: RawJumpRule[];
}

const idPattern = /^r_[A-Za-z0-9_-]+$/;
const questionIdPattern = /^q_[A-Za-z0-9_-]+$/;
const operators = new Set<JumpOperator>([
  "equals",
  "contains",
  "containsAll",
  "containsAny",
  "gt",
  "gte",
  "lt",
  "lte",
]);
const fail = (path: string, message = "请求参数不符合要求"): never => {
  throw validationError(path, message);
};

export function parseJumpRulesUpdate(body: unknown): RawJumpRulesUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("body");
  const value = body as Record<string, unknown>;
  const unknown = Object.keys(value).find(
    (key) => key !== "revision" && key !== "rules",
  );
  if (unknown) fail(unknown, "请求包含不允许的字段");
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1)
    fail("revision");
  const rawRules = value.rules;
  if (!Array.isArray(rawRules)) fail("rules");
  const rules = (rawRules as unknown[]).map(
    (candidate: unknown, index: number): RawJumpRule => {
      const path = `rules[${index}]`;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        fail(path);
      const rule = candidate as Record<string, unknown>;
      const extra = Object.keys(rule).find(
        (key) =>
          !["ruleId", "operator", "value", "targetQuestionId"].includes(key),
      );
      if (extra) fail(`${path}.${extra}`, "请求包含不允许的字段");
      if (
        typeof rule.operator !== "string" ||
        !operators.has(rule.operator as JumpOperator)
      )
        fail(`${path}.operator`);
      if (
        typeof rule.targetQuestionId !== "string" ||
        !questionIdPattern.test(rule.targetQuestionId)
      )
        fail(`${path}.targetQuestionId`);
      if (
        "ruleId" in rule &&
        (typeof rule.ruleId !== "string" || !idPattern.test(rule.ruleId))
      )
        fail(`${path}.ruleId`);
      const rawValue = rule.value;
      if (
        typeof rawValue !== "string" &&
        typeof rawValue !== "number" &&
        !Array.isArray(rawValue)
      )
        fail(`${path}.value`);
      if (
        Array.isArray(rawValue) &&
        rawValue.some((item) => typeof item !== "string")
      )
        fail(`${path}.value`);
      return {
        ...(typeof rule.ruleId === "string" ? { ruleId: rule.ruleId } : {}),
        operator: rule.operator as JumpOperator,
        value: rawValue as string | string[] | number,
        targetQuestionId: rule.targetQuestionId as string,
      };
    },
  );
  return { revision: value.revision as number, rules };
}

const newRuleId = (used: Set<string>): string => {
  let id: string;
  do id = `r_${randomBytes(12).toString("base64url")}`;
  while (used.has(id));
  used.add(id);
  return id;
};

export function normalizeJumpRules(
  source: SurveyQuestion,
  questions: SurveyQuestion[],
  rawRules: RawJumpRule[],
  maximum: number,
): JumpRule[] {
  if (rawRules.length > maximum) fail("rules", `每道题最多 ${maximum} 条规则`);
  if (source.type === "text" && rawRules.length) fail("rules");
  const existingIds = new Set(source.jumpRules.map((rule) => rule.ruleId));
  const usedIds = new Set(
    questions.flatMap((question) =>
      question.jumpRules.map((rule) => rule.ruleId),
    ),
  );
  const submitted = new Set<string>();
  const optionOrder = new Map(
    source.options.map((option, index) => [option.optionId, index]),
  );
  return rawRules.map((raw, index): JumpRule => {
    const path = `rules[${index}]`;
    if (raw.ruleId) {
      if (!existingIds.has(raw.ruleId) || submitted.has(raw.ruleId))
        fail(`${path}.ruleId`);
      submitted.add(raw.ruleId);
    }
    const target = questions.find(
      (question) => question.questionId === raw.targetQuestionId,
    );
    if (!target || target.questionId === source.questionId)
      fail(`${path}.targetQuestionId`);
    let normalizedValue: JumpRule["value"];
    if (source.type === "single") {
      if (
        raw.operator !== "equals" ||
        typeof raw.value !== "string" ||
        !optionOrder.has(raw.value)
      )
        fail(`${path}.value`);
      normalizedValue = raw.value;
    } else if (source.type === "multiple") {
      if (raw.operator === "contains") {
        if (typeof raw.value !== "string" || !optionOrder.has(raw.value))
          fail(`${path}.value`);
        normalizedValue = raw.value;
      } else {
        if (raw.operator !== "containsAll" && raw.operator !== "containsAny")
          fail(`${path}.operator`);
        if (
          !Array.isArray(raw.value) ||
          raw.value.length < 1 ||
          raw.value.length > source.options.length ||
          new Set(raw.value).size !== raw.value.length ||
          raw.value.some((id) => !optionOrder.has(id))
        )
          fail(`${path}.value`);
        normalizedValue = [...(raw.value as string[])].sort(
          (left, right) => optionOrder.get(left)! - optionOrder.get(right)!,
        );
      }
    } else {
      if (
        source.type !== "number" ||
        !["equals", "gt", "gte", "lt", "lte"].includes(raw.operator) ||
        typeof raw.value !== "number" ||
        !Number.isFinite(raw.value) ||
        Math.abs(raw.value) > Number.MAX_SAFE_INTEGER
      )
        fail(`${path}.value`);
      normalizedValue = Object.is(raw.value, -0) ? 0 : raw.value;
    }
    return {
      ruleId: raw.ruleId ?? newRuleId(usedIds),
      operator: raw.operator,
      value: normalizedValue,
      targetQuestionId: raw.targetQuestionId,
    };
  });
}
