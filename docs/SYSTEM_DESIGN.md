# 第一阶段系统设计

## 设计结论

系统采用 Vue 3 与 TypeScript 实现前端，Node.js 24 LTS、Express 5 与 TypeScript 实现后端，MongoDB 8.0 保存全部业务数据。数据层使用五个集合：`users`、`surveys`、`survey_versions`、`fill_sessions` 和 `responses`。

设计重点是版本不可变、回答按版本隔离、服务端执行可信校验、问卷内匿名和对第二阶段的可扩展性。

## 技术栈

| 层次     | 技术                           | 版本策略              | 作用                           |
| -------- | ------------------------------ | --------------------- | ------------------------------ |
| 前端     | Vue 3、Vite、TypeScript        | 安装时锁定稳定版本    | 创建者管理、逐题填写、统计展示 |
| 后端     | Node.js、Express 5、TypeScript | Node.js 24 LTS        | REST API 和业务服务            |
| 数据访问 | Mongoose                       | 锁定兼容稳定版本      | MongoDB schema、索引和查询     |
| 数据库   | MongoDB 8.0                    | 使用最新 8.0 补丁版本 | 保存全部业务数据               |
| 测试     | Vitest、Supertest              | 锁定稳定版本          | 单元测试与 API 集成测试        |
| 本地环境 | Docker Compose                 | 固定镜像版本          | 可复现数据库环境               |

Node.js 20 已停止维护，因此项目选择受支持的 Node.js 24 LTS。Express 使用正式的 5.x 主版本。MongoDB 选择有可预测生命周期的 8.0 Major Release，并固定其最新安全补丁。

参考资料：

- [Node.js 发布周期](https://nodejs.org/en/about/previous-releases)
- [Express 5 迁移说明](https://expressjs.com/en/guide/migrating-5/)
- [MongoDB 版本策略](https://www.mongodb.com/docs/manual/reference/versioning/)
- [Vue 3 快速开始](https://vuejs.org/guide/quick-start.html)

## 总体架构

```text
Vue 前端
├── 创建者界面
│   ├── 登录注册
│   ├── 问卷与版本管理
│   ├── 题目及跳转编辑
│   └── 按版本查看统计
└── 填写者界面
    ├── 登录
    ├── 创建填写会话
    ├── 逐题填写和跳转
    └── 校验与提交
          │
          ▼ REST API
Express 后端
├── 身份认证
├── 问卷版本服务
├── 发布检查服务
├── 跳转规则引擎
├── 答案校验服务
├── 匿名标识服务
├── 提交服务
└── 统计服务
          │
          ▼ Mongoose
MongoDB
├── users
├── surveys
├── survey_versions
├── fill_sessions
└── responses
```

前端只负责交互，后端负责最终可信判断。后端不能信任客户端传入的用户身份、问卷版本、答题路径或校验结果。

里程碑 5 新增无框架依赖的 `packages/survey-logic` workspace，集中保存规范问卷类型、答案校验、跳转执行、路径计算和发布检查。Vue 与 Express 共同引用该包，避免前后端各自实现一套可能分叉的规则语义；数据库访问、HTTP 和界面状态不进入共享包。共享包按现有 ESM 风格编译到带类型声明的 `dist`，生产构建显式先构建共享包，开发模式先构建一次再同时监视共享包、API 和前端。

## MongoDB 集合设计

### users

作用：保存账号和认证信息。

```json
{
  "_id": "ObjectId",
  "username": "alice",
  "usernameNormalized": "alice",
  "passwordHash": "scrypt$参数$盐$派生密钥",
  "registeredAt": "Date"
}
```

约束：

- `usernameNormalized` 唯一，用户名按小写规范化。
- 只保存密码哈希。
- 匿名回答不直接引用用户 ID。

密码使用 Node.js 内置异步 `crypto.scrypt`，认证细节、参数、Cookie、CSRF、限流和错误码见 `AUTH_DESIGN.md`。

### surveys

作用：表示问卷的长期身份和当前指针，不保存具体题目。

```json
{
  "_id": "ObjectId",
  "ownerId": "ObjectId(users)",
  "publicId": "随机公开标识",
  "internalName": "课程反馈问卷",
  "manualStatus": "open",
  "currentVersionId": null,
  "draftVersionId": "ObjectId(survey_versions)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

`publicId` 使用至少 128 位随机值和 URL 安全编码，用于稳定公开链接 `/survey/{publicId}`。发布新版本不改变链接。`currentVersionId` 和 `draftVersionId` 均允许为 `null`，但创建问卷和 v1 草稿的事务完成后，`draftVersionId` 必须指向 v1。

### survey_versions

作用：保存每一个版本的完整问卷定义。

```json
{
  "_id": "ObjectId",
  "surveyId": "ObjectId(surveys)",
  "versionNumber": 2,
  "status": "draft",
  "revision": 1,
  "title": "课程反馈",
  "description": "请根据真实情况填写",
  "identityMode": "anonymous",
  "allowMultipleSubmissions": false,
  "deadline": "Date",
  "sessionDurationMinutes": 30,
  "questions": [],
  "schemaVersion": 1,
  "createdAt": "Date",
  "updatedAt": "Date",
  "publishedAt": null
}
```

版本只使用 `draft` 和 `published`。`revision` 是草稿的乐观并发版本号，每次成功保存加一；发布后不可修改。历史发布版本由回答继续引用，当前版本由 `surveys.currentVersionId` 指定。保存草稿设置时，版本修改和 `surveys.updatedAt` 更新必须放在同一事务中，使“我的问卷”排序反映最近编辑时间。

### fill_sessions

作用：把一次正在进行的填写固定到打开时的版本。

```json
{
  "_id": "ObjectId",
  "sessionTokenHash": "不可逆令牌摘要",
  "surveyId": "ObjectId(surveys)",
  "surveyVersionId": "ObjectId(survey_versions)",
  "respondentKey": "问卷内匿名标识",
  "status": "active",
  "startedAt": "Date",
  "expiresAt": "Date",
  "submittedAt": null
}
```

`expiresAt` 建立 TTL 索引。后端仍主动判断是否过期，不能依赖 MongoDB 恰好在到期瞬间删除文档。

### responses

作用：保存正式提交及其真实路径。

```json
{
  "_id": "ObjectId",
  "surveyId": "ObjectId(surveys)",
  "surveyVersionId": "ObjectId(survey_versions)",
  "fillSessionId": "ObjectId(fill_sessions)",
  "respondentKey": "问卷内匿名标识",
  "dedupKey": "禁止重复时写入",
  "respondentId": "仅非匿名版本写入",
  "questionPath": ["q1", "q3", "q5"],
  "answers": [{ "questionId": "q1", "value": "option_a" }],
  "submittedAt": "Date"
}
```

创建者读取匿名版本回答时，API 删除 `respondentKey`、`dedupKey`、`fillSessionId` 和其他身份相关字段。

## 嵌套设计

```text
survey_version
└── questions[]
    ├── validation
    ├── options[]
    └── jumpRules[]
```

题目、选项、校验和跳转规则嵌套在版本中，因为打开问卷和发布检查都需要一次取得完整定义，且题目不脱离版本独立存在。

回答不能嵌套在问卷或版本中。回答数量会持续增长，并且多人可能同时提交；独立集合更适合并发写入、分页和统计。

## 题目结构

### 通用字段

```json
{
  "questionId": "q_age",
  "type": "number",
  "title": "年龄",
  "required": true,
  "validation": {},
  "options": [],
  "jumpRules": []
}
```

`questions` 数组位置是唯一顺序，不另存 `order`。同一道逻辑题从旧版本复制到新版本时保留 `questionId`。调整顺序不会修改 ID，但会改变没有跳转规则时的默认下一题；新题生成新 ID；删除只影响新版本。选项同样使用稳定 `optionId`，固定结构为 `{ optionId, text }`。

每个版本最多 100 道题。题型创建后不可直接修改；题目修改接口完整替换标题、必答设置、校验和选项，不局部合并。`validation` 请求字段必填但可为空对象，服务端补齐所有缺省字段后再存储，保证发布版本不依赖未来代码中的默认值。题目接口不接受客户端回传 `jumpRules`；里程碑 5 使用独立接口整组保存规则，普通题目修改必须保留已有规则。完整字段、默认值、答案形态、并发更新与错误顺序见 `QUESTION_DESIGN.md`。

题目标题与选项先做 NFC 规范化，再 trim、按 Unicode 码点计数和比较；拒绝 `Cc` 类及双向控制符，但保留 ZWJ。前端对整个版本只维护一份 revision，设置保存与题目写入共同串行化。

### 单选题

答案保存 `optionId`，不直接保存选项文字。

### 多选题

答案保存 `optionId` 数组，并支持 `minSelections` 和 `maxSelections`。

### 文本题

支持 `minLength`、`maxLength` 和 `digitsOnly`。手机号使用文本存储。

### 数字题

支持 `integerOnly`、`minValue` 和 `maxValue`，MongoDB 中保存为数值。

## 跳转规则

```json
{
  "ruleId": "r_URL安全随机值",
  "operator": "equals",
  "value": "o_option_a",
  "targetQuestionId": "q_target"
}
```

规则采用扁平结构，顺序就是优先级。后端从上到下检查，第一条满足的规则生效；没有规则满足则进入下一题。未回答时所有规则均不匹配。每题默认最多 20 条规则，通过环境变量配置。

| 题型 | 支持的操作符                             |
| ---- | ---------------------------------------- |
| 单选 | `equals`                                 |
| 多选 | `contains`、`containsAll`、`containsAny` |
| 数字 | `equals`、`gt`、`gte`、`lt`、`lte`       |
| 文本 | 第一阶段不支持跳转                       |

规则保存时检查目标存在、拒绝自跳转、检查操作符适用和选项归属；指向更靠前题目的规则与不可达状态允许暂存在草稿中。发布前检查使用精确图：必答单选且规则覆盖全部选项时不画默认边，其他题型保守保留默认边。对每条可达来源且指向更靠前题目的规则，若目标题能回到来源题，则按该规则和最短回路稳定报告循环，不依赖 DFS 遍历顺序。发布前还防御性复核结构与稳定 ID。结构损坏、循环、空问卷和已过截止时间阻止发布；不可达题目和重复条件产生警告。共享路径计算、引用保护、接口和图算法见 `JUMP_DESIGN.md`。

## 答题路径与校验

后端从第一题开始，根据当前答案逐题计算真实路径。只校验真实路径上的题目；路径外答案不保存，并返回 `ignoredQuestionIds`。

回答保存 `questionPath`，统计由此得到：

- `reachedCount`：经过该题的人数。
- `answeredCount`：实际提交有效答案的人数。

前端修改早期答案后必须重算路径，并清除新路径之外的旧答案。后端独立重算，不能直接相信前端结果。

## 匿名标识和重复提交

```text
respondentKey = HMAC-SHA256(
  ANONYMOUS_ID_SECRET,
  surveyId + ":" + userId
)
```

同一用户在同一问卷中的标识稳定，不同问卷中的标识不同。

禁止重复填写时：

```text
dedupKey = respondentKey
唯一约束 = surveyVersionId + dedupKey
```

允许重复填写时省略 `dedupKey`，条件唯一索引不生效。该索引可以防止两个并发请求同时绕过重复检查。

## 生命周期

对外有效状态按顺序计算：

```text
没有发布版本         → draft
manualStatus=closed  → closed
当前时间超过截止时间 → expired
其他情况             → published
```

版本流程：

```text
创建问卷
   ↓
v1 draft
   ↓ 发布
v1 published ← 当前版本
   ↓ 创建修改
v2 draft      v1 继续服务
   ↓ 发布
v2 published ← 新当前版本
v1 保留历史回答与统计
```

发布新版本应使用 MongoDB 事务，原子完成草稿校验、版本发布、当前版本指针更新和草稿指针清理。本地 Docker 环境配置单节点副本集以支持事务。

创建问卷同样使用 `withTransaction`。事务开始前生成 survey 与 version 两个 ObjectId，使两个文档可以在首次插入时直接互相引用，不经过“先插入再回填”。`publicId` 由至少 128 位随机值生成，并由唯一索引兜底；发生重复键时整个事务失败，不在事务内部局部重试。

## API 设计

### 认证

| 方法 | 路径                 | 作用     |
| ---- | -------------------- | -------- |
| POST | `/api/auth/register` | 注册     |
| POST | `/api/auth/login`    | 登录     |
| GET  | `/api/auth/me`       | 当前用户 |
| POST | `/api/auth/logout`   | 退出登录 |

### 问卷管理

| 方法  | 路径                            | 作用               |
| ----- | ------------------------------- | ------------------ |
| POST  | `/api/surveys`                  | 创建问卷和 v1 草稿 |
| GET   | `/api/surveys`                  | 我的问卷列表       |
| GET   | `/api/surveys/:surveyId`        | 问卷及版本摘要     |
| PATCH | `/api/surveys/:surveyId`        | 修改内部管理名称   |
| POST  | `/api/surveys/:surveyId/close`  | 手工关闭           |
| POST  | `/api/surveys/:surveyId/reopen` | 手工重新开放       |

### 版本管理

| 方法   | 路径                                                                          | 作用                     |
| ------ | ----------------------------------------------------------------------------- | ------------------------ |
| GET    | `/api/surveys/:surveyId/versions`                                             | 版本列表                 |
| POST   | `/api/surveys/:surveyId/versions/draft`                                       | 创建下一版本草稿         |
| GET    | `/api/surveys/:surveyId/versions/:versionId`                                  | 查看版本                 |
| PATCH  | `/api/surveys/:surveyId/versions/:versionId`                                  | 修改草稿设置             |
| POST   | `/api/surveys/:surveyId/versions/:versionId/questions`                        | 添加题目                 |
| PATCH  | `/api/surveys/:surveyId/versions/:versionId/questions/:questionId`            | 修改题目                 |
| DELETE | `/api/surveys/:surveyId/versions/:versionId/questions/:questionId`            | 删除草稿题目             |
| PUT    | `/api/surveys/:surveyId/versions/:versionId/question-order`                   | 完整重排题目             |
| PUT    | `/api/surveys/:surveyId/versions/:versionId/questions/:questionId/jump-rules` | 完整替换一道题的跳转规则 |
| POST   | `/api/surveys/:surveyId/versions/:versionId/validate`                         | 发布前检查               |
| POST   | `/api/surveys/:surveyId/versions/:versionId/publish`                          | 发布版本                 |

### 填写

| 方法 | 路径                                     | 作用         |
| ---- | ---------------------------------------- | ------------ |
| GET  | `/api/public/surveys/:publicId`          | 公开摘要     |
| POST | `/api/public/surveys/:publicId/sessions` | 创建填写会话 |
| POST | `/api/public/sessions/:token/submit`     | 提交会话答案 |

### 统计

| 方法 | 路径                                                    | 作用         |
| ---- | ------------------------------------------------------- | ------------ |
| GET  | `/api/surveys/:surveyId/versions/:versionId/statistics` | 版本统计     |
| GET  | `/api/surveys/:surveyId/versions/:versionId/responses`  | 分页查看回答 |

### 问卷草稿错误码

| HTTP | 错误码                   | 含义                                            |
| ---: | ------------------------ | ----------------------------------------------- |
|  404 | `SURVEY_NOT_FOUND`       | 问卷/版本不存在、不属于当前用户或组合错误       |
|  404 | `QUESTION_NOT_FOUND`     | 格式合法的题目 ID 在目标版本中不存在            |
|  409 | `VERSION_NOT_EDITABLE`   | 目标版本已发布，不能通过草稿接口修改            |
|  409 | `DRAFT_CONFLICT`         | 客户端 revision 过期；details 返回当前 revision |
|  409 | `SURVEY_LIMIT_REACHED`   | 当前用户达到可配置的问卷数量上限                |
|  409 | `QUESTION_LIMIT_REACHED` | 目标版本已经达到 100 道题上限                   |
|  409 | `QUESTION_REFERENCED`    | 题目仍被其他跳转规则引用                        |
|  409 | `OPTION_REFERENCED`      | 选项仍被本题跳转规则引用                        |

所有带请求体的接口只接受 `application/json`，无请求体的退出接口除外。字段、事务、分页、限流和种子保护的完整里程碑 3 约定见 `SURVEY_DRAFT_DESIGN.md`；题目结构、校验、接口语义和并发约定见 `QUESTION_DESIGN.md`；跳转、路径和发布检查见 `JUMP_DESIGN.md`。

## 前端范围

创建者端包括登录注册、我的问卷、版本历史、草稿编辑、题目及跳转配置、发布检查、发布、关闭、重新开放、公开链接和按版本统计。

填写者端包括登录、打开链接、创建会话、逐题填写、条件跳转、修改早期答案、错误提示、剩余会话时间和提交结果。

第一阶段不实现拖拽高级编辑器、文件上传题、邮件邀请、Excel 导出、管理员后台和手机验证码。

## 索引

| 集合            | 索引                                                                |
| --------------- | ------------------------------------------------------------------- |
| users           | `usernameNormalized` 唯一                                           |
| surveys         | `publicId` 唯一                                                     |
| surveys         | `{ ownerId: 1, updatedAt: -1, _id: -1 }`                            |
| survey_versions | `surveyId + versionNumber` 唯一                                     |
| survey_versions | `{ surveyId: 1, status: 1 }` 条件唯一索引，仅匹配 `status: "draft"` |
| fill_sessions   | `sessionTokenHash` 唯一                                             |
| fill_sessions   | `expiresAt` TTL                                                     |
| responses       | `surveyVersionId + submittedAt`                                     |
| responses       | `surveyVersionId + dedupKey` 条件唯一                               |

## 测试设计

### 单元测试

- 分开覆盖题目定义校验和纯函数 `validateAnswer(question, value)` 的所有边界。
- 手机号仅接受 ASCII 数字字符，拒绝全角数字和阿拉伯-印度数字。
- 文本 Unicode 码点、选择数量、选项归属、有限安全数值、`Infinity` 和 `-0` 规范化。
- 第一条跳转规则优先。
- 跳转循环检测。
- 路径外必答题不校验。
- 路径变化后清除旧答案。
- 匿名标识稳定性和跨问卷隔离。
- 按版本统计。

### API 集成测试

- 注册登录与用户隔离。
- 创建和修改草稿。
- 题目新增、完整替换、删除和完整重排，以及稳定题目和选项 ID。
- 题型、ID 和跳转规则不可由修改请求覆盖；借用其他题的选项 ID 被拒绝。
- 同 revision 并发写只有一个成功，99 题并发新增不会超过 100 题。
- 已发布版本不可修改。
- 新版本不覆盖旧版本。
- 旧填写会话在 30 分钟内提交到旧版本。
- 手工关闭和到期后拒绝提交。
- 禁止重复提交时的并发请求。
- 匿名回答不泄露身份。
- 不同版本统计互不混合。

### 前端人工测试

- 创建完整问卷。
- 调整跳转规则顺序。
- 发布前显示循环错误。
- 命中和未命中跳转。
- 修改前题后路径刷新。
- 过期会话提示。
- 按版本查看结果。

## 第二阶段演进

- 新题型和新规则只影响新版本。
- 旧回答始终由其 `surveyVersionId` 解释。
- 稳定题目和选项 ID 支持版本比较。
- `schemaVersion` 支持未来数据库迁移。
- 发布版本不可变，可以明确说明第二阶段修改了什么。
- 第二阶段必须在现有集合和服务边界上扩展，不删除第一阶段核心功能。

## 已确认决策

项目负责人已检查并采用以下设计项：

- `T1`：Vue 3、TypeScript、Express 5、MongoDB 8.0。
- `D1`：五集合设计。
- `D2`：题目嵌套在版本中，回答独立存储。
- `D3`：发布版本不可变。
- `D4`：30 分钟填写会话固定版本。
- `D5`：匿名版本使用 HMAC 问卷内标识。
- `D6`：条件唯一索引保证每版本一次。
- `D7`：题目和选项 ID 跨版本稳定。
- `D8`：统计严格按版本隔离。
- `D9`：允许手工重新开放，但不能绕过截止时间。
- `D10`：采用本文 REST API 划分。
- `F1`：采用本文第一阶段前端范围。
- `X1`：发布切换使用 MongoDB 事务。
