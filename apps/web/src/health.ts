export type ConnectionState =
  "connected" | "connecting" | "disconnected" | "unknown";

export interface HealthResponse {
  status: "ok" | "degraded";
  services: {
    api: "connected";
    database: Exclude<ConnectionState, "unknown">;
  };
  timestamp: string;
}

export const connectionLabel = (state: ConnectionState): string => {
  const labels: Record<ConnectionState, string> = {
    connected: "已连接",
    connecting: "连接中",
    disconnected: "未连接",
    unknown: "未知",
  };
  return labels[state];
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(`健康检查失败：HTTP ${response.status}`);
  return response.json() as Promise<HealthResponse>;
}
