import { createSSRApp, type Ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import LibraryView from "./LibraryView.vue";
import { ApiClientError } from "./auth";
const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./library", async (original) => ({
  ...(await original<typeof import("./library")>()),
  createLibraryQuestion: api.create,
}));
type FormState = {
  mode: Ref<string>;
  form: { type: string; title: string; validation: Record<string, unknown> };
  save: () => Promise<void>;
};
async function renderFailedSave(
  path: string,
  validation: Record<string, unknown>,
  code = "VALIDATION_ERROR",
) {
  api.create.mockRejectedValue(
    new ApiClientError(
      code,
      "请求参数不符合要求",
      code === "VALIDATION_ERROR" ? 400 : 503,
      { path },
    ),
  );
  const failure = vi.fn();
  const original = LibraryView as unknown as {
    setup: (props: unknown, ctx: unknown) => FormState;
  };
  const component = {
    ...LibraryView,
    async setup(props: unknown, ctx: unknown) {
      const state = original.setup(props, ctx);
      state.mode.value = "new";
      state.form.type = "number";
      state.form.title = "年龄";
      state.form.validation = validation;
      await state.save();
      return state;
    },
  };
  return {
    html: await renderToString(createSSRApp(component, { onFailure: failure })),
    failure,
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
it("renders the age upper-bound error directly below the maximum input without duplicating it in the page header", async () => {
  const { html, failure } = await renderFailedSave("validation.maxValue", {
    minValue: 30,
    maxValue: 18,
    integerOnly: false,
  });
  expect(html).toMatch(
    /最大值 可留空<input[^>]*aria-invalid="true"[^>]*>[\s\S]*?最大值不能小于最小值。<\/span><\/label>/,
  );
  expect(html).not.toContain("（validation.maxValue）");
  expect(failure).not.toHaveBeenCalled();
});

it("marks the lower-bound input and explains fractional bounds beside the integer setting", async () => {
  const minimum = await renderFailedSave("validation.minValue", {
    minValue: "bad",
    maxValue: null,
  });
  expect(minimum.html).toMatch(
    /最小值 可留空<input[^>]*aria-invalid="true"[^>]*>[\s\S]*?请输入有效的最小值。<\/span><\/label>/,
  );
  const integer = await renderFailedSave("validation.integerOnly", {
    minValue: 1.5,
    maxValue: 20,
    integerOnly: true,
  });
  expect(integer.html).toMatch(
    /仅整数<span[^>]*class="field-error"[^>]*>启用仅整数时，最小值和最大值也必须是整数。<\/span>/,
  );
});
it("focuses and scrolls to the invalid bound after the saving state ends", async () => {
  const focus = vi.fn(),
    scrollIntoView = vi.fn(),
    querySelector = vi.fn(() => ({ focus, scrollIntoView }));
  vi.stubGlobal("document", { querySelector });
  await renderFailedSave("validation.maxValue", { minValue: 30, maxValue: 18 });
  expect(querySelector).toHaveBeenCalledWith(
    '[aria-describedby="library-error-validation-maxValue"]',
  );
  expect(focus).toHaveBeenCalledOnce();
  expect(scrollIntoView).toHaveBeenCalledWith({
    block: "center",
    behavior: "smooth",
  });
});
it("keeps service failures visible at page level instead of treating them as field validation", async () => {
  const { failure } = await renderFailedSave(
    "validation.maxValue",
    {},
    "STATISTICS_UNAVAILABLE",
  );
  expect(failure).toHaveBeenCalledOnce();
});
