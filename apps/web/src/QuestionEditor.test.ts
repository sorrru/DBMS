import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, it, expect } from "vitest";
import QuestionEditor from "./QuestionEditor.vue";
import type { SurveyVersion } from "./surveys";
const version: SurveyVersion = {
  id: "version",
  surveyId: "survey",
  versionNumber: 1,
  status: "draft",
  revision: 1,
  title: "示例",
  description: "",
  identityMode: "anonymous",
  allowMultipleSubmissions: false,
  deadline: null,
  sessionDurationMinutes: 30,
  schemaVersion: 1,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  publishedAt: null,
  questions: [
    {
      questionId: "q_local",
      type: "single",
      title: "本地题",
      required: true,
      validation: {},
      options: [
        { optionId: "o_a", text: "A" },
        { optionId: "o_b", text: "B" },
      ],
      jumpRules: [],
    },
  ],
};
describe("survey library editing boundaries", () => {
  it("keeps legacy questions editable and offers saving or selecting library questions", async () => {
    const html = await renderToString(
      createSSRApp(QuestionEditor, {
        surveyId: "survey",
        version,
        busy: false,
      }),
    );
    expect(html).toContain("从常用题目选入");
    expect(html).toContain("保存为常用题目");
    expect(html).not.toContain('class="question-definition" disabled');
    expect(html).toContain("保存本题");
  });
  it("makes sourced definitions readonly with explicit swap/detach actions and escapes titles", async () => {
    const sourced: SurveyVersion = {
      ...version,
      schemaVersion: 2,
      questions: [
        {
          ...version.questions[0]!,
          title: "<script>bad()</script>",
          source: {
            libraryQuestionId: "a".repeat(24),
            questionVersionId: "b".repeat(24),
            versionNumber: 3,
            contentRevision: 2,
            optionSources: [
              { optionId: "o_a", sourceOptionId: "o_src_a" },
              { optionId: "o_b", sourceOptionId: "o_src_b" },
            ],
          },
        },
      ],
    };
    const html = await renderToString(
      createSSRApp(QuestionEditor, {
        surveyId: "survey",
        version: sourced,
        busy: false,
      }),
    );
    expect(html).toContain("来自常用题目 v3");
    expect(html).toContain('class="question-definition" disabled');
    expect(html).toContain("换用版本");
    expect(html).toContain("转为本地题目");
    expect(html).not.toContain("保存本题");
    expect(html).not.toContain("<script>bad");
  });
  it("locks definition controls during a write without changing local/source semantics", async () => {
    const html = await renderToString(
      createSSRApp(QuestionEditor, { surveyId: "survey", version, busy: true }),
    );
    expect(html).toContain('class="question-definition" disabled');
    expect(html).toContain("保存为常用题目");
  });
  it("blocks library mutations while other settings or jump rules are unsaved", async () => {
    const html = await renderToString(
      createSSRApp(QuestionEditor, {
        surveyId: "survey",
        version,
        busy: false,
        otherUnsaved: true,
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*从常用题目选入/);
    expect(html).toContain("设置或跳转规则");
    expect(html).not.toContain('class="question-definition" disabled');
  });
});
