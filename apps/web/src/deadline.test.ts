import { describe, expect, it } from "vitest";
import {
  composeDeadline,
  splitDeadline,
  stepDeadlinePart,
  TIMEZONE_OPTIONS,
  type DeadlineParts,
} from "./deadline";

const parts = (changes: Partial<DeadlineParts> = {}): DeadlineParts => ({
  enabled: true,
  year: "2027",
  month: "6",
  day: "30",
  hour: "23",
  minute: "59",
  timezone: "+08:00",
  ...changes,
});

describe("deadline input conversion", () => {
  it("splits a stored deadline into human-editable parts", () => {
    expect(splitDeadline("2027-06-30T23:59:00+08:00")).toEqual(parts());
    expect(
      splitDeadline("2027-06-30T15:59:00.000Z", new Date(), 8 * 60),
    ).toEqual(parts());
  });

  it("composes padded ISO 8601 while preserving the selected timezone", () => {
    expect(composeDeadline(parts({ month: "1", day: "2", hour: "3" }))).toEqual(
      {
        value: "2027-01-02T03:59:00+08:00",
      },
    );
  });

  it("rejects impossible dates and invalid timezone offsets", () => {
    expect(composeDeadline(parts({ month: "2", day: "30" })).error).toMatch(
      /不存在/,
    );
    expect(composeDeadline(parts({ timezone: "+15:00" })).error).toMatch(
      /时区/,
    );
  });

  it("represents no deadline as null", () => {
    expect(composeDeadline(parts({ enabled: false }))).toEqual({ value: null });
  });

  it("supports bounded wheel-style stepping and quarter-hour timezones", () => {
    expect(stepDeadlinePart("12", 1, 1, 12)).toBe("12");
    expect(stepDeadlinePart("1", -1, 1, 12)).toBe("1");
    expect(TIMEZONE_OPTIONS).toContain("+05:45");
    expect(TIMEZONE_OPTIONS).toContain("+08:00");
  });
});
