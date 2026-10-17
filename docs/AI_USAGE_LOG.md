# AI 使用与人工检查日志

## 记录规则

每轮记录提示目标、AI 产出、检查结果和修改。自动检查与人工检查分开记录；AI 运行成功不能替代项目负责人的人工验收。

## 2026-10-16 需求理解

### 人工提示目标

阅读桌面中的第一阶段作业要求，重点保留人与 AI 的阶段性交互、提示词、人工检查和修改过程，并完成前端、后端、配置、实验和 README。

### AI 产出

AI 读取原始 DOCX 后曾一次性生成完整草稿。项目负责人指出该方式没有留下真实的阶段检查过程。

### 人工检查与修改

- 人工否决“一次全部完成”的推进方式。
- 完整草稿移入 `draft/stage1-ai-initial` 分支。
- `main` 恢复为空白起点。
- 后续改为逐阶段讨论、实现、检查和修改。

## 2026-10-16 需求决策

### AI 提出的待澄清问题

匿名含义、重复填写范围、发布后修改、版本统计、关闭与到期、跳转冲突、跳转循环、被跳过必答题、匿名身份识别、历史题目删除和手机号类型。

### 人工决定

- 匿名是对创建者匿名，填写者仍须登录。
- 使用问卷内匿名标识，不直接保存 UID。
- 重复填写开关按版本生效。
- 发布后修改产生下一版本草稿。
- 旧版本填写会话保留 30 分钟。
- 手工关闭和自动到期使用不同状态。
- 跳转冲突取第一条，循环在发布时禁止。
- 路径外必答题不校验、不保存答案。
- 手机号使用文本和数字字符校验。

详细结果见 `REQUIREMENTS_DECISIONS.md`。

## 2026-10-16 系统设计

### AI 候选方案

AI 提出 Vue 3、TypeScript、Express 5、MongoDB 8.0，以及 `users`、`surveys`、`survey_versions`、`fill_sessions`、`responses` 五集合设计。

### 人工检查

项目负责人检查后确认 T1、D1 至 D10、F1、X1 全部采用，无文字或字段修改意见。

详细结果见 `SYSTEM_DESIGN.md`。

## 2026-10-16 项目骨架与开发环境

### 人工提示目标

设计文档检查无误，继续下一阶段，但仍需在阶段完成后暂停等待检查。

### AI 产出

- Vue 3、Vite、TypeScript 前端骨架。
- Express 5、TypeScript 后端骨架。
- MongoDB 8.0.34 单节点副本集 Compose 配置。
- 环境变量模板和独立密钥配置位。
- `/api/health` 健康检查。
- 前端 API 与 MongoDB 状态页面。
- 类型检查、测试、构建和格式命令。
- 从零启动说明。

### AI 检查发现的问题

最初根据注册表最新版本选择 TypeScript 7.0.2。运行 `vue-tsc` 时发现当前 Vue 类型检查器不能使用 TypeScript 7 的内部导出路径，导致前端类型检查失败。

### AI 修改

将前后端 TypeScript 固定为 5.9.3，重新安装并验证。修改后：

- API 类型检查通过。
- Web 类型检查通过。
- API 测试 1 项通过。
- Web 测试 1 项通过。
- API 与 Web 生产构建通过。
- Prettier 检查通过。
- npm 安全审计为 0 个已知漏洞。
- 使用本机临时 MongoDB 单节点副本集验证 API 与数据库均显示“已连接”。
- 浏览器状态页面显示 Express API 与 MongoDB 均已连接。

### 尚待人工检查

- 当前机器没有 Docker 命令，AI 未直接运行 `docker compose up`。
- 项目负责人需按照 README 在自己的 Docker 环境从零启动。
- 项目负责人需检查状态页面的文字、布局和连接结果。
- 如发现问题，在本节追加人工意见和修改结果。

### 第一轮人工审阅意见

项目负责人审阅 README 后发现：四种连接状态未定义，缺少 `degraded` 响应示例；Node.js 只写了大版本；依赖版本需要与锁文件和 Compose 镜像复核；未说明单节点副本集的设计理由；`MONGODB_URI` 缺少可直接使用的示例。

### 根据人工意见修改

- 定义 `connected`、`connecting`、`disconnected`、`unknown` 的来源和含义，补充数据库断开和重连时的降级响应。
- 将 `.nvmrc` 与 `engines.node` 精确固定为 Node.js 24.19.0。
- 复核版本时发现工作区使用 TypeScript 5.9.3，但根依赖树仍为 `vue-tsc` 解析了 TypeScript 7.0.2；在根项目同步固定 5.9.3，避免声明版本与实际类型检查器不一致。
- 逐项核对 npm 锁文件和 Compose 中的 MongoDB 8.0.34 镜像标签。
- 说明单节点副本集用于支持跨集合多文档事务。
- 在配置表中加入带 `replicaSet=rs0&directConnection=true` 的宿主机连接示例及参数解释。

### 修改后复验

- `package-lock.json` 中 TypeScript、Express、Vitest、Vite、Vue 和 Mongoose 的实际版本与 README 一致。
- `docker-compose.yml` 中两个 MongoDB 服务均使用 `mongo:8.0.34`。
- 根项目、API、Web、Vue 和 `vue-tsc` 均解析到 TypeScript 5.9.3。
- 前后端类型检查通过，API 与 Web 测试各 1 项通过，生产构建通过，Prettier 检查通过。
- npm 安全审计仍为 0 个已知漏洞。

### 第一次人工从零启动检查

项目负责人在 macOS 终端执行 `node -v`、`npm -v`、`docker --version`、`docker compose version` 和 `docker info`，实际结果为：

- Node.js：26.8.2，与项目固定的 24.19.0 不一致。
- npm：11.19.1。
- `docker`、`docker compose` 和 `docker info`：均提示 `command not found`。

AI 随后只读检查本机环境，确认 Homebrew 位于 `/opt/homebrew/bin/brew`，未检测到 nvm、Docker Desktop 或 OrbStack。由于前置条件尚未满足，本次检查不能标记为“人工从零启动通过”，TODO 中该项继续保持未完成。

### 第二次人工环境检查

项目负责人安装并启动 Docker Desktop，确认 Docker CLI、Compose 和 Server 均正常；当前 0 个容器和 0 个镜像符合首次使用预期。随后确认项目目录和 Git 仓库正常，`node_modules` 已被 `.gitignore` 忽略。

本机此时通过 nvm 使用 Node.js 24.22.0 和 npm 11.19.1。由于 24.22.0 与项目原先固定的 24.19.0 属于同一 Node.js 24 LTS 版本线，且是人工实际验证环境，项目将 `.nvmrc`、`engines.node`、锁文件和 README 统一更新为 24.22.0，避免为旧补丁版重复安装运行时。

### 人工发现运行中断库状态错误

项目负责人在手工停止数据库后发现健康检查仍返回 `connected`，并通过代码审阅指出：原实现只读取 Mongoose 的被动 `readyState`；自定义 5 秒重连只覆盖首次连接失败，README 却把它描述成所有断线场景。

AI 先增加回归测试，复现“驱动仍显示连接但数据库无法响应”时缺少主动检查的问题；随后新增带 2 秒应用级超时的 MongoDB `ping`，将健康路由改为异步等待真实探测结果，并修正 README 对首次连接重试与运行中驱动恢复的边界说明。

修改后新增的 3 项数据库状态测试全部通过，完整 API 与 Web 测试共 5 项通过，类型检查、格式检查和生产构建通过。第一次现场复验受到宿主机 Homebrew MongoDB 占用 27017 的干扰，API 实际连接的不是被停止的 Docker 容器，因此该轮结果作废。随后将临时测试容器隔离到 27018：停库前健康检查返回 `ok/connected`，停库后连续 5 次均返回 `degraded/disconnected`。测试 API、临时容器、网络和临时覆盖文件均已清理；没有停止宿主机 MongoDB，也没有操作另一目录的遗留容器。

## 2026-10-17 人工统一数据库环境

项目负责人确认前一天在 `/Users/a1234/dbms-fresh-check` 副本目录做过启动检查，该目录留下一个已停止的 `survey-stage1-mongodb` 容器。人工随后停止 Homebrew `mongodb-community` 服务并确认 27017 端口已释放，再启动 Docker Desktop，确认 Docker Client、Server 和 Compose 正常。

为避免不同检出目录因固定容器名互相冲突，原项目从 `docker-compose.yml` 移除 `container_name`。MongoDB 初始化仍通过 Compose 服务名 `mongodb` 通信，不依赖固定容器名；Docker 将按 Compose 项目自动生成隔离的容器名称。

### 里程碑 1 人工验收结果

项目负责人在原项目目录完成以下真实操作：

- 使用 nvm 切换到 Node.js 24.22.0，npm 版本为 11.19.1。
- 使用 `npm ci` 根据锁文件重新安装 214 个包，安全审计为 0 个已知漏洞。
- 前后端类型检查通过；API 4 项测试和 Web 1 项测试通过；生产构建与 Prettier 检查通过。
- 使用 Docker Compose 启动 MongoDB 8.0.34 单节点副本集；数据库容器状态为 `healthy`，初始化容器以退出码 0 完成。
- 启动前后端后，浏览器状态页显示 Express API 与 MongoDB 均为“已连接”。
- 人工停止 MongoDB 容器后，页面正确显示 API“已连接”、MongoDB“未连接”。
- 重新启动并等待 MongoDB 健康后，页面恢复为 API 与 MongoDB 均“已连接”。

人工提供了停库前后及恢复后的终端输出和页面截图。至此，里程碑 1“项目骨架与开发环境”通过人工验收，可以进入里程碑 2 的设计讨论。

## 2026-10-16 TODO 第一轮人工审阅

### 人工审阅意见

项目负责人对开发清单提出 14 项修改，重点包括：明确匿名版本的去重索引与匿名标识作用域；定义填写会话状态机；补充限流、输入体积和 CORS；增加索引执行计划、事务失败回滚与种子数据；从身份认证开始持续维护 API 错误码；避免事后集中补写提示词；解决“第一阶段”与内部阶段编号冲突；调整最终测试、README、Git 检查、目标周次和下一步说明。

### 根据人工意见修改

- 将内部开发单元统一改称“里程碑”，文件改名为“开发里程碑 TODO”，保留“第一阶段”仅表示课程作业阶段。
- 明确匿名标识按问卷生成，同一问卷跨版本稳定、不同问卷不同；匿名禁止重复时，条件唯一索引中的身份键只来自 `respondentKey`，不使用 UID。
- 定义填写会话的 `active`、`submitted`、`expired` 有效状态以及原子提交条件。
- 在身份认证和创建填写会话里程碑加入限流，并补充请求体积与严格 CORS 检查。
- 加入事务中途失败完全回滚测试、查询与聚合的 `explain("executionStats")` 证据，以及可重复执行和清理的种子数据脚本。
- 规定从里程碑 2 起持续维护 `docs/API.md` 与错误码，并随做随记 AI 和人工交互日志。
- 将里程碑 10 改为测试补缺、完整回归和实验整理，不替代各里程碑自己的测试。
- 将里程碑 11 改为按最终代码更新 README、API 文档和报告，并最终核对日志完整性。
- 为全部里程碑安排相对目标周次，对重任务单独留整周，并在 GitHub 交付后保留一周缓冲。
- 在 GitHub 交付中加入 `git log`、`.gitignore`、已跟踪环境文件、全新克隆和种子数据检查。
