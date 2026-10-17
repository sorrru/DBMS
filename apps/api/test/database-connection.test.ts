import { beforeEach, describe, expect, it, vi } from "vitest";

const ping = vi.fn<() => Promise<unknown>>();

vi.mock("mongoose", () => ({
  default: {
    connection: {
      readyState: 1,
      db: {
        admin: () => ({ ping }),
      },
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

import { checkDatabaseStatus } from "../src/database/connection.js";

describe("checkDatabaseStatus", () => {
  beforeEach(() => {
    ping.mockReset();
  });

  it("reports disconnected when the driver still looks connected but ping fails", async () => {
    ping.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(checkDatabaseStatus()).resolves.toBe("disconnected");
  });

  it("reports connected only after a successful ping", async () => {
    ping.mockResolvedValueOnce({ ok: 1 });

    await expect(checkDatabaseStatus()).resolves.toBe("connected");
  });

  it("stops waiting for an unresponsive database after two seconds", async () => {
    vi.useFakeTimers();
    ping.mockReturnValueOnce(new Promise(() => undefined));

    const status = checkDatabaseStatus();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(status).resolves.toBe("disconnected");
    vi.useRealTimers();
  });
});
