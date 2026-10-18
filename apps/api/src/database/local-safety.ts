const allowedHosts = new Set(["127.0.0.1", "localhost", "::1", "mongodb"]);

export function assertLocalMongoUri(
  uri: string,
  requireTestDatabase = false,
): void {
  if (uri.startsWith("mongodb+srv://"))
    throw new Error("不允许使用 mongodb+srv URI");
  if (!uri.startsWith("mongodb://"))
    throw new Error("MONGODB_URI 必须使用 mongodb://");
  const remainder = uri.slice("mongodb://".length);
  const slash = remainder.indexOf("/");
  if (slash < 0) throw new Error("MONGODB_URI 必须包含数据库名");
  const authority = remainder.slice(0, slash).replace(/^.*@/, "");
  const path = remainder.slice(slash + 1);
  for (const entry of authority.split(",")) {
    const host = entry.startsWith("[")
      ? entry.slice(1, entry.indexOf("]"))
      : entry.split(":")[0];
    if (!host || !allowedHosts.has(host))
      throw new Error("MongoDB URI 中的所有主机必须位于本地允许列表");
  }
  const database = path.split("?")[0] ?? "";
  if (!database) throw new Error("MONGODB_URI 必须包含数据库名");
  if (requireTestDatabase && !database.endsWith("_test"))
    throw new Error("测试数据库名称必须以 _test 结尾");
}
