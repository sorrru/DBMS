# API 说明

本文从里程碑 2 起随代码维护。默认基址为 `/api`，请求和响应均使用 JSON；`204` 响应例外。浏览器认证使用名为 `survey_session` 的 HttpOnly Cookie。

## 通用约定

- 所有带请求体的接口必须发送 `Content-Type: application/json`；无请求体的退出接口例外。
- `POST`、`PUT`、`PATCH`、`DELETE` 必须携带与 `WEB_ORIGIN` 完全相同的 `Origin`。
- CORS 允许方法固定包含 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE` 和 `OPTIONS`，使浏览器直连后端时的写请求可以通过预检。
- 前端使用相对路径并设置 `credentials: "include"`。
- 错误结构固定为 `{ "error": { "code": "...", "message": "...", "details": {} } }`；`details` 仅在需要指出字段时出现。
- 用户响应只含 `id`、`username`、`registeredAt`，不返回内部规范化字段或密码哈希。

## 健康检查

### `GET /api/health`

无需认证。返回 API 与 MongoDB 当前状态；数据库不可用时 HTTP 仍为 `200`，顶层 `status` 为 `degraded`。

## 账号接口

### `POST /api/auth/register`

无需已有登录。请求：

```json
{ "username": "Alice", "password": "Password123" }
```

成功返回 `201`，写入登录 Cookie，并返回：

```json
{
  "user": {
    "id": "ObjectId 字符串",
    "username": "Alice",
    "registeredAt": "2026-10-17T00:00:00.000Z"
  }
}
```

### `POST /api/auth/login`

无需已有登录。请求字段同注册。成功返回 `200`、登录 Cookie 和相同用户结构。用户名不存在和密码错误统一返回 `INVALID_CREDENTIALS`。

### `GET /api/auth/me`

需要有效登录 Cookie。成功返回 `200` 和相同用户结构。没有 Cookie 返回 `AUTH_REQUIRED`；无效、过期或已找不到对应用户的 Cookie 返回 `AUTH_INVALID`。

### `POST /api/auth/logout`

无需请求体，因此免除 JSON Content-Type 检查，但仍要求合法 `Origin`。总是清除登录 Cookie并返回无响应体的 `204`。

## 问卷主体与草稿接口

以下接口已经实现并通过里程碑 3 人工界面验收。全部需要有效登录 Cookie；写接口还必须满足通用 Origin 与 JSON 要求。

创建者使用的问卷摘要统一为：

```json
{
  "id": "survey ObjectId",
  "publicId": "URL 安全随机标识",
  "internalName": "仅创建者可见的名称",
  "status": "draft",
  "createdAt": "2026-10-17T00:00:00.000Z",
  "updatedAt": "2026-10-17T00:00:00.000Z",
  "currentVersion": null,
  "draftVersion": {
    "id": "version ObjectId",
    "versionNumber": 1,
    "title": "公开标题",
    "revision": 1
  }
}
```

### `POST /api/surveys`

请求 `{ "internalName": "课程反馈问卷" }`。成功使用事务创建问卷和 v1 草稿，返回 `201` 与 `{ "survey": 问卷摘要 }`。达到每用户问卷数量上限时返回 `SURVEY_LIMIT_REACHED`。

### `GET /api/surveys?limit=20&cursor=...`

返回当前用户的问卷，按 `updatedAt DESC, _id DESC` 排序。`limit` 默认 20、最大 50，必须是 1–50 的整数；0、负数、非整数或超过 50 均返回 `VALIDATION_ERROR`，不会静默截断。`cursor` 是不透明的带签名游标，格式、字段或签名无效时返回 `VALIDATION_ERROR`。

```json
{
  "items": ["问卷摘要"],
  "nextCursor": "下一页游标或 null"
}
```

后端对一页问卷只批量查询一次草稿版本，不能逐条查询。

### `GET /api/surveys/:surveyId`

返回 `200` 与 `{ "survey": 问卷摘要 }`。ID 不存在或不属于当前用户时返回 `SURVEY_NOT_FOUND`。

### `PATCH /api/surveys/:surveyId`

只允许 `{ "internalName": "新的内部名称" }`，成功返回 `200` 与更新后的 `{ "survey": 问卷摘要 }`。其他字段和空请求都返回 `VALIDATION_ERROR`。

### `GET /api/surveys/:surveyId/versions/:versionId`

返回完整草稿设置：

```json
{
  "version": {
    "id": "version ObjectId",
    "surveyId": "survey ObjectId",
    "versionNumber": 1,
    "status": "draft",
    "revision": 1,
    "title": "课程反馈问卷",
    "description": "",
    "identityMode": "anonymous",
    "allowMultipleSubmissions": false,
    "deadline": null,
    "sessionDurationMinutes": 30,
    "questions": [],
    "schemaVersion": 1,
    "createdAt": "2026-10-17T00:00:00.000Z",
    "updatedAt": "2026-10-17T00:00:00.000Z",
    "publishedAt": null
  }
}
```

响应不含 `ownerId` 或 `__v`。

### `PATCH /api/surveys/:surveyId/versions/:versionId`

`revision` 必填，只提交需要改变的字段。例如：

```json
{
  "revision": 1,
  "title": "新的公开标题",
  "deadline": "2026-12-31T15:00:00+08:00"
}
```

`deadline: null` 表示清除截止时间；不传表示不修改。空修改或未知字段被拒绝。成功返回 `200` 与完整 `{ "version": ... }`，其中 `revision` 已递增、版本 `updatedAt` 已刷新，并附带同步更新后的 `surveyUpdatedAt`：

```json
{
  "version": { "revision": 2 },
  "surveyUpdatedAt": "2026-10-17T00:10:00.000Z"
}
```

示例仅省略未变化字段，真实响应返回前一节定义的完整 version。

revision 过期时返回 `DRAFT_CONFLICT`，并包含当前值：

```json
{
  "error": {
    "code": "DRAFT_CONFLICT",
    "message": "草稿已在其他页面修改",
    "details": { "currentRevision": 2 }
  }
}
```

版本设置和后续题目接口共享同一个版本 revision。前端页面只维护一个 revision 状态；任一设置或题目写请求进行中时，所有设置保存、题目保存、移动和删除按钮一起禁用，成功后统一采用响应中的新值。

## 题目接口（里程碑 4 待复核候选设计，尚未实现）

题目嵌套在草稿版本的 `questions` 数组中，数组位置是唯一顺序，不返回 `order` 字段。通用结构为：

```json
{
  "questionId": "q_URL安全随机值",
  "type": "multiple",
  "title": "本课程哪些部分最有帮助？",
  "required": false,
  "validation": { "minSelections": 1, "maxSelections": 2 },
  "options": [
    { "optionId": "o_URL安全随机值", "text": "课堂讲解" },
    { "optionId": "o_URL安全随机值", "text": "课程实验" }
  ],
  "jumpRules": []
}
```

每个版本最多 100 道题。里程碑 4 中 `jumpRules` 始终为空且所有写请求都拒绝该字段。`questionId` 必须匹配 `^q_[A-Za-z0-9_-]+$`：格式错误返回 `VALIDATION_ERROR`，格式正确但不存在返回 `QUESTION_NOT_FOUND`。

所有题目写接口成功后均返回递增的版本 `revision`、刷新后的版本 `updatedAt` 和同步更新的 `surveyUpdatedAt`。前端必须采用响应中的新 revision，并串行发送后续保存、删除或移动请求。

问卷写接口共享按用户限流。里程碑 4 候选设计值为每 60 秒 120 次，由 `SURVEY_WRITE_RATE_LIMIT=120` 和 `SURVEY_WRITE_RATE_WINDOW_MS=60000` 配置；超限返回 `429 RATE_LIMITED` 和 `Retry-After`。

### `POST /api/surveys/:surveyId/versions/:versionId/questions`

新增一道题并追加到数组末尾。`validation` 必填但可以是空对象；省略的内部规则字段使用缺省值，服务端必须补全后再存入数据库。请求不得带 `questionId`、`optionId` 或 `jumpRules`；`required` 省略时为 `false`。

```json
{
  "revision": 3,
  "type": "single",
  "title": "是否愿意推荐本课程？",
  "validation": {},
  "options": [{ "text": "是" }, { "text": "否" }]
}
```

成功返回 `201`：

```json
{
  "version": {
    "id": "version ObjectId",
    "revision": 4,
    "questions": [{ "questionId": "q_新生成的ID" }]
  },
  "questionId": "q_新生成的ID",
  "surveyUpdatedAt": "2026-10-18T10:00:00.000Z"
}
```

示例中的 `version` 为缩写，真实响应返回与版本查询相同的完整结构。

### `PATCH /api/surveys/:surveyId/versions/:versionId/questions/:questionId`

虽然方法名为 PATCH，这个接口对题目定义采用**完整替换**，与版本设置的局部 PATCH 不同。请求必须完整包含 `revision`、`title`、`required`、`validation` 和 `options`；拒绝 `type`、`questionId`、`jumpRules`、未知字段和空请求。

```json
{
  "revision": 4,
  "title": "请选择最有帮助的部分",
  "required": true,
  "validation": { "minSelections": 1, "maxSelections": 2 },
  "options": [
    { "optionId": "o_已有ID", "text": "课堂讲解" },
    { "text": "课后讨论" }
  ]
}
```

保留的旧选项必须使用原 `optionId`；新选项不得自带 ID。任何不属于当前题目的 `optionId`，包括伪造或借用其他题目的 ID，都返回 `VALIDATION_ERROR`。成功返回 `200`、完整 `{ version, surveyUpdatedAt }`。

前端必须按接口白名单构造请求体，不能展开后端返回的题目对象直接回传；PATCH 必须移除只读的 `type`、`questionId` 和 `jumpRules`，并显式包含 `required`。缺少 `required` 返回 `400 VALIDATION_ERROR`。

### `DELETE /api/surveys/:surveyId/versions/:versionId/questions/:questionId`

请求体固定为：

```json
{ "revision": 5 }
```

缺少或错误类型的 revision 返回 `VALIDATION_ERROR`。成功返回 `200`、完整 `{ version, surveyUpdatedAt }`。实现验收必须确认 Vite `/api` 代理不会丢弃 DELETE 的 JSON 请求体；若实测丢失，统一改为 `?revision=5` 查询参数，不同时支持两种传法。

### `PUT /api/surveys/:surveyId/versions/:versionId/question-order`

使用独立路径避免静态 `reorder` 与 `:questionId` 路由冲突。请求必须给出当前全部题目 ID，且集合完全一致：

```json
{
  "revision": 6,
  "questionIds": ["q_second", "q_first", "q_third"]
}
```

缺少、重复、多余或格式错误的 ID 返回 `VALIDATION_ERROR`。成功返回 `200`、完整 `{ version, surveyUpdatedAt }`。

只有一道题或提交与当前相同顺序时仍返回成功，并刷新时间、使 revision 加一。

### 题目规则与答案形态

| 题型       | 关键定义规则                                                         | 答案形态          | 未回答                   |
| ---------- | -------------------------------------------------------------------- | ----------------- | ------------------------ |
| `single`   | 2–50 个选项                                                          | `optionId` 字符串 | 缺失或 `null`            |
| `multiple` | 默认 `min=1`、`max=选项数`，且 `1 ≤ min ≤ max ≤ 选项数`              | `optionId` 数组   | 缺失或空数组             |
| `text`     | 默认 `minLength=0`、`maxLength=2000`；`digitsOnly` 仅接受 ASCII 数字 | 字符串            | 缺失或 trim 后为空字符串 |
| `number`   | 有限数值且位于 `±(2^53-1)` 内，可限制整数和上下界                    | 数值              | 缺失或 `null`            |

`validation` 的缺省字段在写入时补全为规范形式：单选为 `{}`，多选显式存储 min/max，文本显式存储 min/max/digitsOnly，数字显式存储 integerOnly 且无边界时把 min/max 存为 `null`。发布版本不依赖运行时代码缺省值。文本先做 NFC 规范化并去除首尾 Unicode 空白，再校验和保存；数字 `-0` 接受但规范化为 `0`，`Infinity` 被拒绝。必答题未回答时失败，非必答题未回答时跳过其他校验。纯函数 `validateAnswer` 成功时返回规范化的 `value` 与 `answered`，失败时返回字段路径和原因；完整返回结构、默认值和边界见 `QUESTION_DESIGN.md`。

### 题目写入的错误判定顺序

1. 请求结构、路径格式、字段类型错误：`400 VALIDATION_ERROR`。
2. 问卷/版本不存在、组合错误或不属于当前用户：`404 SURVEY_NOT_FOUND`。
3. 版本不是草稿：`409 VERSION_NOT_EDITABLE`。
4. revision 过期：`409 DRAFT_CONFLICT`。
5. 格式正确的题目 ID 不存在：`404 QUESTION_NOT_FOUND`。
6. 题数上限、重复选项等业务规则失败；达到 100 题时返回 `409 QUESTION_LIMIT_REACHED`。

第 1 步只判断 JSON 形态、字段白名单、必填字段、原始类型和 ID 格式；长度、选项归属、完整排序集合及跨字段约束属于后续业务规则。业务规则没有专用错误码时仍返回 `400 VALIDATION_ERROR`。字段错误使用稳定的 `details.path`，例如 `validation.maxSelections`、`options[2].text` 或 `questionIds[3]`，前端据此显示就近错误。

## 稳定错误码

| HTTP | 错误码                   | 含义                                                       |
| ---: | ------------------------ | ---------------------------------------------------------- |
|  400 | `VALIDATION_ERROR`       | 字段类型、规则或 JSON 格式错误                             |
|  401 | `AUTH_REQUIRED`          | 未提供登录 Cookie                                          |
|  401 | `AUTH_INVALID`           | 登录令牌或对应用户无效                                     |
|  401 | `INVALID_CREDENTIALS`    | 用户名或密码错误                                           |
|  403 | `ORIGIN_NOT_ALLOWED`     | 写请求来源缺失或不匹配                                     |
|  404 | `NOT_FOUND`              | `/api` 下路由不存在                                        |
|  404 | `SURVEY_NOT_FOUND`       | 问卷/版本不存在、不属于当前用户或组合错误                  |
|  404 | `QUESTION_NOT_FOUND`     | 格式合法的题目 ID 在目标版本中不存在                       |
|  409 | `USERNAME_TAKEN`         | 规范化用户名已存在                                         |
|  409 | `VERSION_NOT_EDITABLE`   | 目标版本已经发布，不能通过草稿接口修改                     |
|  409 | `DRAFT_CONFLICT`         | 草稿 revision 已变化；`details.currentRevision` 返回当前值 |
|  409 | `SURVEY_LIMIT_REACHED`   | 当前用户已达到可创建的问卷数量上限                         |
|  409 | `QUESTION_LIMIT_REACHED` | 草稿已经达到 100 道题上限                                  |
|  413 | `PAYLOAD_TOO_LARGE`      | JSON 请求体超过 256 KiB                                    |
|  415 | `UNSUPPORTED_MEDIA_TYPE` | 带请求体的接口未使用 `application/json`                    |
|  429 | `RATE_LIMITED`           | 请求超过限流；响应含 `Retry-After`                         |
|  500 | `INTERNAL_ERROR`         | 未预期服务错误，不向客户端暴露内部信息                     |

## 当前实现边界

登录 Cookie 有效期为 2 小时，不提供刷新或服务端撤销。限流保存在单进程内存中，重启会清空且多实例不共享；生产多实例部署应换成 Redis 等共享存储。账号与问卷草稿接口已经实现并通过自动测试和人工验收。里程碑 4 的题目接口目前只有待人工复核的候选设计，尚未实现；发布、填写和统计也尚未开始。
