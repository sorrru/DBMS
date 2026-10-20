# 基于 MongoDB 的版本化问卷系统

本仓库用于数据库系统大作业一。里程碑 1 至 8 已实现并通过自动检查和人工验收；里程碑 9 按版本统计已实现并通过自动检查，等待人工验收。

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

该命令创建账号 `seed_demo`、含四种题型与有效分支的匿名“已发布 v1 + 草稿 v2”问卷，以及已关闭实名问卷和已到期问卷。重复运行会先清理旧种子数据。只清理种子数据：

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

## 配置项

| 变量                                     | 示例值                                                                         | 作用                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `API_PORT`                               | `3000`                                                                         | Express 监听端口                                                 |
| `WEB_ORIGIN`                             | `http://localhost:5173`                                                        | 允许访问 API 的前端来源                                          |
| `MONGODB_URI`                            | `mongodb://127.0.0.1:27017/survey_stage1?replicaSet=rs0&directConnection=true` | 从宿主机直连 Compose 单节点副本集；`rs0` 必须与 Compose 配置一致 |
| `JWT_SECRET`                             | 自行生成的至少 32 字符密钥                                                     | HS256 登录令牌签名；弱值、示例值或缺失会拒绝启动                 |
| `ANONYMOUS_ID_SECRET`                    | 与 JWT 不同的至少 32 字符密钥                                                  | 后续生成问卷内 ownerKey；与 JWT 密钥相同会拒绝启动               |
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
| `STATISTICS_RATE_LIMIT_WINDOW_MS`        | `60000`                                                                        | 创建者统计和文本分页的共享限流窗口                               |
| `STATISTICS_RATE_LIMIT_USER_MAX`         | `30`                                                                           | 单用户在统计窗口内的请求上限                                     |
| `STATISTICS_MAX_TIME_MS`                 | `10000`                                                                        | 每条统计聚合和文本分页查询的最长执行毫秒数                       |
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
- 里程碑 9 覆盖五条聚合、快照一致性、手算指标、数字空值、匿名/实名文本分页、加密游标、查询边界和内部字段泄露；数据库集成部分需要 Docker MongoDB 运行。
- 当前自动测试总数为共享逻辑包 11 项、API 140 项、Web 22 项。
- 种子脚本可在本地创建匿名/实名既有回答、允许/禁止重复、关闭、到期、旧版本会话、四种题型和有效分支的演示数据，并按受保护的清理顺序重复运行。

## 设计文档

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
- [里程碑 6 版本历史查询执行计划](docs/experiments/MILESTONE6_EXPLAIN.md)
- [里程碑 9 统计聚合执行计划](docs/experiments/MILESTONE9_STATISTICS_EXPLAIN.md)
- [API 说明](docs/API.md)
- [分阶段 TODO](TODO.md)

## 当前边界

当前已实现创建者完整版本生命周期、公开填写与正式提交，以及严格按已发布版本隔离的统计和文本回答分页。统计使用只读快照、查询超时、用户限流和 AES-256-GCM 匿名游标；创建者页面可手工刷新指标并按页查看文本回答。里程碑 9 尚待人工界面与网络响应验收。
