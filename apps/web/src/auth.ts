export interface PublicUser {
  id: string;
  username: string;
  registeredAt: string;
}
interface UserResponse {
  user: PublicUser;
}
interface ErrorResponse {
  error?: { code?: string; message?: string };
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...options });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new ApiClientError(
      body.error?.code ?? "INTERNAL_ERROR",
      body.error?.message ?? "请求失败",
      response.status,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

const jsonOptions = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const register = (username: string, password: string) =>
  api<UserResponse>("/api/auth/register", jsonOptions({ username, password }));
export const login = (username: string, password: string) =>
  api<UserResponse>("/api/auth/login", jsonOptions({ username, password }));
export const currentUser = () => api<UserResponse>("/api/auth/me");
export const logout = () => api<void>("/api/auth/logout", { method: "POST" });

const forbiddenDraftKey = /password|token|jwt|anonymous.?id|session.?token/i;
function containsCredential(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([field, child]) =>
      forbiddenDraftKey.test(field) || containsCredential(child),
  );
}
export function saveSafeDraft(
  key: string,
  draft: Record<string, unknown>,
): void {
  if (containsCredential(draft)) throw new Error("草稿包含凭据字段");
  sessionStorage.setItem(`survey-draft:${key}`, JSON.stringify(draft));
}
export function restoreSafeDraft<T>(key: string): T | undefined {
  const storageKey = `survey-draft:${key}`;
  const text = sessionStorage.getItem(storageKey);
  if (!text) return undefined;
  sessionStorage.removeItem(storageKey);
  return JSON.parse(text) as T;
}
