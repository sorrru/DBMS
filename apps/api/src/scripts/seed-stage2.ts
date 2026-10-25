import { validateCredentials } from "../auth/validation.js";
import { PasswordService } from "../security/password.js";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { assertLocalMongoUri } from "../database/local-safety.js";
import { Stage2Demo } from "../maintenance/stage2-demo.js";
const args = process.argv.slice(2);
if (
  args.some(
    (a) => !["--clean", "--reset", "--confirm-demo-data"].includes(a),
  ) ||
  new Set(args).size !== args.length ||
  (args.includes("--clean") && args.includes("--reset")) ||
  (args.includes("--clean") || args.includes("--reset")) !==
    args.includes("--confirm-demo-data")
)
  throw Error(
    "清理或重建需 --clean/--reset 加 --confirm-demo-data；默认只创建缺失演示或验证现有演示",
  );
if (process.env.NODE_ENV === "production") throw Error("生产环境禁止演示脚本");
assertLocalMongoUri(env.mongoUri);
// Validate before reset removes anything. Password is never logged or written to reports.
if (args.includes("--reset") && !process.env.SEED_USER_PASSWORD)
  throw Error("reset 需先设置 SEED_USER_PASSWORD");
if (args.includes("--reset"))
  validateCredentials(
    { username: "stage2_teacher", password: process.env.SEED_USER_PASSWORD },
    new PasswordService(),
    true,
  );
await mongoose.connect(env.mongoUri);
try {
  const demo = new Stage2Demo(env);
  if (args.includes("--clean") || args.includes("--reset"))
    console.log(JSON.stringify(await demo.clean()));
  if (!args.includes("--clean"))
    console.log(
      JSON.stringify(await demo.create(process.env.SEED_USER_PASSWORD)),
    );
} finally {
  await mongoose.disconnect();
}
