import { describe, expect, it } from "vitest";
import { resetFeedbackAfterSignOut } from "./auth-view-state";

describe("sign-out view state", () => {
  it("clears workspace success and publish messages before showing login", () => {
    const message = { value: "版本发布成功。" };
    const publishError = { value: "发布检查未通过" };

    resetFeedbackAfterSignOut(message, publishError);

    expect(message.value).toBe("");
    expect(publishError.value).toBe("");
  });
});
