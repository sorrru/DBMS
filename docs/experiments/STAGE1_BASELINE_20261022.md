# 第一阶段干净副本回归基线

2026 年 10 月 22 日按人工要求，重新运行第一阶段提交 `90c25046e7dd70cb18c711715fca69f8e303c6db`。本记录作为第二阶段后续回归的对照，不表示第二阶段功能或人工页面验收已通过。

## 代码与环境

- 来源：当前本地仓库的 Git 提交，不包含工作区修改。
- 副本：`/private/tmp/dbms-stage1-baseline-20261022`。
- `git clone --no-hardlinks --no-checkout` 后 `git checkout --detach 90c2504`；运行前后 `git status --porcelain` 均无输出。
- Node.js 24.22.0，npm 11.19.1，Vitest 5.0.5，依赖来自该提交锁文件。
- `npm ci --offline --ignore-scripts` 安装；后续显式执行项目构建脚本。未重新执行安装脚本，不把本记录称为全新联网安装验收。
- Docker Compose 现有 `dbms-mongodb-1` 使用 `mongo:8.0.34`，状态 healthy；实际 MongoDB 版本通过只读 buildInfo 核实为 8.0.34，副本集 rs0 且为可写主节点。
- API 测试配置固定连接本地 `survey_stage1_test`，各用例执行安全校验后清理测试集合。没有复制开发库的密钥或数据。

起初 Docker Desktop 未运行，本机独立 mongod 是 8.3.11，未用于本次基线。用户启动 Docker Desktop 后运行完整测试；受限环境首次无法读 Docker socket，获得受控本机访问后读取状态并测试。环境访问失败不计为代码用例失败。

## 步骤 输入 输出和结果

| 步骤         | 输入或命令                                     | 预期                        | 实际输出                                                                  | 结果 |
| ------------ | ---------------------------------------------- | --------------------------- | ------------------------------------------------------------------------- | ---- |
| 核对提交     | `git rev-parse HEAD`、`git status --porcelain` | 指定提交且工作树干净        | 完整 SHA 与上述一致；status 无输出                                        | 通过 |
| 安装依赖     | `npm ci --offline --ignore-scripts`            | 锁文件依赖可离线安装        | 安装后各 workspace 的 tsc、vue-tsc、vite、vitest 可运行；依赖树符合锁文件 | 通过 |
| 类型检查     | `npm run typecheck`                            | 三个 workspace 无类型错误   | 共享包构建、API tsc、Web vue-tsc 均退出 0                                 | 通过 |
| 生产构建     | `npm run build`                                | 按共享包、API、Web 顺序成功 | 各构建退出 0，Vite 转换 31 个模块并输出产物                               | 通过 |
| 格式检查     | `npm run format:check`                         | 已跟踪文本格式通过          | All matched files use Prettier code style                                 | 通过 |
| 完整测试     | `npm test`                                     | 原 184 项全部通过           | 下表列出各 workspace 实际计数                                             | 通过 |
| 数据库核实   | admin `buildInfo` 与 `hello`                   | 固定版本与副本集正常        | 8.0.34、rs0、isWritablePrimary true                                       | 通过 |
| 最后代码状态 | `git status --porcelain`                       | 检查未改源文件              | 无输出；构建输出按原规则忽略                                              | 通过 |

| Workspace    | 测试文件 | 通过用例 | 失败 | 本次工具报告耗时                               |
| ------------ | -------- | -------- | ---- | ---------------------------------------------- |
| survey-logic | 1        | 11       | 0    | 201 ms                                         |
| api          | 20       | 147      | 0    | 13.45 s                                        |
| web          | 7        | 26       | 0    | 866 ms                                         |
| 合计         | 28       | 184      | 0    | 各包独立报告，不用简单相加代表整条命令墙钟时间 |

耗时仅为本次测试运行记录，不是性能实验或性能保证。测试包括原有集成用例，完整测试契约与场景见第一阶段 `TEST_TRACEABILITY.md`；此处没有新增“镜像式”测试。

## 复现与范围

在独立干净副本上使用项目指定 Node 版本，准备 MongoDB 8.0.34 的 rs0 副本集，确保本地 `survey_stage1_test` 可用于测试，再依次执行上述命令。安装可按 README 使用 `npm ci`，本次使用的离线和忽略安装脚本选项如实记录在上文。

本轮复用已启动的数据库容器，只清理原测试代码涉及的测试集合；没有创建或销毁 Docker 卷，没有关闭原数据库，没有启动网站，也没有运行种子或重新进行浏览器人工验收。第一阶段 DOCX 及当前工作区业务代码未修改。
