import { describe, expect, it } from "vitest";
import { FixedWindowStore } from "../src/security/rate-limit.js";

describe("FixedWindowStore", () => {
  it("limits, expires and resets counters", () => {
    const store = new FixedWindowStore(2);
    store.consume("a", 1, 100, 1_000);
    expect(() => store.consume("a", 1, 100, 1_050)).toThrowError(/频繁/);
    expect(() => store.consume("a", 1, 100, 1_101)).not.toThrow();
    store.reset();
    expect(store.size).toBe(0);
    store.dispose();
  });

  it("fails closed when key capacity is full", () => {
    const store = new FixedWindowStore(1);
    store.consume("a", 5, 1_000, 0);
    expect(() => store.consume("b", 5, 1_000, 1)).toThrowError(/频繁/);
    store.dispose();
  });
});
