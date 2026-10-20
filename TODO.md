# 开发里程碑 TODO

## 使用方式

本清单服务于课程作业的“第一阶段”，内部用“里程碑”表示可独立检查的开发单元，避免把作业阶段与开发步骤混淆。每个里程碑遵循同一流程：

```text
确认本里程碑目标
→ AI 实现最小范围
→ 运行测试并提交检查材料
→ 人工检查和提出修改
→ AI 修改并复测
→ 人工确认
→ 记录本轮提示词和修改原因
→ 再进入下一里程碑
```

未经人工确认，不提前进入后续里程碑。完成状态必须以代码、测试结果或人工检查记录为依据。每个里程碑都必须同步编写和运行本里程碑测试；里程碑 10 只补测试缺口、执行完整回归并整理实验记录，不把关键测试推迟到最后。

从里程碑 2 起维护 `docs/API.md`。新增或修改接口时，同步记录请求、响应、鉴权要求和稳定错误码；不在里程碑 11 集中补写。每轮真实提示词、AI 产出、人工意见和修改结果也随做随记，禁止事后虚构过程。

## 目标周次

以下是相对项目开始时间的建议安排，确定课程截止日后再换成具体日期。最晚应在截止日前一周完成里程碑 12，把最后一周完整保留为修复和提交缓冲。

|         里程碑 | 目标周次    | 安排说明                                 |
| -------------: | ----------- | ---------------------------------------- |
|     0 设计基线 | 第 1 周     | 已完成                                   |
|     1 项目骨架 | 第 1 周     | 已完成并通过人工从零启动检查             |
|     2 身份认证 | 第 2 周     | 同时建立 API 文档和错误码表              |
|     3 问卷草稿 | 第 2 周     | 建立可重复执行的种子数据脚本             |
|     4 题目校验 | 第 3 周     | 完成全部题型与边界测试                   |
|     5 跳转规则 | 第 4 周     | 重任务，整周完成规则、图检查和发布前验证 |
|     6 版本发布 | 第 5 周前半 | 包含事务成功与强制失败回滚测试           |
|     7 填写会话 | 第 5 周后半 | 完成会话状态机、限流和旧版本固定         |
|     8 提交并发 | 第 6 周     | 重任务，整周完成路径校验、去重和并发测试 |
|     9 版本统计 | 第 7 周     | 重任务，整周完成聚合、索引证据和人工核算 |
|    10 系统验收 | 第 8 周     | 只补测试缺口、完整回归并整理实验记录     |
|    11 文档报告 | 第 9 周     | 按最终代码核对和更新材料                 |
| 12 GitHub 交付 | 第 10 周    | 单独完成历史检查、全新克隆与从零验证     |
|       提交缓冲 | 第 11 周    | 不安排新功能，只处理复核问题和提交故障   |

## 里程碑 0：设计基线

- [x] 阅读第一阶段原始要求。
- [x] 澄清匿名、重复填写、版本、关闭、到期和跳转规则。
- [x] 确认被跳过的必答题处理方式。
- [x] 确认手机号使用文本和数字字符校验。
- [x] 确认技术栈和五集合架构。
- [x] 编写需求决策记录。
- [x] 编写系统设计文档。
- [x] 人工检查两份设计文档的文字和字段命名。
- [x] 根据人工意见修改设计文档。本轮人工检查无修改意见。
- [x] 人工确认设计基线可以进入编码。

检查材料：

- `docs/REQUIREMENTS_DECISIONS.md`
- `docs/SYSTEM_DESIGN.md`

## 里程碑 1：项目骨架与开发环境

目标：只搭建可启动的前后端和 MongoDB 环境，不实现业务功能。

- [x] 创建前端 Vue 3、Vite、TypeScript 项目。
- [x] 创建后端 Express 5、TypeScript 项目。
- [x] 配置代码格式、类型检查和测试命令。
- [x] 配置 MongoDB 8.0 单节点副本集。
- [x] 编写 `.env.example`，区分 JWT 密钥和匿名标识密钥。
- [x] 创建 `/api/health` 健康检查接口。
- [x] 前端显示后端和数据库连接状态。
- [x] 编写从零启动说明。
- [x] 运行安装、类型检查、测试和启动验证。
- [x] 人工按 README 从零启动并检查：完成依赖重装、自动检查、页面验收、停库降级和恢复连接验证。
- [x] 记录第一次人工环境检查：本机 Node.js 为 26.8.2，且尚无 Docker 命令，因此未满足从零启动前置条件。
- [x] 记录第一轮人工发现的 README 问题和修改。

本里程碑交付：可启动空项目、配置说明、环境验证记录。

## 里程碑 2：用户账号与身份认证

目标：实现注册、登录和当前用户查询，暂不创建问卷。

- [x] 定义 `users` schema 和唯一索引。
- [x] 实现 ASCII 用户名校验、小写规范化和 `usernameNormalized` 唯一索引。
- [x] 使用异步 `crypto.scrypt` 实现带参数版本、随机盐和恒时比较的密码哈希。
- [x] 密码先做 NFKC 规范化；生产只允许固定 scrypt 参数档位，测试通过依赖注入使用低成本档位。
- [x] 使用预生成的同档位假哈希处理不存在用户，并安全拒绝参数超限、畸形记录和长度不符。
- [x] 启动时校验两个密钥至少 32 字符、互不相同且不是示例占位值，不满足时拒绝启动。
- [x] 实现注册接口。
- [x] 实现登录接口。
- [x] 实现 `GET /api/auth/me`。
- [x] 实现 `POST /api/auth/logout`。
- [x] 实现认证中间件和统一错误格式。
- [x] 增加 `/api` 未知路由的 JSON `404 NOT_FOUND`，统一处理顺序和响应结构。
- [x] JWT 只保存 `sub` 和标准时间、签发者、受众声明，固定使用并验证 `HS256`。
- [x] 使用 `HttpOnly`、`SameSite=Lax` Cookie，并区分开发/生产的 `Secure`。
- [x] 固定 Cookie 名为 `survey_session`；成功响应只返回用户的 `id`、`username` 和 `registeredAt`。
- [x] 创建 `docs/API.md`，记录认证接口的请求、响应、鉴权要求和稳定错误码表。
- [x] 为注册、登录账号组合和登录 IP 总量配置环境变量驱动的限流，并提供仅测试代码可调用的计数清理方法。
- [x] 为内存限流存储实现过期清理、容量上限和满载封闭失败；记录多实例迁移到 Redis 的边界。
- [x] 设置 JSON 请求体积上限，对超限请求返回统一错误码。
- [x] 注册和登录只接受 `application/json`，退出接口免除 Content-Type；把畸形 JSON 映射为 `VALIDATION_ERROR`，非 JSON 映射为 `UNSUPPORTED_MEDIA_TYPE`。
- [x] 将 CORS 限制到配置的来源、允许的方法和请求头，并对所有非安全方法校验 `Origin`。
- [x] 固定中间件顺序：Origin → Content-Type → JSON 解析 → 字段校验 → 限流 → 业务 → 404 → 错误处理。
- [x] 配置 Vite `/api` 开发代理，前端使用同源相对路径和 Cookie credentials。
- [x] 记录 `WEB_ORIGIN` 必须与地址栏完全一致，并为生产可信反向代理提供受限 `trust proxy` 配置。
- [x] 实现前端注册和登录页面。
- [x] 收到 `AUTH_REQUIRED` 或 `AUTH_INVALID` 时跳转登录，并为后续编辑页面提供不含凭据的草稿恢复机制。
- [x] 捕获 MongoDB `11000` 并核对 `keyPattern.usernameNormalized`，实现并发注册同一用户名只成功一次。
- [x] 测试前通过 `UserModel.init()` 确认唯一索引已建立。
- [x] 编写注册、重复用户名、并发注册、错误密码、NoSQL 注入和令牌测试。
- [x] 测试 Cookie 属性、Origin/CSRF、媒体类型、畸形 JSON、请求体上限和限流。
- [x] 测试错误密钥、`alg: none`、其他算法及用户已删除的有效令牌。
- [x] 测试假哈希调用、scrypt 参数上限、畸形哈希、固定响应字段和 JSON 404。
- [x] 检查数据库中不存在明文密码。
- [x] 人工检查登录流程和错误提示：注册、刷新恢复、退出、大小写归一登录、错误密码和重复用户名均确认无问题。
- [x] 记录本里程碑 AI 使用和人工修改；人工界面检查和后续修改结果待追加。

本里程碑交付：完整登录闭环和账号测试证据。

## 里程碑 3：问卷主体与 v1 草稿

目标：用户可以创建问卷并编辑第一版基本设置，暂不添加题目。

- [x] 定义 `surveys` schema。
- [x] 定义 `survey_versions` 基础 schema，并增加从 1 开始的 `revision`。
- [x] 为问卷建立 `publicId` 唯一索引和 `{ ownerId: 1, updatedAt: -1, _id: -1 }` 列表索引。
- [x] 建立 `{ surveyId: 1, status: 1 }` 的 draft 条件唯一索引，并在事务开始前完成两个 Model 的 `init()`。
- [x] 使用 `withTransaction` 和预生成的两个 ObjectId 原子创建问卷与 v1 草稿，直接互相引用。
- [x] 使用至少 128 位随机 URL 安全 `publicId`，只用唯一索引兜底，不在事务内局部重试。
- [x] 所有事务数据库操作显式传递同一 session；强制失败注入只由测试替换数据库方法提供，生产不暴露入口。
- [x] 配置默认每用户 100 份问卷上限，达到时返回 `SURVEY_LIMIT_REACHED`；记录极端并发可略微超限的边界。
- [x] 对创建、改管理名称和保存草稿实施可配置的每用户写限流。
- [x] 实现“我的问卷”游标列表：默认 20、最多 50、多取一条、稳定排序和带签名的不透明游标。
- [x] 一页列表通过一次 `$in` 批量查询草稿及当前版本摘要，禁止 N+1 查询。
- [x] 实现问卷与版本摘要接口。
- [x] 增加 `PATCH /api/surveys/:surveyId`，只修改内部管理名称，不联动公开标题。
- [x] 实现草稿 PATCH：revision 必填、只修改已提供字段、`deadline: null` 清除、空修改与未知字段拒绝。
- [x] 按 Unicode 码点校验管理名称、标题和说明，并加入 emoji 边界测试。
- [x] 截止时间只接受带时区的 ISO 8601 字符串或 `null`，按 UTC 保存并拒绝对象式输入。
- [x] 截止时间必须晚于保存时刻且不超过 5 年。
- [x] 名称和标题 trim 后不能为空且拒绝换行/控制字符；说明允许换行但拒绝其他控制字符。
- [x] 草稿条件更新与 `surveys.updatedAt` 同事务完成，成功返回递增后的 revision。
- [x] 每次成功保存同时刷新版本 `updatedAt`，响应返回 `surveyUpdatedAt`。
- [x] 条件更新失败后区分 `SURVEY_NOT_FOUND`、`VERSION_NOT_EDITABLE` 和 `DRAFT_CONFLICT`。
- [x] 实现用户数据隔离，合法但非所有者的资源统一返回 404；响应不含 `ownerId` 或 `__v`。
- [x] 实现问卷列表和基础设置前端，全部文本只用纯文本渲染，不使用 `v-html`。
- [x] 使用明确保存按钮、未保存提醒和保存时间，不实现自动保存。
- [x] 设计并实现更符合人类输入习惯的截止时间控件：年份和分钟手动输入，月、日、小时和时区滚动选择；提交时仍转换为带时区的 ISO 8601 字符串。
- [x] 为登录密码和注册确认密码增加可访问的显示/隐藏按钮。
- [x] 人工检查截止时间的混合输入、无截止时间、无效日期提示、时区换算、密码显示按钮和半屏布局；确认通过。
- [x] 使用包含 surveyId、versionId、revision 的 `sessionStorage` 安全草稿键，恢复前显示字段对比并要求确认，保存后清除。
- [x] 创建可重复执行的 `seed`/`seed:clean` 脚本，生成测试账号及匿名、实名 v1 草稿。
- [x] 种子脚本在生产或非本地 MongoDB 上拒绝运行，并按 responses → fill_sessions → survey_versions → surveys → users 组织可扩展清理。
- [x] 编写创建成功、事务强制失败回滚、字段边界、越权访问和响应字段测试。
- [x] 编写相同 revision 并发 PATCH 测试，确保恰好一个 200、一个 409。
- [x] 编写分页参数边界、稳定分页、游标篡改和索引建立测试，记录编辑中翻页为弱一致的已知特性。
- [x] 列表一次批量取得 `draftVersionId` 与 `currentVersionId` 对应摘要，测试不存在 N+1；里程碑 9 保存 `explain()` 证据。
- [x] 测试数据库使用独立 `_test` 库；清库前校验测试环境、普通 MongoDB URI、全部本地主机和库名。
- [x] 前端测试保存时只发送修改字段，不重新提交未修改但已过期的 deadline。
- [x] 在 `docs/API.md` 预先记录已确认的问卷主体、草稿接口及三个新错误码，实现后继续同步。
- [x] 人工检查问卷创建、草稿保存、字段错误位置、按钮文案和半屏布局；用户隔离仍由自动集成测试覆盖。
- [x] 记录本里程碑 AI 使用和人工修改；已记录首轮界面意见、修改和复查结果。

本里程碑交付：无题目的 v1 草稿管理功能。

## 里程碑 4：题目与校验规则

目标：完成四种答案形态和数据驱动校验，暂不实现跳转。

- [x] 完成并人工确认 `docs/QUESTION_DESIGN.md`，采用 D1–D12 并根据两轮人工意见固定接口、默认值、错误顺序和并发规则。
- [x] 定义嵌套 `questions`、`options` 和按题型区分的 `validation` schema，关闭子文档自动 `_id`。
- [x] 要求请求始终提供 `validation` 对象；补齐所有缺省字段并把规范形式写入数据库，禁止发布版本依赖运行时代码默认值。
- [x] 删除题目 `order` 字段，以 `questions` 数组作为唯一顺序；固定选项结构为 `{ optionId, text }`，`jumpRules` 在本里程碑恒为 `[]`。
- [x] 服务端生成并校验稳定的 `q_...` questionId 与 `o_...` optionId；创建请求拒绝客户端 ID，修改请求拒绝重复、伪造或借用其他题目的 optionId，生成碰撞时在内存重试。
- [x] 题目和选项先做 NFC 规范化，再 trim、按 Unicode 码点计数和区分大小写比较；拒绝 Cc 与双向控制符，保留 ZWJ。
- [x] 将里程碑 3 的名称、标题、说明同步为 NFC 与相同控制字符规则，说明继续允许中间换行。
- [x] 实现每版本 100 题上限、题目/选项长度和规范化后的重复选项校验。
- [x] 实现单选题，答案使用属于该题的单个 optionId。
- [x] 实现多选题：`minSelections` 默认 1、`maxSelections` 默认选项数，并校验 `1 ≤ min ≤ max ≤ 选项数`。
- [x] 实现文本题：`minLength` 默认 0、`maxLength` 默认及硬上限 2000；答案 trim 后校验和保存，`digitsOnly` 只接受 ASCII `0-9`。
- [x] 实现手机号文本题示例，验证前导零保留并拒绝全角数字和阿拉伯-印度数字。
- [x] 实现数字题：有限数值、安全范围、整数、最小值和最大值；接受 `-0` 但规范化为 `0`，拒绝 `Infinity`。
- [x] 将题目定义校验和纯答案函数 `validateAnswer(question, value)` 分开；成功返回 `{ ok: true, value, answered }`，失败返回 `{ ok: false, path, reason }`。里程碑 5 建立共享工作区时把已验收实现原样提取为前后端唯一实现。
- [x] 实现 `POST .../questions`，新增题目返回 `201`、完整版本、新 `questionId` 与 `surveyUpdatedAt`。
- [x] 实现题目完整替换 PATCH，明确拒绝 `type`、`questionId`、`jumpRules` 和未知字段，不与旧定义局部合并。
- [x] 前端按白名单构造完整替换请求，不展开响应对象；测试不发送 `type`、`questionId`、`jumpRules`，并显式发送 `required`。
- [x] 实现带 JSON `{ revision }` 请求体的题目 DELETE；缺少 revision 返回 `VALIDATION_ERROR`。若 Vite 代理实测丢失请求体，统一改为 `?revision=`。
- [x] 实现独立的 `PUT .../question-order`，要求提交与当前集合完全一致的完整 questionIds 数组。
- [x] 固定 questionId 格式错误为 `VALIDATION_ERROR`、格式正确但不存在为 `QUESTION_NOT_FOUND`；新增 `QUESTION_LIMIT_REACHED`。
- [x] 严格采用“请求格式 → 资源不存在 → 非草稿 → revision 冲突 → 题目不存在 → 业务规则”的错误判定顺序。
- [x] 固定字段错误 `details.path` 格式，例如 `validation.maxSelections`、`options[2].text` 和 `questionIds[3]`。
- [x] 读取版本后在内存构造并校验完整 questions，以 revision 条件整体写回；版本和问卷更新时间在同一 `withTransaction` 中更新。
- [x] 把问卷写限流默认值调整为每用户每 60 秒 120 次，并同步环境示例、README 和测试；所有问卷与题目写接口共享计数。
- [x] 确认 CORS 允许方法包含 `POST`、`PUT`、`PATCH`、`DELETE` 及预检 `OPTIONS`。
- [x] 实现逐张明确保存的题目编辑前端；未满足规则的新卡片保留在本地，不因保存失败丢失。
- [x] 页面只维护一个版本 revision；任一设置或题目写入进行中时，同时禁用保存设置与全部题目操作，成功后更新共享 revision。
- [x] 实现上移、下移按钮，每次点击发送一次完整排序请求；题目与选项始终使用纯文本渲染。
- [x] 测试题目定义和答案校验边界：缺省值规范落库、NFC、Cc/双向控制符/ZWJ、ASCII/全角/阿拉伯-印度数字、`Infinity`、`-0` 和安全数值范围。
- [x] 测试必答文本纯空白失败、trim 后值落库且中间换行保留，以及单选/数字类型错误、多选重复或借用其他题 optionId。
- [x] 测试带 `type`、`questionId`、`jumpRules`、未知字段的请求被拒绝，以及重复、伪造或其他题 optionId 不可使用。
- [x] 测试 PATCH 缺少 `required` 返回 400；前端白名单请求不回传只读字段。
- [x] 测试 reorder 缺少、重复、多余 ID，题目 ID 格式错误和不存在、字段错误路径、只有一道题和相同顺序仍成功并递增 revision。
- [x] 通过 Vite 代理实测 DELETE JSON 请求体未被丢弃。
- [x] 测试第 101 题返回 `QUESTION_LIMIT_REACHED`，约 40 KiB UTF-8 的最坏体积单题可保存；121 KiB 转义 JSON 和完整版本低于限制的结论已记录在设计估算中。
- [x] 测试相同 revision 的并发写恰好一个成功；99 题并发新增后恰好 100 题且不会超限。99/100 题状态直接写入受保护测试库，不循环调用接口。
- [x] 扩展种子数据，包含全部题型、手机号和典型校验边界。
- [x] 在 `docs/API.md` 记录并同步题目接口、完整替换语义、校验失败响应和两个新错误码。
- [x] 人工创建一份包含全部题型的问卷，并检查逐题保存、字段错误、未保存卡片保留、设置交替保存、移动、删除和窄屏布局。
- [x] 随实现记录本里程碑 AI 使用、人工设计修改、自动检查和最终人工验收结果。

本里程碑交付：可编辑但尚未发布的完整问卷草稿。

## 里程碑 5：跳转规则与发布检查

目标：实现数据驱动跳转，并在发布前发现错误。

- [x] 完成 `docs/JUMP_DESIGN.md` 两轮候选设计，根据人工审阅修正默认边、稳定循环报告、规范答案、共享包落地、发布防御检查和性质测试；等待再次人工确认后实现。
- [x] 新增无框架依赖的 `packages/survey-logic` workspace，前后端共享规范类型、`validateAnswer`、`evaluateNextQuestion`、`computePath` 和 `validateForPublish`，不保留工作区私有副本。
- [x] 共享包使用 ESM 和 `.js` 导入，编译到 `dist`，在 `package.json` 中提供指向产物的 `main`、`types` 和 `exports`；根构建显式按共享包 → API → Web 执行。
- [x] 开发命令先构建一次共享包，再并行监视共享包、API 和 Vite；人工界面检查确认开发环境能接收前端变更。
- [x] 建立共享包时原样提取已经验收的 `validateAnswer`，保持里程碑 4 的返回结构、规范化行为和全部回归测试，从此只维护这一处实现。
- [x] 定义关闭自动 `_id` 的扁平 `jumpRules` schema：`{ ruleId, operator, value, targetQuestionId }`，服务端生成稳定 `r_...` ID。
- [x] 规则完整替换时拒绝重复、伪造或借用其他题的 ruleId；新规则不接受客户端 ID，保留规则必须使用来源题原 ID。
- [x] 增加 `JUMP_RULE_MAX_PER_QUESTION=20`；启动时校验为 1–100 的整数，否则拒绝启动，并同步 `.env.example`、README 和配置测试；第 21 条返回 `VALIDATION_ERROR`。
- [x] 实现单选 `equals`，条件值必须是来源题已有 optionId。
- [x] 实现多选 `contains`、`containsAll`、`containsAny`；数组非空、无重复、不超过选项数，并按来源题选项顺序规范存储。
- [x] 实现数字 `equals`、`gt`、`gte`、`lt`、`lte`；只检查安全有限数值，不依赖题目整数或上下界设置，`-0` 规范为 `0`，equals 使用精确数值比较。
- [x] 明确未回答时全部规则不匹配并走默认边；非规范答案不转换、不抛异常，按未回答路由，之后由 `validateAnswer` 拒绝；第一条命中优先，最后一题无命中返回 `{ kind: "end" }`。
- [x] 实现带已访问节点保护的 `computePath`，异常循环返回结构化错误而不死循环。
- [x] 实现整组保存的 `PUT .../questions/:questionId/jump-rules`，成功后 revision 加一并在同一事务更新问卷时间。
- [x] 接入既有六步错误顺序：来源题不存在使用 `QUESTION_NOT_FOUND`；目标、条件选项或自跳转无效时使用带具体 path 的 `VALIDATION_ERROR`。
- [x] 题目 PATCH 保留已有 jumpRules；删除被规则引用的选项返回 `OPTION_REFERENCED`，删除被其他规则指向的题目返回 `QUESTION_REFERENCED`，不静默级联。
- [x] 两类引用错误固定返回 `details.references: { questionId, ruleId }[]`，属于第 6 步业务规则。
- [x] 构建发布检查精确图：必答单选规则覆盖全部选项时移除默认边；非必答单选、多选、数字和未完全覆盖的单选保守保留默认边。
- [x] 稳定检测循环规则边：来源可达、目标位于来源之前且目标在精确图中能回到来源；为每条规则返回 BFS 最短回路，不依赖 DFS 遍历顺序。
- [x] 所有阻止项和警告使用固定排序；题目结果带 questionId，规则结果再带 ruleId，避免只靠易变化的数组下标定位。
- [x] 实现不可达题目警告；覆盖 Q1 必答单选的全部选项均跳到 Q3、从而 Q2 不可达的用例。
- [x] 实现重复条件 `SHADOWED_RULE` 警告；数组值按集合比较并忽略顺序，不分析更复杂的逻辑包含关系。
- [x] 实现发布检查 `POST .../validate`：请求带 revision，只允许草稿，不修改文档或 revision，正常检查始终返回 200，响应回显被检查的 revision。
- [x] 防御性复核目标题、选项归属、题目/选项/规则 ID 全局唯一，以及题数、选项数和规则数上限；失败产生 `INVALID_STRUCTURE`。
- [x] 发布阻止项包括 `INVALID_STRUCTURE`、`EMPTY_SURVEY`、`JUMP_CYCLE`、`DEADLINE_PASSED`；警告包括 `QUESTION_UNREACHABLE`、`SHADOWED_RULE`。
- [x] 固定 `DEADLINE_PASSED.path=deadline`；SHADOWED_RULE 指向被遮蔽规则，并在消息中指出遮蔽它的规则位置。
- [ ] 里程碑 6 的发布事务复用同一 `validateForPublish` 对事务内最新草稿重新检查，不信任旧检查结果。
- [x] 前端规则区只引用已保存选项；题目存在未保存选项改动时禁用规则区并提示先保存。
- [x] 前端目标选择只列后续题目，使用“题号 + 标题”；重排造成潜在回跳时即时提示。
- [x] 实现规则添加、删除、上下移动和整组保存；与设置、题目共用单一 revision 和写入锁。
- [x] 实现发布检查界面，区分阻止项和警告，点击结果通过稳定 ID 定位；任一写入成功后清除旧 revision 的结果。
- [x] 测试题型与操作符完整矩阵、数字边界、第一条命中、未回答默认边和最后一题结束。
- [x] 测试伪造/重复/借用 ruleId、文本题非空规则、规则上限、无效目标、自跳转、外来选项和稳定 details.path；数组型值乱序提交后按来源选项顺序存储。
- [x] 测试直接回跳循环、间接循环、排序后回跳、不可达、空问卷、无效内部结构、重复规则、稳定结果顺序与最短回路，以及 validate 不写库、非草稿和 revision 冲突。
- [x] 测试被引用题目和选项不可删除、题目 PATCH 保留规则，以及相同 revision 并发 PUT 恰好一个成功。
- [x] 在固定种子的 2–7 题随机小问卷上沿实际路径惰性枚举答案；断言实际访问题属于图可达集合、图无环则实际路径均无环，并统计图有环时实际循环答案的比例。必答题不加入未回答候选。
- [x] 完成共享包后重新执行 README 的全新 `npm ci`、类型检查、完整测试和生产构建；人工开发环境检查确认页面可随修改更新。
- [x] 扩展种子数据，包含有效分支问卷；通过测试辅助数据构造重复规则、不可达和循环失败样例。
- [x] 在 `docs/API.md` 预先记录规则编辑、发布检查、检查结果代码和两个引用错误码；实现后继续同步。
- [x] 人工检查规则布局、发布检查位置和结果提示，按反馈将新增题目入口移到题目末尾，并把发布检查整体移到跳转设置末尾。
- [x] 记录本里程碑 AI 使用、人工修改和最终验收。

本里程碑交付：经过校验、可以发布的问卷定义。

## 里程碑 6：版本发布与历史版本

目标：完成不可变发布版本和下一版本草稿流程。

- [x] 完成 `docs/VERSION_LIFECYCLE_DESIGN.md` 候选设计和两轮人工审阅，补充条件更新、两层并发保护、共享状态函数、历史聚合、放弃草稿、游标迁移和测试矩阵；等待最终人工确认后实现。
- [x] 在共享包实现 `computeSurveyStatus(survey, currentVersion, now)`，状态固定为 `draft | published | closed | expired`，关闭优先于到期；列表和后续公开/填写服务共用。
- [x] 问卷列表批量版本查询同时处理 `currentVersionId` 和 `draftVersionId`；版本摘要增加 deadline，使用服务层可注入时钟计算有效状态。
- [x] 实现严格发布请求：`revision` 与 `acknowledgeWarnings` 均必填，未知字段和非布尔确认返回 `VALIDATION_ERROR`。
- [x] 发布事务内重新读取草稿并复用 `validateForPublish`；阻止项返回 `PUBLISH_BLOCKED`，未确认警告返回 `PUBLISH_WARNINGS_UNCONFIRMED`，details 携带完整检查结果。
- [x] 发布版本条件更新固定为 `{ _id, surveyId, status: draft, revision }`，问卷条件更新固定包含 `ownerId` 与 `draftVersionId`；条件失败后重新诊断稳定错误。
- [x] `withTransaction` 每次执行回调时重新读取 now；发布成功原子设置 `status=published`，让 `publishedAt`、版本 `updatedAt` 与问卷 `updatedAt` 共用该值，更新 `currentVersionId` 并清空 `draftVersionId`；不增加 revision，不改变 `manualStatus`。
- [x] 固定发布错误顺序：请求 400 → 问卷/版本 404 → `VERSION_NOT_EDITABLE` → `DRAFT_CONFLICT` → `PUBLISH_BLOCKED` → `PUBLISH_WARNINGS_UNCONFIRMED`。
- [x] 在版本状态更新后、问卷指针更新后分别注入测试失败，验证版本、时间、两个指针和问卷更新时间全部回滚；失败依赖不暴露为路由或配置。
- [x] 实现 `POST /api/surveys/:surveyId/versions`，请求必须带 `sourceVersionId`；判定顺序固定为未发布 `SURVEY_NOT_PUBLISHED` → 已有草稿 `DRAFT_ALREADY_EXISTS` → 来源不当前 `SOURCE_VERSION_NOT_CURRENT`。
- [x] 创建草稿时使用字段白名单与 `structuredClone` 深复制完整定义，保留题目、选项、规则 ID；新版本号为当前加一、revision 为 1，不复制数据库 ID、发布时间和时间戳。
- [x] 创建草稿事务使用 `draftVersionId:null + currentVersionId:sourceVersionId` 条件更新并刷新 `surveys.updatedAt`；部分唯一索引兜底，11000 必须核对 keyPattern，其他重复键不误报。
- [x] 在草稿版本插入后、问卷指针更新前注入失败，验证没有孤立版本；两个并发创建请求恰好一个 201、一个 `DRAFT_ALREADY_EXISTS`。
- [x] 实现 `DELETE /api/surveys/:surveyId/versions/:versionId` 放弃下一版本草稿：要求 revision、当前草稿指针和已有发布版本，事务删除版本并清空指针；判定顺序为请求 400 → 归属/组合 404 → `SURVEY_NOT_PUBLISHED` → `VERSION_NOT_EDITABLE` → `DRAFT_CONFLICT`，初始 v1 提示“初始草稿不能放弃”。
- [x] 放弃 v2 后允许重新创建 v2，不产生版本号空洞；测试 stale revision、回滚和并发边界。
- [x] 实现版本历史聚合：按 versionNumber 倒序，`$project + $size` 计算 questionCount，不读取完整 questions 数组；分页多取一条。
- [x] 把里程碑 3 问卷列表游标迁移为 `{ kind: surveys, updatedAt, id }`，版本历史使用 `{ kind: versions, surveyId, versionNumber }`；两者共用由 `survey-cursor-signing-key:v2` 派生的签名器，跨接口、跨问卷、错误字段或篡改游标返回 `VALIDATION_ERROR`。
- [x] 保存版本历史查询 `explain("executionStats")` 证据，证明 `{ surveyId, versionNumber }` 索引反向扫描，并解释聚合各阶段。
- [x] 版本历史摘要返回 deadline、三个时间字段、questionCount、isCurrent 和 isDraft；先验证所有权，越权统一 404。
- [x] 实现 `PATCH /api/surveys/:surveyId/status`，拒绝未知字段；条件包含 ownerId、非空 currentVersionId 和相反 manualStatus，未命中后重读区分 404、`SURVEY_NOT_PUBLISHED` 与幂等成功；响应按当前版本 deadline 计算状态。
- [x] 发布 v2 不改变 `manualStatus`；关闭且到期时有效状态为 closed，重新开放后仍可能是 expired。
- [x] 前端实现发布与警告二次确认；旧 revision 必须重新确认，发布网络重试得到 `VERSION_NOT_EDITABLE` 时刷新并识别已经成功的发布。
- [x] 前端实现只读发布版本、版本历史、创建下一草稿、放弃草稿、关闭和重新开放；提示关闭状态发布、重新开放仍过期和复制来的过期截止时间。
- [x] 测试已发布版本的设置、题目增删改排序、规则、validate 和再次 publish 全部不可编辑，并验证 `status=published` 当且仅当 `publishedAt` 非空。
- [x] 测试 `acknowledgeWarnings` 缺失/非布尔、警告 false/true 两步确认和修改内容后旧确认失效；分别以 `EMPTY_SURVEY`、`JUMP_CYCLE`、`DEADLINE_PASSED` 断言 `PUBLISH_BLOCKED.details.check`，deadline 恰好等于固定 now 时也阻止。
- [x] 测试首次发布后的两个版本指针、manualStatus 和统一时间；测试发布并发、发布与编辑竞争、发布与放弃草稿竞争，均恰好一个成功。
- [x] 深复制 v2 后修改设置、题目、选项和规则，逐字段验证 v1 不变；发布 v2 后 v1 继续保留。
- [x] 用固定时钟覆盖四种状态、`deadline=null`、关闭优先级、幂等状态更新与发布不重开；过去截止时间样例直接写测试库构造，不放宽生产校验。
- [x] 测试历史倒序、稳定分页、questionCount、当前/草稿标记、跨接口游标和 explain；所有新增生命周期接口对非所有者统一返回 404。
- [x] 使用 `listIndexes` 断言每问卷一个草稿的部分唯一索引存在，键、unique 和 `partialFilterExpression` 均与设计一致。
- [x] 扩展种子数据，包含已发布 v1 加草稿 v2、手工关闭和自动到期问卷；清理逻辑保持可扩展与本地保护。
- [x] 在 `docs/API.md` 和 `SYSTEM_DESIGN.md` 预先同步接口路径、published 状态和五个新错误码；实现后继续按真实响应维护。
- [x] 人工比较 v1 与 v2 内容，检查历史、关闭/开放提示和过期状态；按反馈补充编辑侧栏、已发布题目只读展示，以及绑定检查 revision 的发布效果预览后复查通过。
- [x] 随做随记 AI 使用、人工修改、事务实验和最终验收。

本里程碑交付：完整的问卷版本生命周期。

## 里程碑 7：填写会话与逐题填写

目标：登录用户能够通过公开链接填写固定版本。

- [x] 完成 `docs/FILL_SESSION_DESIGN.md` 候选设计与人工复核，确认双 Cookie、不刷新登录 JWT、ownerKey、五活动会话槽位、恢复接口和本地草稿边界后再实现。
- [x] 定义 `fill_sessions` schema：固定 survey/version、identityMode、ownerKey、匿名不含 userId、实名含 userId、令牌摘要、状态、activeSlot、三个时间字段与 purgeAt。
- [x] 定义不可逆状态机 `active → expired | submitted`；用共享 `computeSessionState` 固定“已提交 → 手工关闭 → 绑定版本截止 → 30 分钟到期 → active”的判定，并用固定时钟覆盖 `<= now` 边界。
- [x] 建立 `sessionTokenHash` 唯一索引、`purgeAt` TTL、owner 活动查询索引，以及 `{ surveyId, ownerKey, activeSlot }` 仅 active 的条件唯一索引；用 `listIndexes` 断言完整结构。
- [x] 用 0–4 activeSlot 严格限制每账号每问卷最多五个活动会话；惰性写回过期并释放槽位，11000 核对 keyPattern 后有限重试，并发六次创建不能超过五个成功。
- [x] 实现 `GET /api/public/surveys/:publicId`；未登录可看白名单摘要，未发布统一 404，关闭和到期返回可解释状态，所有公开响应设置 `Cache-Control: no-store`。
- [x] 实现 `POST /api/public/surveys/:publicId/sessions`，只接受 `{}`，要求登录，绑定调用时的当前发布版本并返回 201；不刷新、不续期两小时登录 JWT。
- [x] 生成 32 字节随机填写令牌，数据库只保存 SHA-256 摘要；明文只进入 HttpOnly、SameSite=Lax、动态 Path、限时 Max-Age 的 `survey_fill` Cookie，测试生产 Secure 差异。
- [x] 实现 `GET /api/public/sessions/:sessionId` 恢复接口；登录 Cookie 与填写 Cookie必须同时有效，会话/令牌/账号不匹配统一 `SESSION_NOT_FOUND`。
- [x] 实现 `ownerKey = HMAC(ANONYMOUS_ID_SECRET, "survey-owner:v1\\0" + surveyId + "\\0" + userId)`；同问卷跨版本稳定、跨问卷不同，所有响应隐藏该值，并记录假名化威胁模型与密钥不可直接轮换边界。
- [x] 为 `allowMultipleSubmissions=false` 预留基于 `(surveyVersionId, ownerKey)` 的 `ALREADY_SUBMITTED` 服务检查点；里程碑 7 不以会话代替回答，里程碑 8 建立 responses 后接入。
- [x] 创建会话固定顺序：请求/Origin → 登录 → 两层限流 → 公开问卷 → 关闭 → 当前版本截止 → 已提交占位 → 会话上限 → 写入；补齐六个会话错误码。
- [x] 增加并启动校验三个 `FILL_SESSION_RATE_LIMIT_*` 配置；覆盖账号+IP、IP 总量、Retry-After、窗口恢复、容量封闭失败与测试注入。
- [x] 实现 `/fill/:publicId` 和 `/fill/:publicId/session/:sessionId`；登录返回地址只接受规定正则的站内路径，其他值回到默认页。
- [x] 匿名模式显示“创建者看不到身份，登录用于防重复”，实名模式明确提示创建者将看到账号；创建者页面显示并可复制 `/fill/:publicId`。
- [x] 实现一次一题、题下错误、按真实已走路径上一题，以及“第 n 题（最多 N 题）”；文本不用 maxlength，数字空串与非有限数值按共享语义处理。
- [x] 使用共享 `validateAnswer`、`evaluateNextQuestion` 和 `computePath`；修改前题答案时立即清除新路径外答案，最终进入未正式提交的回答检查页。
- [x] 倒计时用 serverNow 与 `performance.now()` 计算单调经过时间，并显示会话到期与绑定版本截止的较早值；服务端时间始终是最终判定。
- [x] 非凭据答案防抖写入 `sessionStorage`，令牌和 ownerKey 永不写入；捕获配额错误并把序列化草稿限制为 2 MiB。
- [x] 恢复本地草稿前先验证会话，把内容当不可信输入：限制大小、丢弃未知题目和错误类型、重新校验与算路径；`SESSION_NOT_FOUND`、到期、放弃或成功提交时清除。
- [x] 测试公开/填写响应白名单，匿名数据库文档无 userId，创建者和公开接口不泄露 ownerKey、令牌摘要或内部版本字段。
- [x] 测试双 Cookie 完整矩阵、退出/登录过期后同账号恢复、换账号拒绝，以及登录 Cookie未被创建会话续期。
- [x] 测试新会话进入最新版本、旧会话固定旧版本、v2 截止但 v3 开放时旧会话仍返回 `SURVEY_EXPIRED`，以及创建与发布/关闭的竞争边界。
- [x] 扩展种子数据，提供匿名、实名、关闭、到期和旧版本会话场景，方便人工检查。
- [x] 在 `docs/API.md`、SYSTEM_DESIGN、README 和认证/需求决策文档同步公开路径、三个接口、ownerKey、索引、限流与错误码。
- [x] 人工检查匿名和非匿名填写流程。
- [x] 记录本里程碑 AI 使用和人工修改。

本里程碑交付：尚未正式保存回答的完整填写过程。

## 里程碑 8：提交、路径校验与重复限制

目标：服务端可信地验证并保存正式回答。

- [x] 定义 `responses` schema 和索引。
- [x] 完成 `docs/RESPONSE_SUBMISSION_DESIGN.md` 候选设计与人工复核，确认幂等优先级、先认证后解析、路径外答案和事务写入顺序后再实现。
- [x] responses 保存 surveyId、surveyVersionId、fillSessionId、内部 ownerKey、可选 dedupKey/respondentId、真实 questionPath、ignoredQuestionIds、规范 answers 和 submittedAt；匿名不写 respondentId。
- [x] 建立 fillSessionId 唯一索引、`surveyVersionId + dedupKey` 字符串条件唯一索引和 `surveyVersionId + submittedAt + _id` 分页索引，并用 listIndexes 断言结构。
- [x] 为提交路由设置独立的 4 MiB 原始 JSON 上限，其他 API 继续保持 256 KiB；覆盖最大合法答案集、超限 413 和解析顺序测试。
- [x] 提交中间件按 Origin → Content-Type → 登录 → 双 Cookie 所有权 → 已提交幂等 → 账号/会话限流 → 状态 → 4 MiB 解析排列；未认证超大正文不得先解析。
- [x] 增加提交账号和会话限流配置、启动校验、Retry-After、窗口恢复与容量测试。
- [x] 后端重新计算真实 `questionPath`。
- [x] 只校验实际路径上的题目。
- [x] 忽略并不保存路径外答案。
- [x] 返回 `ignoredQuestionIds`。
- [x] 路径外只要求 questionId 已知并通过通用 JSON 结构预检，不做题型和值域校验；未知或重复 ID、未知字段和非法原始形态返回带稳定 path 的 VALIDATION_ERROR。
- [x] ANSWER_VALIDATION_FAILED 一次返回全部路径内 issues；每项含 questionId、机器 code、原请求 path 和 message，并按真实路径稳定排序。
- [x] 保存问卷版本和真实路径。
- [x] 匿名版本不保存 UID，但在内部回答记录保存 `ownerKey`；创建者接口不得返回该字段。
- [x] 非匿名版本保存填写者账号。
- [x] 禁止重复时写入 `dedupKey=ownerKey`；匿名和实名均使用同一个按问卷稳定、不含版本 ID 的键。条件唯一索引固定为 `(surveyVersionId, dedupKey)`，因此同一账号仍可分别提交 v1 和 v2。
- [x] 允许重复时支持同一用户多次提交。
- [x] 使用带条件的原子操作只把未过期的 `active` 会话转换为 `submitted`，写入 `submittedAt`；`submitted` 或有效状态为 `expired` 的会话不能再次提交。
- [x] 幂等判定在关闭、截止、会话到期与正文解析前；所有权通过的 submitted 会话按 fillSessionId 返回原结果，不比较重试正文，首次与幂等成功都用相同 Path 清除 survey_fill Cookie。
- [x] 提交事务先条件更新会话并释放 activeSlot，再插入 response；事务重试回调重取 now，两个写入使用同一 submittedAt。
- [x] 在会话更新后、回答插入后注入失败并验证完全回滚；条件更新未命中只分类为幂等成功或 SESSION_EXPIRED，不增加不可达冲突码。
- [x] 验证并发提交只能产生合法记录。
- [x] 分别验证匿名和非匿名版本的条件唯一索引，并验证同一用户仍可各提交 v1 和 v2 一次。
- [x] 验证关闭、到期和会话过期后拒绝提交。
- [x] 验证已成功提交在到期或关闭后重试仍返回同一 submission.id；同会话并发请求最终也得到同一结果。
- [x] 多选答案按题目选项顺序保存；fillSessionId 允许在会话 TTL 清理后悬空，response 永久有效。
- [x] 前端复核页增加提交、提交中锁定、成功页、幂等提示和第一项 issues 定位；成功清除本地草稿，校验或网络失败保留。
- [x] 种子数据加入匿名、实名、分支路径、允许与禁止重复的既有回答，供里程碑 9 核算；匿名统计以后只展示粗粒度提交日期。
- [x] 在 `docs/API.md` 追加提交成功、路径外答案、重复提交、会话状态冲突和错误码。
- [x] 人工检查数据库中的匿名回答结构。
- [x] 记录本里程碑 AI 使用和人工修改。

本里程碑交付：完整、安全、按版本隔离的回答提交。

## 里程碑 9：按版本统计

目标：创建者可以查看指定版本的统计结果。

- [x] 完成 `docs/STATISTICS_DESIGN.md` 候选设计与人工复核，确认加密游标、快照事务、分页管道、匿名边界和实验方法后再实现。
- [x] 统计只开放给已发布版本；草稿返回 `VERSION_NOT_PUBLISHED`，越权统一 404，两个接口设置 `Cache-Control: no-store`。
- [x] 实现五条职责单一的 MongoDB 聚合：提交总数、路径到达、题目回答、合并选择题选项和数字汇总；全部先按 `surveyVersionId` 匹配并尽早投影。
- [x] 在一个 `readConcern: snapshot` 的只读事务中运行全部统计管道，逐条显式传 session 和 `maxTimeMS`；事务内不使用 `$out`、`$merge` 或 explain。
- [x] 增加每用户统计限流和三个启动配置；超时或快照失败稳定返回 `503 STATISTICS_UNAVAILABLE`。
- [x] 返回 `reachedCount`、`answeredCount`、`notReachedCount`、`unansweredReachedCount`、reachRate、answerRate 和 required；比例分母为零时返回 0。
- [x] 单选选项人数之和等于 answeredCount；多选按选项人数统计且单项不超过 answeredCount；零计数选项仍按发布版本顺序返回。
- [x] 数字题计算 count、average、minimum、maximum；无数据时 count=0，其余三个值为 null，不用 0 代表无数据。
- [x] 实现只读文本题的 `/responses?questionId=...` 分页；严格校验 questionId、limit 1–50、未知参数和游标绑定。
- [x] 文本分页先以版本、`answers.questionId` 和游标范围 `$match`，沿现有时间索引排序、limit+1，最后用 `$filter + $arrayElemAt` 投影；不得先展开整份 answers。
- [x] 实名文本页用一次 `$in` 批量读取用户，禁止 N+1；匿名项只返回正文和 UTC 日期。
- [x] 为匿名文本分页实现 AES-256-GCM 不透明游标；密钥从 JWT_SECRET 与专用标签派生，随机 12 字节 IV，认证标签防篡改，明文绑定问卷、版本、题目、时间和 ID。
- [x] 对所有创建者响应递归扫描内部身份键；匿名响应额外禁止 respondentId、submittedAt 和 id，并测试游标不含明文时间或 ObjectId。
- [x] 把 `answered <= reached <= submissions`、单选总和、多选上限、数字 count 写成测试预言；生产发现损坏时只输出汇总日志。
- [x] 通过测试注入点在两条统计管道之间插入回答，证明当前请求仍使用同一快照并保持全部不变量。
- [x] 实现版本统计前端：手工刷新、题目卡、选择比例、数字摘要、文本分页、UTC 标签、`white-space: pre-wrap` 和纯文本渲染。
- [x] 用小型固定数据手算并核对全部指标。
- [x] 用固定随机种子向受保护测试库直接生成 50,000 份性能回答；保存生成/清理脚本、种子、参数和环境保护。
- [x] 在快照事务外对相同参数和同一批管道运行 `explain("executionStats")`，保存关键输出并证明使用预期索引。
- [x] 逐阶段说明统计聚合管道中的 `$match`、路径展开、分组、投影和分页等步骤及其输入输出。
- [x] 记录 `winningPlan`、使用的索引、`totalKeysExamined` 与 `totalDocsExamined`，解释无法使用索引的阶段。
- [x] 对 50,000 份性能数据记录耗时，并说明文本题低回答率会增加 `totalDocsExamined`；解释 `$facet` 的 100 MB、不可落盘和 16 MiB 最终文档限制。
- [x] 在 `docs/API.md` 追加统计和回答分页接口及错误码。
- [x] 人工检查统计页面的版本隔离、指标、实名文本回答与身份展示；确认界面结果和网络返回符合设计，匿名接口泄露由自动递归扫描共同覆盖。
- [x] 记录本里程碑 AI 使用和人工修改。

本里程碑交付：按版本隔离的统计与回答查看功能。

## 里程碑 10：系统测试补缺与实验记录

目标：各里程碑已经完成本地测试；本里程碑核对需求—测试矩阵，只补遗漏，执行完整回归，并留下可复现实验证据。

- [x] 建立需求—测试追踪矩阵，核对创建问卷、题目、跳转、校验、提交、统计、数据隔离和生命周期已有测试。
- [x] 核对匿名身份保护、不同问卷匿名标识、版本切换、旧会话和条件唯一索引已有测试。
- [x] 核对重复提交并发、会话原子状态转换和事务失败完全回滚已有测试。
- [x] 只针对追踪矩阵中的空缺补写测试，不把此前里程碑应完成的高风险测试拖到本里程碑。
- [x] 执行完整自动回归并保存版本、命令、通过数和失败修复记录。
- [x] 完成种子数据脚本，覆盖多版本、全部题型、跳转分支、匿名/非匿名回答和可人工核算的统计结果。
- [x] 验证种子脚本可重复执行、可清理，并记录使用方法。
- [x] 汇总关键查询与聚合管道的 `explain("executionStats")` 证据。
- [x] 记录自动测试与数据库实验的步骤、输入、预期输出、实际输出和结果；人工项目在验收时续写。
- [ ] 人工执行完整端到端验收。
- [ ] 修复验收发现的问题并复测。

本里程碑交付：自动测试报告、人工测试记录和问题修复记录。

## 里程碑 11：项目文档与报告

目标：形成可提交材料，不补写或伪造未发生的过程。

- [ ] 按最终代码更新 README，不把现有骨架 README 误记为最终完成。
- [ ] 写清前端、后端、数据库和依赖版本。
- [ ] 写清五个集合的作用和嵌套关系。
- [ ] 在 README 中加入最终数据模型摘要和问卷版本生命周期摘要，并链接详细设计文档。
- [ ] 完成配置和运行说明。
- [ ] 核对持续维护的 `docs/API.md` 是否覆盖全部最终接口、请求、响应、鉴权和错误码。
- [ ] 完成数据库设计说明。
- [ ] 完成跳转和校验设计说明。
- [ ] 完成实验设计与实际测试结果。
- [ ] 最终核对各里程碑的真实提示词和 AI 产出日志是否完整；只补索引和引用，不补写未发生的过程。
- [ ] 记录人工检查、发现的问题和修改证据。
- [ ] 完成第一阶段项目报告。
- [ ] 检查文档与最终代码一致。
- [ ] 人工完成最终签字或确认记录。

本里程碑交付：README、API、数据库、实验、AI 使用日志和完整项目报告。

## 里程碑 12：GitHub 提交

目标：只提交经过检查的第一阶段成果。

- [ ] 检查 `git log`，确认提交顺序能反映真实的阶段性交互、人工审阅和修改过程。
- [ ] 检查 `.gitignore`，确认忽略 `node_modules`、构建产物、Docker 本地数据目录/卷挂载目录和 `.env`。
- [ ] 运行 `git status --ignored` 和 `git check-ignore .env node_modules`，核对忽略规则实际生效。
- [ ] 运行 `git ls-files | grep -i env`，逐项确认只跟踪 `.env.example` 等安全模板，不包含真实环境配置。
- [ ] 确认 `.env`、密钥、令牌和真实密码未提交。
- [ ] 确认所有测试通过。
- [ ] 确认人工检查项已填写。
- [ ] 整理可读的里程碑式 Git 提交。
- [ ] 配置 GitHub remote。
- [ ] 推送分支。
- [ ] 在另一目录克隆并按 README 从零运行。
- [ ] 在全新克隆中单独验证种子脚本、数据库初始化、全部测试和生产构建。
- [ ] 保存最终提交哈希和仓库地址。

## 建议的下一步

里程碑 4 的设计、实现、自动检查和人工验收均已完成。下一步保存里程碑 4 实现检查点，然后讨论里程碑 5“跳转规则与发布检查”；设计确认前不编码。
