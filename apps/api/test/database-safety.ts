const localHosts = new Set(["127.0.0.1", "localhost", "::1", "mongodb"]);

export function assertSafeTestDatabase(uri: string): void {
  if (process.env.NODE_ENV !== "test")
    throw new Error("清理测试数据库要求 NODE_ENV=test");
  if (uri.startsWith("mongodb+srv://"))
    throw new Error("测试数据库不允许 mongodb+srv URI");
  if (!uri.startsWith("mongodb://")) throw new Error("无效的测试数据库 URI");
  const withoutProtocol = uri.slice("mongodb://".length);
  const [authority = "", path = ""] = withoutProtocol.split("/", 2);
  const hostList = authority.replace(/^.*@/, "").split(",");
  for (const entry of hostList) {
    const host = entry.startsWith("[")
      ? entry.slice(1, entry.indexOf("]"))
      : entry.split(":")[0];
    if (!host || !localHosts.has(host))
      throw new Error("测试数据库主机必须全部位于本地允许列表");
  }
  const database = path.split("?")[0] ?? "";
  if (!database.endsWith("_test"))
    throw new Error("测试数据库名称必须以 _test 结尾");
}
