# 基于 MongoDB 的版本化问卷系统

本仓库用于数据库系统大作业一。当前仅完成第 1 阶段“项目骨架与开发环境”：Vue 前端、Express 后端、MongoDB 单节点副本集、健康检查、类型检查和基础测试。注册和问卷业务尚未开始。

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
docker/                MongoDB 副本集初始化脚本
docs/                  已确认的需求和系统设计
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

2. 修改 `.env` 中的两个密钥。它们必须不同，且不应提交到 Git：

```text
JWT_SECRET
ANONYMOUS_ID_SECRET
```

3. 启动 MongoDB 单节点副本集：

```bash
docker compose up -d
docker compose ps
```

4. 安装依赖并运行检查：

```bash
npm install
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

| 变量                  | 示例值                                                                         | 作用                                                             |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `API_PORT`            | `3000`                                                                         | Express 监听端口                                                 |
| `WEB_ORIGIN`          | `http://localhost:5173`                                                        | 允许访问 API 的前端来源                                          |
| `MONGODB_URI`         | `mongodb://127.0.0.1:27017/survey_stage1?replicaSet=rs0&directConnection=true` | 从宿主机直连 Compose 单节点副本集；`rs0` 必须与 Compose 配置一致 |
| `JWT_SECRET`          | 自行生成的至少 32 字符密钥                                                     | 后续登录令牌签名密钥                                             |
| `ANONYMOUS_ID_SECRET` | 与 JWT 不同的至少 32 字符密钥                                                  | 后续生成问卷内匿名标识的独立密钥                                 |

`.env.example` 已包含上述可用的 `MONGODB_URI`。`directConnection=true` 可避免驱动通过副本集拓扑发现改连到容器内部不可解析的地址；部署为多节点副本集时应移除此参数并提供所有可达节点。

本阶段只读取前三项；两个密钥先进入配置模板，账号和匿名功能阶段再启用强度检查。

## 当前测试

- API 健康检查不依赖数据库也能返回服务状态。
- 前端可以把四种连接状态转换为明确的中文显示。

## 设计文档

- [需求决策记录](docs/REQUIREMENTS_DECISIONS.md)
- [系统设计](docs/SYSTEM_DESIGN.md)
- [分阶段 TODO](TODO.md)

## 当前边界

这是项目骨架检查点，不包含注册、登录、问卷、题目、填写或统计功能。人工确认本阶段环境后，才进入账号与身份认证阶段。
