# 基于 MongoDB 的版本化问卷系统

本仓库保存数据库系统大作业一的两个阶段。第二阶段在第一阶段代码上增量扩展，`main` 为第二阶段完整系统；两个阶段通过固定标签及独立报告区分。

## 两阶段提交导航

| 阶段     | 固定代码版本                                                                            | 报告与材料                                                                                                                                                                                       | 验证       |
| -------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 第一阶段 | [stage1-final](https://github.com/sorrru/DBMS/tree/stage1-final)，对应 `90c2504`        | [阶段一报告](docs/PROJECT_REPORT.md)、[阶段一 Word](docs/PROJECT_REPORT.docx)、[阶段一清单](TODO.md)；该阶段设计以标签内文档为准                                                                 | 184 项测试 |
| 第二阶段 | [stage2-final](https://github.com/sorrru/DBMS/tree/stage2-final)，也为本次交付的 `main` | [阶段二报告](docs/PROJECT_REPORT_STAGE2.md)、[Word](docs/PROJECT_REPORT_STAGE2.docx)、[PDF](docs/PROJECT_REPORT_STAGE2.pdf)、[提交索引](docs/SUBMISSION_STAGE2.md)、[阶段二清单](STAGE2_TODO.md) | 301 项测试 |

查看第一阶段源码使用 `git switch --detach stage1-final`，查看第二阶段使用 `git switch --detach stage2-final`；操作前先保存工作区修改。两阶段共用原有目录结构，完整保留 Git 演进历史；不要把当前 `main` 的新增题库功能算入第一阶段。

## 第二阶段当前进度

里程碑 0–6 已通过人工检查；里程碑 7 的完整报告已按总要求精简，系统与数据库文档及交付索引齐全，用户已授权在原仓库统一提交。完整 301 项回归、类型检查、生产构建与格式检查通过。运行配置和启动命令沿用下文，无新增必填环境变量。

登录后，在“我的问卷 → 管理常用题目与版本”管理独立题目；进入问卷草稿后，在题目区点击“从常用题目选入”。已保存的本地题可点“保存为常用题目”；带来源题可“换用版本”或“转为本地题目”。

当前新增 `questions`、`question_versions`、`library_option_keys`、`question_usages` 和 `question_shares` 模型。已接入问卷选题及使用记录事务维护。题目管理中可切换“共享给我”；所有者在题目详情管理版本授权并查看引用，接收者也可从问卷选题器选用共享版本。新增 `question_banks` 和 `question_bank_items` 分类集合；进入“管理题库分类”可创建和管理分类，成员可固定版本或跟随最新可用版本，不影响已有问卷。常用题目详情、草稿来源题及已发布问卷来源题的“跨问卷统计”只汇总自己的已发布问卷，支持分版本及明确合并、选项归并、数字分桶和文本分页。统计默认折叠，题库分类不产生问卷统计来源。原五集合、问卷快照和历史回答保持兼容。

检查材料：[需求](docs/STAGE2_REQUIREMENTS.md)、[增量设计](docs/STAGE2_DESIGN.md)、[D8 引用方案实验](docs/experiments/STAGE2_D8_COMPARISON.md)、[里程碑 1 检查记录](docs/experiments/STAGE2_MILESTONE1_TEST_REPORT.md)、[里程碑 2 检查记录](docs/experiments/STAGE2_MILESTONE2_TEST_REPORT.md)、[里程碑 3 测试与人工检查步骤](docs/experiments/STAGE2_MILESTONE3_TEST_REPORT.md)。

里程碑 4 检查材料：[题库测试与人工步骤](docs/experiments/STAGE2_MILESTONE4_TEST_REPORT.md)。

里程碑 5 检查材料：[统计测试与人工步骤](docs/experiments/STAGE2_MILESTONE5_TEST_REPORT.md)、[真实执行计划](docs/experiments/STAGE2_STATISTICS_EXPLAIN.json)。

里程碑 6 检查材料：[完整回归与人工流程](docs/experiments/STAGE2_MILESTONE6_TEST_REPORT.md)、[需求测试矩阵](docs/experiments/STAGE2_REQUIREMENT_TEST_MATRIX.md)、[维护及独立演示说明](docs/STAGE2_OPERATIONS.md)。第二阶段演示用 `seed:stage2`，默认不重建；原种子账号含第二阶段数据时旧 seed 会拒绝清理。

第二阶段当前主报告：[完整项目报告](docs/PROJECT_REPORT_STAGE2.md)。完整设计：[系统说明](docs/SYSTEM_DESIGN_STAGE2.md)、[数据库设计](docs/DATABASE_DESIGN.md)。[提交材料索引](docs/SUBMISSION_STAGE2.md)区分当前报告与第一阶段历史 Word；第一阶段历史材料通过 `stage1-final` 固定，第二阶段材料通过 `stage2-final` 固定。

## 当前技术版本

| 组件       |    版本 |
| ---------- | ------: |
| Node.js    | 24.22.0 |
| TypeScript |   5.9.3 |
| Vue        |  3.5.44 |
| Vite       |   8.3.4 |
| Express    |   5.3.0 |
| Mongoose   |  9.11.2 |
| MongoDB    |  8.0.34 |
| Vitest     |   5.0.5 |

Node.js 由 `.nvmrc` 和根目录 `package.json` 的 `engines` 精确固定为 24.22.0；npm 依赖由各级 `package.json` 与 `package-lock.json` 固定；MongoDB 镜像由 `docker-compose.yml` 中两个服务的 `image: mongo:8.0.34` 固定。表中版本已逐项与这些文件核对。

## 目录

```text
apps/
├── api/               Express 5 TypeScript 后端
└── web/               Vue 3 TypeScript 前端
packages/
└── survey-logic/      前后端共享的答案校验、跳转路径和发布检查逻辑
docker/                MongoDB 副本集初始化脚本
docs/                  已确认的需求、系统设计和 API 文档
docs/experiments/      查询执行计划、性能数据参数与实验结果
TODO.md                分阶段开发清单
docker-compose.yml     MongoDB 8.0.34 单节点副本集
```

## 前置条件

- Node.js 24.22.0（可在根目录执行 `nvm use`）
- npm
- Docker Desktop 或兼容的 Docker Compose 环境

## 从零启动

1. 创建本地环境配置：

```bash
cp .env.example .env
```

2. 生成并填写两个不同的随机密钥。示例占位值不能启动 API，`.env` 不应提交到 Git：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

3. 启动 MongoDB 单节点副本集：

```bash
docker compose up -d
docker compose ps
```

4. 安装依赖并运行检查：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run format:check
```

5. 同时启动前后端：

```bash
npm run dev
```

访问：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:3000/api/health`

前端每 10 秒检查一次 API 和 MongoDB 状态。

根构建显式按“共享包 → API → Web”执行。开发命令先构建共享包，再同时监视共享包、API 和 Vite；生产构建只消费共享包的 `dist`，开发模式会随共享源码变化更新。

### 可选：创建本地演示数据

先在 `.env` 填写符合正式密码规则的 `SEED_USER_PASSWORD`，然后运行：

```bash
npm run seed
```

该命令创建问卷创建者 `seed_demo` 和填写者 `seed_guest_a`、`seed_guest_b`，三个账号都使用 `SEED_USER_PASSWORD`。演示数据包含匿名问卷的三份可手算回答、已发布 v1 + 草稿 v2、四种题型与有效分支，以及两名账号填写的已关闭实名问卷和已到期问卷。重复运行会先清理旧种子数据。只清理种子数据：

```bash
npm run seed:clean
```

两个命令在生产环境、`mongodb+srv` 或任一非本地主机上都会拒绝运行。

## 健康检查响应

MongoDB 已连接时：

```json
{
  "status": "ok",
  "services": {
    "api": "connected",
    "database": "connected"
  },
  "timestamp": "2026-10-16T00:00:00.000Z"
}
```

连接状态共有四种：

| 状态           | 含义                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| `connected`    | 已建立连接，可正常提供对应服务。                                                   |
| `connecting`   | 正在建立首次连接或重新连接。                                                       |
| `disconnected` | 当前无法连接，或主动 `ping` 在 2 秒内未成功。                                      |
| `unknown`      | 前端尚未取得健康检查结果或无法访问 API；该状态只由前端展示，不由健康检查接口返回。 |

数据库未连接时，API 仍保持可访问，整体 `status` 为 `degraded`。例如：

```json
{
  "status": "degraded",
  "services": {
    "api": "connected",
    "database": "disconnected"
  },
  "timestamp": "2026-10-16T00:00:00.000Z"
}
```

若数据库正在连接，`database` 为 `connecting`，整体仍为 `degraded`。健康检查在驱动显示已连接时额外执行 MongoDB `ping`，并设置 2 秒应用级超时，因此数据库停止响应后不会继续误报 `connected`。

后端仅在**首次连接失败**时每 5 秒再次调用连接流程。已经成功连接后发生中断时，底层驱动负责恢复连接；健康检查负责准确反映数据库当前是否可响应，不把驱动恢复机制描述成固定 5 秒重连。若 API 本身不可访问，则没有 HTTP 响应，前端把 API 和数据库状态都显示为 `unknown`。

## 为什么使用单节点副本集

本项目发布问卷版本时需要在 `surveys` 与 `survey_versions` 等集合间执行多文档事务，保证“保存不可变版本”和“更新当前版本指针”同时成功或同时失败。MongoDB 多文档事务要求副本集或分片集群，因此开发环境使用单节点副本集；它保留事务能力，同时比多节点集群更适合作业本地运行。

## 核心数据模型

| 集合              | 作用                                           | 关键关系                                  |
| ----------------- | ---------------------------------------------- | ----------------------------------------- |
| `users`           | 保存账号、规范化用户名和密码哈希               | 一个用户可以创建多份问卷                  |
| `surveys`         | 保存问卷长期身份、公开链接、当前版本和草稿指针 | 一份问卷对应多个版本                      |
| `survey_versions` | 保存某一版本的完整问卷定义                     | 内嵌题目、选项、校验与跳转规则            |
| `fill_sessions`   | 固定填写者打开时的发布版本和会话期限           | 提交后释放活动槽位，到期七天后物理清理    |
| `responses`       | 永久保存正式回答、真实路径和版本归属           | 始终通过 `surveyVersionId` 与发布版本绑定 |

题目、选项、校验和跳转规则嵌套在 `survey_versions` 中，使每个发布版本都能作为完整且不可变的快照读取。回答独立保存在 `responses` 中，避免问卷文档随提交数量无限增长，并支持并发提交、分页和 MongoDB 聚合统计。

匿名模式不会在填写会话中保存 `userId`，也不会在正式回答中保存 `respondentId`；系统内部使用问卷内稳定的 `ownerKey` 判断会话所有权和重复填写。`fillSessionId` 是提交幂等性的唯一锚点，但填写会话会被 TTL 清理，因此该引用之后允许悬空，正式回答不会随会话删除。完整字段、索引和嵌套原因见当前[数据库设计](docs/DATABASE_DESIGN.md)；原[第一阶段系统设计](docs/SYSTEM_DESIGN.md)保留作历史依据。

## 问卷版本生命周期

```text
创建问卷
  ↓
v1 草稿 ── 编辑设置、题目和跳转
  ↓ 发布检查
v1 已发布 ← 当前公开版本
  ↓ 创建下一版本草稿
v2 草稿（此时 v1 继续服务）
  ↓ 发布
v2 已发布 ← 新当前版本
v1 保留历史回答和统计
```

- 发布版本不可修改；修改已经发布的问卷必须创建下一版本草稿。
- 发布事务同时更新版本状态、当前版本指针和草稿指针，失败时全部回滚。
- 填写会话和正式回答始终绑定打开或提交时的 `surveyVersionId`，不同版本的回答不会混合。
- 手工关闭独立于版本发布。有效状态按“尚未发布 → `draft`、手工关闭 → `closed`、截止时间已到 → `expired`、其余 → `published`”的优先级计算。

## API 分组摘要

- `/api/auth/*`：注册、登录、读取当前用户和退出登录。
- `/api/surveys/*`：问卷主体、版本草稿、题目、跳转规则、发布、状态与版本历史。
- `/api/public/*`：公开摘要、填写会话的创建与恢复，以及正式提交。
- `/api/questions/*`：常用题目、版本、共享、引用与自己的跨问卷单题统计。
- `/api/question-banks/*`：私有分类、成员及版本策略。
- `/statistics`、`/responses`、`/submissions`：按版本统计、文本回答分页和实名提交记录。

所有请求字段、成功响应、鉴权要求、判定顺序和稳定错误码以 [API 说明](docs/API.md) 为准。

## 配置项

| 变量                                     | 示例值                                                                         | 作用                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `API_PORT`                               | `3000`                                                                         | Express 监听端口                                                 |
| `WEB_ORIGIN`                             | `http://localhost:5173`                                                        | 允许访问 API 的前端来源                                          |
| `MONGODB_URI`                            | `mongodb://127.0.0.1:27017/survey_stage1?replicaSet=rs0&directConnection=true` | 从宿主机直连 Compose 单节点副本集；`rs0` 必须与 Compose 配置一致 |
| `JWT_SECRET`                             | 自行生成的至少 32 字符密钥                                                     | HS256 登录令牌签名；弱值、示例值或缺失会拒绝启动                 |
| `ANONYMOUS_ID_SECRET`                    | 与 JWT 不同的至少 32 字符密钥                                                  | 生成问卷内 ownerKey；与 JWT 密钥相同会拒绝启动                   |
| `REGISTER_RATE_LIMIT`                    | `5`                                                                            | 单 IP 在注册窗口内的请求上限                                     |
| `REGISTER_RATE_WINDOW_MS`                | `3600000`                                                                      | 注册限流窗口毫秒数                                               |
| `LOGIN_ACCOUNT_RATE_LIMIT`               | `10`                                                                           | 单 IP 与规范化用户名组合的登录上限                               |
| `LOGIN_IP_RATE_LIMIT`                    | `100`                                                                          | 单 IP 登录总上限，防止密码喷洒                                   |
| `LOGIN_RATE_WINDOW_MS`                   | `900000`                                                                       | 两种登录限流的窗口毫秒数                                         |
| `RATE_LIMIT_MAX_KEYS`                    | `10000`                                                                        | 内存限流键容量；满载时对新键封闭失败                             |
| `TRUST_PROXY`                            | 留空                                                                           | 仅按已知生产代理拓扑设置为跳数或可信地址                         |
| `SURVEY_MAX_PER_USER`                    | `100`                                                                          | 每个用户可创建的问卷数量上限                                     |
| `SURVEY_WRITE_RATE_LIMIT`                | `120`                                                                          | 单用户在问卷写入窗口内的请求上限                                 |
| `SURVEY_WRITE_RATE_WINDOW_MS`            | `60000`                                                                        | 问卷写接口限流窗口毫秒数                                         |
| `JUMP_RULE_MAX_PER_QUESTION`             | `20`                                                                           | 每题跳转规则上限；启动时要求为 1–100 的整数                      |
| `FILL_SESSION_RATE_LIMIT_WINDOW_MS`      | `900000`                                                                       | 创建填写会话的限流窗口；启动时上限为 24 小时                     |
| `FILL_SESSION_RATE_LIMIT_ACCOUNT_IP_MAX` | `20`                                                                           | 单账号与 IP 在窗口内创建填写会话的上限                           |
| `FILL_SESSION_RATE_LIMIT_IP_MAX`         | `100`                                                                          | 单 IP 在窗口内创建填写会话的总上限                               |
| `SUBMISSION_RATE_LIMIT_WINDOW_MS`        | `900000`                                                                       | 正式提交的限流窗口；启动时上限为 24 小时                         |
| `SUBMISSION_RATE_LIMIT_ACCOUNT_MAX`      | `60`                                                                           | 单账号在提交窗口内的活动提交尝试上限                             |
| `SUBMISSION_RATE_LIMIT_SESSION_MAX`      | `10`                                                                           | 单填写会话在提交窗口内的活动提交尝试上限                         |
| `STATISTICS_RATE_LIMIT_WINDOW_MS`        | `60000`                                                                        | 创建者统计、文本分页和实名提交记录的共享限流窗口                 |
| `STATISTICS_RATE_LIMIT_USER_MAX`         | `30`                                                                           | 单用户在统计窗口内的请求上限                                     |
| `STATISTICS_MAX_TIME_MS`                 | `10000`                                                                        | 统计聚合、文本分页和实名提交记录查询的最长执行毫秒数             |
| `SEED_USER_PASSWORD`                     | 留空                                                                           | 本地种子账号密码；运行脚本前填写且必须满足正式密码规则           |

`.env.example` 已包含可用的 `MONGODB_URI` 和 `JUMP_RULE_MAX_PER_QUESTION`；后者在启动时校验为 1–100 的整数。`directConnection=true` 可避免驱动通过副本集拓扑发现改连到容器内部不可解析的地址；部署为多节点副本集时应移除此参数并提供所有可达节点。

浏览器地址栏必须使用 `http://localhost:5173`，与默认 `WEB_ORIGIN` 完全一致。使用 `http://127.0.0.1:5173` 会被认证接口的 Origin 校验拒绝。Vite 已把同源相对路径 `/api` 代理到后端。开发代理会让后端看到代理来源 IP；生产环境不能盲目把 `trust proxy` 设为 `true`。

## 当前测试

- 健康检查覆盖数据库主动探测、断开和超时。
- 认证测试覆盖真实唯一索引、并发注册、登录、会话、Cookie、Origin、输入类型、请求体、限流和统一错误。
- 密码测试覆盖 NFKC、scrypt 档位、假哈希及畸形记录；令牌测试固定 HS256 并拒绝过期、错误密钥和其他算法。
- 前端测试覆盖相对 API、认证错误、不含凭据的单次草稿恢复，以及截止时间的分段解析、ISO 组合、真实日期、时区范围和滚轮步进。
- 问卷测试覆盖事务回滚、直接交叉引用、索引、Unicode 与截止时间、数据隔离、写入限流、数量上限、签名游标、批量版本查询和 revision 并发冲突。
- 题目测试覆盖四种题型、规范化默认值、稳定 ID、Unicode、答案规范化、完整替换、排序、删除、错误顺序、100 题上限和并发写入。
- 前端题目请求按白名单构造；设置与题目共享单一 revision 和写入锁，未保存的其他题目卡片不会因一次保存而丢失。
- 跳转逻辑测试覆盖操作符矩阵、第一条命中、规范答案、默认路径、循环保护、精确不可达模型、稳定最短回路、重复规则和固定种子的惰性路径对拍。
- 跳转 API 测试覆盖整组保存、规则 ID/选项归属、自跳转、引用保护、revision 并发，以及只读发布检查。
- 里程碑 8 覆盖正式提交、先认证后解析、4 MiB 独立上限、路径重算、稳定回答错误、规范化存储、幂等重试、重复限制、事务回滚和并发竞争。
- 里程碑 9 及后续补充覆盖五条聚合、快照一致性、手算指标、数字空值、匿名/实名文本分页、实名提交记录、加密游标、查询边界和内部字段泄露；数据库集成部分需要 Docker MongoDB 运行。
- 当前自动测试总数为共享逻辑包 11 项、API 240 项、Web 50 项，共 301 项（2026-10-25 再次通过）；184 项为保留的第一阶段基线。
- 第一阶段种子保留原演示场景，但账号已含第二阶段资料时拒绝清理；第二阶段独立演示请按维护说明使用 seed:stage2，默认重复运行只验证。

## 设计文档

当前提交入口：[第二阶段完整报告](docs/PROJECT_REPORT_STAGE2.md)、[提交索引](docs/SUBMISSION_STAGE2.md)、[完整系统](docs/SYSTEM_DESIGN_STAGE2.md)、[完整数据库](docs/DATABASE_DESIGN.md)、[第二阶段事实底稿](docs/REPORT_FACT_CHECK_STAGE2.md)。下列第一阶段资料作为保留功能与历史依据。

- [第一阶段项目报告（DOCX）](docs/PROJECT_REPORT.docx)
- [第一阶段项目报告（Markdown 源稿）](docs/PROJECT_REPORT.md)
- [项目报告事实核对表](docs/REPORT_FACT_CHECK.md)
- [AI 使用过程日志](docs/AI_USAGE_LOG.md)
- [需求决策记录](docs/REQUIREMENTS_DECISIONS.md)
- [系统设计](docs/SYSTEM_DESIGN.md)
- [用户账号与身份认证设计](docs/AUTH_DESIGN.md)
- [问卷主体与 v1 草稿设计](docs/SURVEY_DRAFT_DESIGN.md)
- [题目与校验规则设计](docs/QUESTION_DESIGN.md)
- [跳转规则与发布检查设计](docs/JUMP_DESIGN.md)
- [版本发布与生命周期设计](docs/VERSION_LIFECYCLE_DESIGN.md)
- [填写会话与逐题填写设计](docs/FILL_SESSION_DESIGN.md)
- [正式回答提交设计](docs/RESPONSE_SUBMISSION_DESIGN.md)
- [按版本统计与文本回答分页设计](docs/STATISTICS_DESIGN.md)
- [里程碑 10 系统测试计划](docs/MILESTONE10_TEST_PLAN.md)
- [需求—测试追踪矩阵](docs/TEST_TRACEABILITY.md)
- [里程碑 6 版本历史查询执行计划](docs/experiments/MILESTONE6_EXPLAIN.md)
- [里程碑 9 统计聚合执行计划](docs/experiments/MILESTONE9_STATISTICS_EXPLAIN.md)
- [里程碑 10 问卷列表分页执行计划](docs/experiments/MILESTONE10_SURVEY_LIST_EXPLAIN.md)
- [里程碑 10 种子数据核算与幂等验证](docs/experiments/MILESTONE10_SEED_VERIFICATION.md)
- [里程碑 10 自动测试与实验报告](docs/experiments/MILESTONE10_TEST_REPORT.md)
- [API 说明](docs/API.md)
- [分阶段 TODO](TODO.md)

## 第一阶段验收记录

当前已实现创建者完整版本生命周期、公开填写与正式提交，以及严格按已发布版本隔离的统计、文本回答分页和实名提交记录。统计使用只读快照、查询超时、用户限流和 AES-256-GCM 不透明游标；创建者页面可手工刷新指标、按页查看文本回答，并在实名版本中核对每次提交的账号与时间。里程碑 1–10 均已完成自动检查和人工验收；里程碑 10 的追踪矩阵、P1–P5 补缺、种子幂等、执行计划、第一阶段 184 项完整回归和四组人工验收也已全部完成。里程碑 11 的最终 Markdown 文档经人工确认；里程碑 12 已完成 Git 与敏感信息检查、GitHub 推送，以及独立空卷环境中的全新克隆、184 项测试、构建和种子幂等验证。
