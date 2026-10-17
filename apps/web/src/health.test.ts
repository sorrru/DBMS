import { describe, expect, it } from "vitest";
import { connectionLabel } from "./health";

describe("connectionLabel", () => {
  it("returns a readable Chinese label for every state", () => {
    expect(connectionLabel("connected")).toBe("已连接");
    expect(connectionLabel("connecting")).toBe("连接中");
    expect(connectionLabel("disconnected")).toBe("未连接");
    expect(connectionLabel("unknown")).toBe("未知");
  });
});
