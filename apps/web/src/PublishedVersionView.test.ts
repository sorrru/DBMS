import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, expect, it } from "vitest";
import PublishedVersionView from "./PublishedVersionView.vue";
import type { SurveyVersion } from "./surveys";

const version: SurveyVersion = {
  id: "v1",
  surveyId: "s1",
  versionNumber: 1,
  status: "published",
  revision: 3,
  title: "课程反馈",
  description: "只读问卷",
  identityMode: "anonymous",
  allowMultipleSubmissions: false,
  deadline: null,
  sessionDurationMinutes: 30,
  questions: [
    {
      questionId: "q_choice",
      type: "single",
      title: "你喜欢这门课吗？",
      required: true,
      validation: {},
      options: [
        { optionId: "o_yes", text: "喜欢" },
        { optionId: "o_no", text: "不喜欢" },
      ],
      jumpRules: [
        {
          ruleId: "r1",
          operator: "equals",
          value: "o_yes",
          targetQuestionId: "q_reason",
        },
      ],
    },
    {
      questionId: "q_reason",
      type: "text",
      title: "请说明原因",
      required: false,
      validation: { minLength: 0, maxLength: 2000, digitsOnly: false },
      options: [],
      jumpRules: [],
    },
  ],
  schemaVersion: 1,
  createdAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-19T00:00:00.000Z",
  publishedAt: "2026-10-19T00:00:00.000Z",
};

describe("PublishedVersionView", () => {
  it("renders published questions, options, and jump destinations", async () => {
    const html = await renderToString(
      createSSRApp(PublishedVersionView, { version }),
    );

    expect(html).toContain("第 1 题");
    expect(html).toContain("你喜欢这门课吗？");
    expect(html).toContain("<li>喜欢</li>");
    expect(html).toContain("<li>不喜欢</li>");
    expect(html).toContain("跳转规则");
    expect(html).toContain("等于“喜欢” → 第 2 题");
    expect(html).toContain("第 2 题");
    expect(html).toContain("请说明原因");
  });

  it("labels a checked draft as a non-publishing preview", async () => {
    const html = await renderToString(
      createSSRApp(PublishedVersionView, {
        version: { ...version, status: "draft", publishedAt: null },
        preview: true,
      }),
    );

    expect(html).toContain('id="draft-preview"');
    expect(html).toContain("发布预览");
    expect(html).toContain("返回编辑不会发布问卷");
    expect(html).toContain("你喜欢这门课吗？");
  });
});
