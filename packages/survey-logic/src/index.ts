export type QuestionType = "single" | "multiple" | "text" | "number";
export type JumpOperator =
  | "equals"
  | "contains"
  | "containsAll"
  | "containsAny"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface QuestionOption {
  optionId: string;
  text: string;
}
export interface JumpRule {
  ruleId: string;
  operator: JumpOperator;
  value: string | string[] | number;
  targetQuestionId: string;
}
export type QuestionValidation =
  | Record<string, never>
  | { minSelections: number; maxSelections: number }
  | { minLength: number; maxLength: number; digitsOnly: boolean }
  | {
      integerOnly: boolean;
      minValue: number | null;
      maxValue: number | null;
    };
export interface SurveyQuestion {
  questionId: string;
  type: QuestionType;
  title: string;
  required: boolean;
  validation: QuestionValidation;
  options: QuestionOption[];
  jumpRules: JumpRule[];
}
export interface VersionForPublish {
  revision: number;
  deadline: string | Date | null;
  questions: SurveyQuestion[];
}
export type AnswerIssueCode =
  | "REQUIRED"
  | "TYPE_MISMATCH"
  | "UNKNOWN_OPTION"
  | "DUPLICATE_SELECTION"
  | "SELECTION_COUNT"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "DIGITS_ONLY"
  | "OUT_OF_RANGE"
  | "NOT_INTEGER";
export type AnswerResult =
  | { ok: true; value: string | string[] | number | null; answered: boolean }
  | { ok: false; code: AnswerIssueCode; path: string; reason: string };
export type NextQuestion =
  { kind: "question"; questionId: string } | { kind: "end" };
export type PathResult =
  | { ok: true; questionIds: string[] }
  | { ok: false; questionIds: string[]; repeatedQuestionId: string };
export type CheckCode =
  | "INVALID_STRUCTURE"
  | "EMPTY_SURVEY"
  | "JUMP_CYCLE"
  | "DEADLINE_PASSED"
  | "QUESTION_UNREACHABLE"
  | "SHADOWED_RULE";
export interface CheckIssue {
  code: CheckCode;
  path: string;
  message: string;
  questionId?: string;
  ruleId?: string;
  questionIds?: string[];
}
export interface PublishCheck {
  revision: number;
  valid: boolean;
  errors: CheckIssue[];
  warnings: CheckIssue[];
}

export interface SurveyStatusInput {
  currentVersionId: string | null;
  manualStatus: "open" | "closed";
}

export interface CurrentVersionStatusInput {
  deadline: string | Date | null;
}

export type SurveyStatus = "draft" | "published" | "closed" | "expired";

export interface FillSessionStatusInput {
  status: "active" | "expired" | "submitted";
  expiresAt: string | Date;
}

export interface FillSessionSurveyInput {
  manualStatus: "open" | "closed";
}

export interface FillSessionVersionInput {
  deadline: string | Date | null;
}

export type FillSessionState =
  "active" | "submitted" | "closed" | "survey_expired" | "expired";

export function computeSurveyStatus(
  survey: SurveyStatusInput,
  currentVersion: CurrentVersionStatusInput | null,
  now: Date,
): SurveyStatus {
  if (!survey.currentVersionId || !currentVersion) return "draft";
  if (survey.manualStatus === "closed") return "closed";
  if (
    currentVersion.deadline &&
    new Date(currentVersion.deadline).getTime() <= now.getTime()
  )
    return "expired";
  return "published";
}

export function computeSessionState(
  session: FillSessionStatusInput,
  survey: FillSessionSurveyInput,
  sessionVersion: FillSessionVersionInput,
  now: Date,
): FillSessionState {
  if (session.status === "submitted") return "submitted";
  if (session.status === "expired") return "expired";
  if (survey.manualStatus === "closed") return "closed";
  if (
    sessionVersion.deadline &&
    new Date(sessionVersion.deadline).getTime() <= now.getTime()
  )
    return "survey_expired";
  if (new Date(session.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

const safeMaximum = Number.MAX_SAFE_INTEGER;
const codePoints = (value: string): number => Array.from(value).length;
const failure = (code: AnswerIssueCode, reason: string): AnswerResult => ({
  ok: false,
  code,
  path: "answer",
  reason,
});

export function validateAnswer(
  question: SurveyQuestion,
  candidate: unknown,
): AnswerResult {
  const missing = candidate === undefined || candidate === null;
  if (
    question.type === "multiple" &&
    Array.isArray(candidate) &&
    candidate.length === 0
  )
    return question.required
      ? failure("REQUIRED", "此题为必答题")
      : { ok: true, value: null, answered: false };
  if (question.type === "text" && typeof candidate === "string") {
    const value = candidate.normalize("NFC").trim();
    if (!value)
      return question.required
        ? failure("REQUIRED", "此题为必答题")
        : { ok: true, value: null, answered: false };
    const validation = question.validation as Extract<
      QuestionValidation,
      { minLength: number }
    >;
    const length = codePoints(value);
    if (length < validation.minLength)
      return failure("TOO_SHORT", "文本长度小于最小值");
    if (length > validation.maxLength)
      return failure("TOO_LONG", "文本长度超过最大值");
    if (validation.digitsOnly && !/^[0-9]+$/.test(value))
      return failure("DIGITS_ONLY", "只能输入 ASCII 数字");
    return { ok: true, value, answered: true };
  }
  if (missing)
    return question.required
      ? failure("REQUIRED", "此题为必答题")
      : { ok: true, value: null, answered: false };
  const allowed = new Set(question.options.map((option) => option.optionId));
  if (question.type === "single") {
    if (typeof candidate !== "string")
      return failure("TYPE_MISMATCH", "单选答案必须是选项 ID 字符串");
    if (!allowed.has(candidate)) return failure("UNKNOWN_OPTION", "选项无效");
    return { ok: true, value: candidate, answered: true };
  }
  if (question.type === "multiple") {
    if (
      !Array.isArray(candidate) ||
      candidate.some((item) => typeof item !== "string")
    )
      return failure("TYPE_MISMATCH", "多选答案必须是选项 ID 数组");
    const values = candidate as string[];
    if (new Set(values).size !== values.length)
      return failure("DUPLICATE_SELECTION", "多选答案包含重复选项");
    if (values.some((id) => !allowed.has(id)))
      return failure("UNKNOWN_OPTION", "多选答案包含无效选项");
    const validation = question.validation as Extract<
      QuestionValidation,
      { minSelections: number }
    >;
    if (
      values.length < validation.minSelections ||
      values.length > validation.maxSelections
    )
      return failure("SELECTION_COUNT", "选择数量不符合要求");
    const selected = new Set(values);
    return {
      ok: true,
      value: question.options
        .map((option) => option.optionId)
        .filter((optionId) => selected.has(optionId)),
      answered: true,
    };
  }
  if (question.type === "number") {
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      Math.abs(candidate) > safeMaximum
    )
      return typeof candidate === "number"
        ? failure("OUT_OF_RANGE", "必须是安全范围内的有限数值")
        : failure("TYPE_MISMATCH", "数字题答案必须是数值");
    const value = Object.is(candidate, -0) ? 0 : candidate;
    const validation = question.validation as Extract<
      QuestionValidation,
      { integerOnly: boolean }
    >;
    if (validation.integerOnly && !Number.isInteger(value))
      return failure("NOT_INTEGER", "必须是整数");
    if (validation.minValue !== null && value < validation.minValue)
      return failure("OUT_OF_RANGE", "数值小于最小值");
    if (validation.maxValue !== null && value > validation.maxValue)
      return failure("OUT_OF_RANGE", "数值大于最大值");
    return { ok: true, value, answered: true };
  }
  return failure("TYPE_MISMATCH", "答案类型错误");
}

function canonicalRoutingAnswer(
  question: SurveyQuestion,
  candidate: unknown,
): string | string[] | number | null {
  const allowed = new Set(question.options.map((option) => option.optionId));
  if (question.type === "single")
    return typeof candidate === "string" && allowed.has(candidate)
      ? candidate
      : null;
  if (question.type === "multiple") {
    if (
      !Array.isArray(candidate) ||
      candidate.some((value) => typeof value !== "string")
    )
      return null;
    const values = candidate as string[];
    return values.length > 0 &&
      new Set(values).size === values.length &&
      values.every((value) => allowed.has(value))
      ? values
      : null;
  }
  if (question.type === "number")
    return typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      Math.abs(candidate) <= safeMaximum
      ? Object.is(candidate, -0)
        ? 0
        : candidate
      : null;
  return null;
}

function matches(rule: JumpRule, answer: string | string[] | number): boolean {
  if (typeof answer === "number" && typeof rule.value === "number") {
    if (rule.operator === "equals") return answer === rule.value;
    if (rule.operator === "gt") return answer > rule.value;
    if (rule.operator === "gte") return answer >= rule.value;
    if (rule.operator === "lt") return answer < rule.value;
    if (rule.operator === "lte") return answer <= rule.value;
  }
  if (typeof answer === "string")
    return rule.operator === "equals" && answer === rule.value;
  if (Array.isArray(answer)) {
    if (rule.operator === "contains" && typeof rule.value === "string")
      return answer.includes(rule.value);
    if (Array.isArray(rule.value) && rule.operator === "containsAll")
      return rule.value.every((value) => answer.includes(value));
    if (Array.isArray(rule.value) && rule.operator === "containsAny")
      return rule.value.some((value) => answer.includes(value));
  }
  return false;
}

export function evaluateNextQuestion(
  questions: SurveyQuestion[],
  currentQuestionId: string,
  candidate: unknown,
): NextQuestion {
  const index = questions.findIndex(
    (question) => question.questionId === currentQuestionId,
  );
  if (index < 0) return { kind: "end" };
  const question = questions[index]!;
  const answer = canonicalRoutingAnswer(question, candidate);
  if (answer !== null) {
    const matched = question.jumpRules.find((rule) => matches(rule, answer));
    if (matched)
      return { kind: "question", questionId: matched.targetQuestionId };
  }
  const next = questions[index + 1];
  return next
    ? { kind: "question", questionId: next.questionId }
    : { kind: "end" };
}

export function computePath(
  questions: SurveyQuestion[],
  answers: Readonly<Record<string, unknown>>,
): PathResult {
  if (!questions.length) return { ok: true, questionIds: [] };
  const path: string[] = [];
  const seen = new Set<string>();
  let current = questions[0]!.questionId;
  while (true) {
    if (seen.has(current))
      return { ok: false, questionIds: path, repeatedQuestionId: current };
    seen.add(current);
    path.push(current);
    const next = evaluateNextQuestion(questions, current, answers[current]);
    if (next.kind === "end") return { ok: true, questionIds: path };
    current = next.questionId;
  }
}

interface Edge {
  from: number;
  to: number;
  ruleIndex?: number;
}

const issue = (
  code: CheckCode,
  path: string,
  message: string,
  extra: Partial<CheckIssue> = {},
): CheckIssue => ({ code, path, message, ...extra });

function shortestPath(
  adjacency: number[][],
  start: number,
  goal: number,
): number[] | null {
  const queue = [start];
  const previous = new Map<number, number | null>([[start, null]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (current === goal) break;
    for (const next of adjacency[current] ?? []) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  if (!previous.has(goal)) return null;
  const result: number[] = [];
  for (
    let value: number | null = goal;
    value !== null;
    value = previous.get(value) ?? null
  )
    result.push(value);
  return result.reverse();
}

export function validateForPublish(
  version: VersionForPublish,
  now: Date,
  maximumRulesPerQuestion = 20,
): PublishCheck {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const questions = version.questions;
  const questionIndex = new Map<string, number>();
  const globalIds = new Set<string>();
  const structure = (
    path: string,
    message: string,
    questionId?: string,
    ruleId?: string,
  ) =>
    errors.push(
      issue("INVALID_STRUCTURE", path, message, { questionId, ruleId }),
    );
  if (questions.length > 100) structure("questions", "题目数量超过上限");
  questions.forEach((question, index) => {
    if (globalIds.has(question.questionId))
      structure(
        `questions[${index}].questionId`,
        "题目 ID 重复",
        question.questionId,
      );
    globalIds.add(question.questionId);
    questionIndex.set(question.questionId, index);
    if (
      (question.type === "single" || question.type === "multiple") &&
      (question.options.length < 2 || question.options.length > 50)
    )
      structure(
        `questions[${index}].options`,
        "选项数量不合法",
        question.questionId,
      );
    question.options.forEach((option, optionIndex) => {
      if (globalIds.has(option.optionId))
        structure(
          `questions[${index}].options[${optionIndex}].optionId`,
          "选项 ID 重复",
          question.questionId,
        );
      globalIds.add(option.optionId);
    });
    question.jumpRules.forEach((rule, ruleIndex) => {
      if (globalIds.has(rule.ruleId))
        structure(
          `questions[${index}].jumpRules[${ruleIndex}].ruleId`,
          "规则 ID 重复",
          question.questionId,
          rule.ruleId,
        );
      globalIds.add(rule.ruleId);
    });
    if (question.jumpRules.length > maximumRulesPerQuestion)
      structure(
        `questions[${index}].jumpRules`,
        "规则数量超过上限",
        question.questionId,
      );
  });
  if (!questions.length)
    errors.push(issue("EMPTY_SURVEY", "questions", "问卷至少需要一道题"));
  const edges: Edge[] = [];
  questions.forEach((question, from) => {
    const allowed = new Set(question.options.map((option) => option.optionId));
    question.jumpRules.forEach((rule, ruleIndex) => {
      const to = questionIndex.get(rule.targetQuestionId);
      if (to === undefined) {
        structure(
          `questions[${from}].jumpRules[${ruleIndex}].targetQuestionId`,
          "目标题不存在",
          question.questionId,
          rule.ruleId,
        );
        return;
      }
      if (to === from) {
        structure(
          `questions[${from}].jumpRules[${ruleIndex}].targetQuestionId`,
          "规则不能跳转到来源题自身",
          question.questionId,
          rule.ruleId,
        );
        return;
      }
      const values = Array.isArray(rule.value) ? rule.value : [rule.value];
      if (
        (question.type === "single" || question.type === "multiple") &&
        values.some((value) => typeof value !== "string" || !allowed.has(value))
      )
        structure(
          `questions[${from}].jumpRules[${ruleIndex}].value`,
          "条件选项不属于来源题",
          question.questionId,
          rule.ruleId,
        );
      edges.push({ from, to, ruleIndex });
    });
    const covered =
      question.type === "single" &&
      question.required &&
      question.options.every((option) =>
        question.jumpRules.some(
          (rule) =>
            rule.operator === "equals" && rule.value === option.optionId,
        ),
      );
    if (!covered && from + 1 < questions.length)
      edges.push({ from, to: from + 1 });
  });
  const adjacency = questions.map(() => [] as number[]);
  edges.forEach((edge) => adjacency[edge.from]!.push(edge.to));
  const reachable = new Set<number>();
  const queue = questions.length ? [0] : [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...(adjacency[current] ?? []));
  }
  edges
    .filter(
      (edge) =>
        edge.ruleIndex !== undefined &&
        edge.to < edge.from &&
        reachable.has(edge.from),
    )
    .forEach((edge) => {
      const back = shortestPath(adjacency, edge.to, edge.from);
      if (!back) return;
      const question = questions[edge.from]!;
      const rule = question.jumpRules[edge.ruleIndex!]!;
      errors.push(
        issue(
          "JUMP_CYCLE",
          `questions[${edge.from}].jumpRules[${edge.ruleIndex}]`,
          "该规则指向更靠前的题目并形成循环",
          {
            questionId: question.questionId,
            ruleId: rule.ruleId,
            questionIds: [
              question.questionId,
              ...back.map((index) => questions[index]!.questionId),
            ],
          },
        ),
      );
    });
  questions.forEach((question, index) => {
    if (!reachable.has(index))
      warnings.push(
        issue(
          "QUESTION_UNREACHABLE",
          `questions[${index}]`,
          "该题无法从第一题到达",
          { questionId: question.questionId },
        ),
      );
    const seen = new Map<string, number>();
    question.jumpRules.forEach((rule, ruleIndex) => {
      const value = Array.isArray(rule.value)
        ? [...rule.value].sort().join("\u0000")
        : String(rule.value);
      const key = `${rule.operator}:${value}`;
      const earlier = seen.get(key);
      if (earlier !== undefined)
        warnings.push(
          issue(
            "SHADOWED_RULE",
            `questions[${index}].jumpRules[${ruleIndex}]`,
            `该条件已被第 ${earlier + 1} 条规则遮蔽`,
            { questionId: question.questionId, ruleId: rule.ruleId },
          ),
        );
      else seen.set(key, ruleIndex);
    });
  });
  if (version.deadline && new Date(version.deadline).getTime() <= now.getTime())
    errors.unshift(issue("DEADLINE_PASSED", "deadline", "截止时间已经过去"));
  const order = (item: CheckIssue): number[] => {
    if (item.path === "deadline") return [-2, -1];
    if (item.path === "questions") return [-1, -1];
    const question = /questions\[(\d+)\]/.exec(item.path);
    const rule = /jumpRules\[(\d+)\]/.exec(item.path);
    return [
      question ? Number(question[1]) : Number.MAX_SAFE_INTEGER,
      rule ? Number(rule[1]) : -1,
    ];
  };
  const stableIssueOrder = (left: CheckIssue, right: CheckIssue): number => {
    const [leftQuestion, leftRule] = order(left);
    const [rightQuestion, rightRule] = order(right);
    return leftQuestion! - rightQuestion! || leftRule! - rightRule!;
  };
  errors.sort(stableIssueOrder);
  warnings.sort(stableIssueOrder);
  return {
    revision: version.revision,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
