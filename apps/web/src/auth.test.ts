import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  currentUser,
  restoreSafeDraft,
  saveSafeDraft,
} from "./auth";

const storage = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  setItem: (key: string, value: string) => storage.set(key, value),
  getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key),
});

describe("auth client", () => {
  beforeEach(() => storage.clear());

  it("uses relative URLs and includes cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: "1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await currentUser();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("exposes stable auth errors for login redirection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: "AUTH_INVALID",
            message: "expired",
            details: { field: "deadline" },
          },
        }),
      }),
    );
    await expect(currentUser()).rejects.toMatchObject({
      code: "AUTH_INVALID",
      details: { field: "deadline" },
    } satisfies Partial<ApiClientError>);
  });

  it("restores a safe draft once and rejects credential fields", () => {
    saveSafeDraft("editor", { title: "问卷草稿" });
    expect(restoreSafeDraft("editor")).toEqual({ title: "问卷草稿" });
    expect(restoreSafeDraft("editor")).toBeUndefined();
    expect(() =>
      saveSafeDraft("bad", { nested: { sessionToken: "secret" } }),
    ).toThrow(/凭据/);
  });
});
