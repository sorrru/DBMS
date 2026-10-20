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
    "revision": 1,
    "deadline": null
  }
}
```

里程碑 6 起摘要状态固定为 `draft | published | closed | expired`；`currentVersion` 和 `draftVersion` 均带 `deadline`。状态由共享函数根据当前版本、手工状态和服务端时钟计算。

### `POST /api/surveys`

请求 `{ "internalName": "课程反馈问卷" }`。成功使用事务创建问卷和 v1 草稿，返回 `201` 与 `{ "survey": 问卷摘要 }`。达到每用户问卷数量上限时返回 `SURVEY_LIMIT_REACHED`。

### `GET /api/surveys?limit=20&cursor=...`

返回当前用户的问卷，按 `updatedAt DESC, _id DESC` 排序。`limit` 默认 20、最大 50，必须是 1–50 的整数；0、负数、非整数或超过 50 均返回 `VALIDATION_ERROR`，不会静默截断。`cursor` 是不透明的带签名游标，负载固定为 `{ kind: "surveys", updatedAt, id }`；格式、精确字段集合、kind 或签名无效时返回 `VALIDATION_ERROR`。

```json
{
  "items": ["问卷摘要"],
  "nextCursor": "下一页游标或 null"
}
```

后端对一页问卷一次收集 `currentVersionId` 与 `draftVersionId`，再批量查询版本，不能逐条查询。

### `GET /api/surveys/:surveyId`

返回 `200` 与 `{ "survey": 问卷摘要 }`。ID 不存在或不属于当前用户时返回 `SURVEY_NOT_FOUND`。

### `PATCH /api/surveys/:surveyId`

只允许 `{ "internalName": "新的内部名称" }`，成功返回 `200` 与更新后的 `{ "survey": 问卷摘要 }`。其他字段和空请求都返回 `VALIDATION_ERROR`。

### `GET /api/surveys/:surveyId/versions/:versionId`

返回完整版本定义；草稿可编辑，发布版本只读：

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

## 题目接口（里程碑 4 已实现并验收）

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

每个版本最多 100 道题。普通题目创建和修改请求始终拒绝 `jumpRules` 字段；里程碑 5 使用独立规则接口管理它，题目修改必须保留已经存在的规则。`questionId` 必须匹配 `^q_[A-Za-z0-9_-]+$`：格式错误返回 `VALIDATION_ERROR`，格式正确但不存在返回 `QUESTION_NOT_FOUND`。

所有题目写接口成功后均返回递增的版本 `revision`、刷新后的版本 `updatedAt` 和同步更新的 `surveyUpdatedAt`。前端必须采用响应中的新 revision，并串行发送后续保存、删除或移动请求。

问卷写接口共享按用户限流，当前默认值为每 60 秒 120 次，由 `SURVEY_WRITE_RATE_LIMIT=120` 和 `SURVEY_WRITE_RATE_WINDOW_MS=60000` 配置；超限返回 `429 RATE_LIMITED` 和 `Retry-After`。

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

缺少或错误类型的 revision 返回 `VALIDATION_ERROR`。成功返回 `200`、完整 `{ version, surveyUpdatedAt }`。里程碑 4 人工验收已经确认 Vite `/api` 代理不会丢弃该 JSON 请求体。

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

## 跳转规则与发布检查（里程碑 5 已实现并验收）

规则使用扁平结构：

```json
{
  "ruleId": "r_URL安全随机值",
  "operator": "containsAny",
  "value": ["o_lecture", "o_lab"],
  "targetQuestionId": "q_follow_up"
}
```

支持的操作符为：单选 `equals`；多选 `contains`、`containsAll`、`containsAny`；数字 `equals`、`gt`、`gte`、`lt`、`lte`；文本题不支持规则。未回答时任何规则都不匹配并走默认下一题。路由只接受 `validateAnswer` 的规范答案形态，数字字符串、外来选项或重复多选值等非规范输入按未回答路由，之后仍由答案校验拒绝。数组型规则值非空、无重复且不超过选项数，服务端存储时按来源题选项顺序规范化。数字使用 JSON 数值精确比较，`-0` 规范化为 `0`。规则不依赖数字题的上下界或整数限制。

### `PUT /api/surveys/:surveyId/versions/:versionId/questions/:questionId/jump-rules`

完整替换一道来源题的规则数组：

```json
{
  "revision": 8,
  "rules": [
    {
      "operator": "equals",
      "value": "o_yes",
      "targetQuestionId": "q_follow_up"
    }
  ]
}
```

已有规则携带原 `ruleId`，新规则不得自带 ID。每题默认最多 20 条规则，由 `JUMP_RULE_MAX_PER_QUESTION` 配置；启动时必须是 1–100 的整数，否则 API 拒绝启动。超限返回 `VALIDATION_ERROR`。成功返回完整 `{ version, surveyUpdatedAt }` 并使 revision 加一。

接口沿用题目写入的六步错误顺序。来源题不存在返回 `QUESTION_NOT_FOUND`；目标题不存在、目标题格式错误、自跳转、条件选项不属于来源题均返回 `VALIDATION_ERROR`，路径分别指向 `rules[i].targetQuestionId` 或 `rules[i].value`。指向更靠前题目的规则和不可达状态可以保存在草稿中，发布检查再判断真实循环。

加入规则后，题目 PATCH 删除被条件引用的选项时返回 `OPTION_REFERENCED`；题目 DELETE 删除被其他规则指向的题目时返回 `QUESTION_REFERENCED`。两者属于第 6 步业务规则，`details.references` 是 `{ questionId, ruleId }[]`。普通题目 PATCH 仍拒绝请求中的 `jumpRules`，但必须在服务端保留现有规则。

### `POST /api/surveys/:surveyId/versions/:versionId/validate`

请求固定为：

```json
{ "revision": 9 }
```

只允许检查草稿；发布版本返回 `VERSION_NOT_EDITABLE`，过期 revision 返回 `DRAFT_CONFLICT`。检查不修改版本、问卷、时间或 revision。只要请求本身有效，始终返回 HTTP 200：

```json
{
  "revision": 9,
  "valid": false,
  "errors": [
    {
      "code": "JUMP_CYCLE",
      "path": "questions[2].jumpRules[0]",
      "message": "该规则指向更靠前的题目并形成循环",
      "questionId": "q_3",
      "ruleId": "r_back",
      "questionIds": ["q_3", "q_1", "q_3"]
    }
  ],
  "warnings": [
    {
      "code": "QUESTION_UNREACHABLE",
      "path": "questions[1]",
      "message": "该题无法从第一题到达",
      "questionId": "q_2"
    }
  ]
}
```

`valid` 等于 `errors.length === 0`。默认边只在可能没有规则命中时存在：必答单选题的规则覆盖全部选项时不画默认边；非必答单选、多选、数字及未覆盖全部选项的单选保守地保留默认边。

循环报告不依赖 DFS 遍历顺序。对每条从可达来源题指向更靠前题目的规则，如果目标题在精确图中能回到来源题，就为该规则单独返回一个 `JUMP_CYCLE`，`questionIds` 是经过该规则的最短回路。错误和警告按题目顺序、规则顺序稳定排序。

发布检查还防御性复核目标题、选项归属、题目/选项/规则 ID 全局唯一，以及题数和选项数上限。结构损坏、循环、空问卷和已经过去的截止时间阻止发布；不可达题目和被相同条件遮蔽的后续规则只警告。里程碑 6 的发布事务必须用同一个共享函数重新检查。

响应 `revision` 表示实际检查的草稿。题目相关结果始终包含 `questionId`，规则相关结果还包含 `ruleId`；`DEADLINE_PASSED.path` 固定为 `deadline`。任何写入成功后，前端清除或置灰旧检查结果。`SHADOWED_RULE` 指向被遮蔽规则，并在消息中标出遮蔽它的规则位置。

检查结果代码与非 2xx API 错误码分开：

| 类别 | 代码                   | 含义                   |
| ---- | ---------------------- | ---------------------- |
| 阻止 | `INVALID_STRUCTURE`    | 内部结构或稳定 ID 损坏 |
| 阻止 | `EMPTY_SURVEY`         | 问卷没有题目           |
| 阻止 | `JUMP_CYCLE`           | 精确跳转图存在循环     |
| 阻止 | `DEADLINE_PASSED`      | 截止时间已经过去       |
| 警告 | `QUESTION_UNREACHABLE` | 题目无法从第一题到达   |
| 警告 | `SHADOWED_RULE`        | 前面的相同条件会先命中 |

完整图模型、共享函数和测试边界见 `JUMP_DESIGN.md`。

## 版本发布与生命周期（里程碑 6 已实现）

### `POST /api/surveys/:surveyId/versions/:versionId/publish`

请求必须同时提供当前 revision 和明确的警告确认布尔值：

```json
{ "revision": 9, "acknowledgeWarnings": false }
```

`acknowledgeWarnings` 必填且不得使用真值转换。后端在发布事务内重新读取草稿并运行与检查接口相同的 `validateForPublish`：有阻止项返回 `409 PUBLISH_BLOCKED`；只有警告且尚未确认时返回 `409 PUBLISH_WARNINGS_UNCONFIRMED`。两者的 `details.check` 均为完整检查结果。用 `acknowledgeWarnings: true` 重试时仍使用同一 revision；内容变化会先返回 `DRAFT_CONFLICT`，不能确认旧警告。

错误顺序固定为：请求结构 400 → 问卷/版本 404 → `VERSION_NOT_EDITABLE` → `DRAFT_CONFLICT` → `PUBLISH_BLOCKED` → `PUBLISH_WARNINGS_UNCONFIRMED`。成功返回 `200` 与完整 `{ survey, version, check }`。发布把版本状态与 `publishedAt` 同时写入，切换 `currentVersionId`，清空 `draftVersionId`，但不增加 revision、不改变 `manualStatus`。`withTransaction` 每次执行回调时重新读取 now；同一次回调内的 `publishedAt`、版本 `updatedAt` 和问卷 `updatedAt` 使用同一个值。

版本更新条件包含 `{ _id, surveyId, status: "draft", revision }`；问卷更新条件包含 `{ _id, ownerId, draftVersionId: versionId }`。条件未命中时中止事务并重新诊断，不能使用无条件写入。

### `POST /api/surveys/:surveyId/versions`

从当前发布版本创建下一版本草稿：

```json
{ "sourceVersionId": "当前发布版本 ObjectId" }
```

判定顺序为：请求结构 400 → 问卷或所有权 404 → 没有当前版本 `SURVEY_NOT_PUBLISHED` → 已有草稿 `DRAFT_ALREADY_EXISTS` → 来源不是当前版本 `SOURCE_VERSION_NOT_CURRENT`。成功返回 `201` 与 `{ survey, version }`。

新版本 `revision=1`、`status=draft`、`publishedAt=null`，版本号为当前版本加一。服务端通过字段白名单和 `structuredClone` 深复制问卷定义，保留题目、选项和规则 ID，不复制数据库 ID、状态和时间戳。事务内条件更新要求 `draftVersionId:null` 且 `currentVersionId:sourceVersionId`，并同步刷新 `surveys.updatedAt`。部分唯一索引继续兜底并发草稿创建。

### `DELETE /api/surveys/:surveyId/versions/:versionId`

放弃下一版本草稿，请求体为 `{ "revision": 3 }`。只允许删除当前草稿指针指向的版本，且问卷已经有发布版本；初始 v1 草稿和发布版本不能删除。判定顺序为：请求结构 400 → 问卷/版本/所有权/组合 404 → `SURVEY_NOT_PUBLISHED` → `VERSION_NOT_EDITABLE` → `DRAFT_CONFLICT`。初始 v1 的错误消息为“初始草稿不能放弃”。Vite 代理已在里程碑 4 的人工测试中确认会保留 DELETE JSON 请求体。

成功返回 `200` 与更新后的 `{ survey }`。删除事务同时清空 `draftVersionId`、刷新 `surveys.updatedAt`；以后重新创建时仍使用 `currentVersionNumber + 1`，不会产生空洞。

### `GET /api/surveys/:surveyId/versions?limit=20&cursor=...`

先校验问卷所有权，再按 `versionNumber DESC` 返回历史摘要。`limit` 必须是 1–50 的整数。聚合使用 `$project` 和 `$size` 在数据库中计算 `questionCount`，不把完整 questions 数组读回应用层。

游标负载固定为 `{ kind: "versions", surveyId, versionNumber }`；问卷列表负载固定为 `{ kind: "surveys", updatedAt, id }`。两者使用由 `survey-cursor-signing-key:v2` 派生的通用签名密钥，以签名负载中的 kind 隔离用途。跨接口、跨问卷、字段集合错误、格式错误或签名错误的游标均返回 `VALIDATION_ERROR`。

每项返回 `id`、`versionNumber`、版本 `status`、`title`、`questionCount`、`revision`、`deadline`、`createdAt`、`updatedAt`、`publishedAt`、`isCurrent` 和 `isDraft`。完整版本继续使用现有详情接口读取；发布版本只读。

### `PATCH /api/surveys/:surveyId/status`

请求只允许 `{ "manualStatus": "closed" }` 或 `{ "manualStatus": "open" }`，未知字段返回 `VALIDATION_ERROR`。条件更新同时匹配 `ownerId`、非空 `currentVersionId` 与请求值相反的 `manualStatus`；真正变化时才刷新 `surveys.updatedAt`。未命中后重新读取：不存在或越权返回 404，无当前版本返回 `SURVEY_NOT_PUBLISHED`，已经是请求值则幂等成功且不更新时间。响应使用当前版本的 `deadline` 计算有效状态后返回 `{ survey }`；重新开放不能绕过已经过去的截止时间。

发布条件更新、两层创建并发保护、放弃草稿、共享时钟、历史聚合、失败注入和前端提示的完整约定见 `VERSION_LIFECYCLE_DESIGN.md`。

## 公开填写接口（里程碑 7 已实现）

下列接口的成功和错误响应都设置 `Cache-Control: no-store`。公开响应使用严格白名单，不返回 `surveyId`、revision、时间戳、`allowMultipleSubmissions`、userId、ownerKey、令牌摘要、活动槽位或 MongoDB 内部字段。完整安全、Cookie、状态、限流和恢复约定见 `FILL_SESSION_DESIGN.md`。

### `GET /api/public/surveys/:publicId`

无需登录。成功返回 200：

```json
{
  "survey": {
    "publicId": "URL 安全公开标识",
    "status": "published",
    "title": "课程反馈",
    "description": "请按真实情况填写",
    "identityMode": "anonymous",
    "deadline": null,
    "questionCount": 5,
    "sessionDurationMinutes": 30
  }
}
```

关闭和到期的问卷仍返回摘要，status 分别为 `closed` 和 `expired`，前端禁用开始按钮并解释原因。publicId 不存在、问卷从未发布或只有草稿统一返回 `PUBLIC_SURVEY_NOT_FOUND`。

### `POST /api/public/surveys/:publicId/sessions`

需要有效登录 Cookie，必须发送 JSON 空对象 `{}`，未知字段返回 `VALIDATION_ERROR`。成功返回 201，设置动态 Path 的 `survey_fill` HttpOnly Cookie，并返回：

```json
{
  "session": {
    "id": "session ObjectId",
    "status": "active",
    "startedAt": "2026-10-20T00:00:00.000Z",
    "expiresAt": "2026-10-20T00:30:00.000Z",
    "serverNow": "2026-10-20T00:00:00.000Z"
  },
  "version": {
    "id": "version ObjectId",
    "versionNumber": 2,
    "title": "课程反馈",
    "description": "请按真实情况填写",
    "identityMode": "anonymous",
    "deadline": null,
    "sessionDurationMinutes": 30,
    "questions": ["填写所需的题目、选项、校验和跳转规则"]
  }
}
```

创建会话不会刷新两小时登录 JWT。`survey_fill` Cookie 固定为 HttpOnly、SameSite=Lax、Path `/api/public/sessions/{sessionId}`，Max-Age 为会话时长，Secure 仅在生产开启。创建接口先执行账号+IP 与 IP 总量限流，再按公开问卷不存在、手工关闭、当前版本截止、禁止重复时已经提交、五个活动会话上限的顺序判定。里程碑 7 尚无 responses 集合，因此 `ALREADY_SUBMITTED` 只预留服务边界，里程碑 8 接入真实查询。

### `GET /api/public/sessions/:sessionId`

同时需要登录 Cookie 和动态 Path 的填写 Cookie。成功返回与创建接口相同的 session、serverNow 和版本白名单，用于刷新或重新登录后的恢复。会话/令牌不存在、令牌属于另一会话、当前账号不是创建者均统一返回 `SESSION_NOT_FOUND`。随后按手工关闭、绑定版本截止、会话 30 分钟到期判定。旧会话使用自己绑定版本的 deadline，不使用当前版本截止时间。

填写令牌永不出现在路径或 JSON 中。

### `POST /api/public/sessions/:sessionId/submit`（里程碑 8 待实现）

同时需要登录 Cookie 和动态 Path 的填写 Cookie。请求只允许：

```json
{
  "answers": [
    { "questionId": "q_1", "value": "option_a" },
    { "questionId": "q_3", "value": "文本回答" }
  ]
}
```

answers 必填、可以为空、最多 100 项；每项只允许 questionId 和 value。value 的结构只允许字符串、有限数值、最多 50 项的字符串数组或 null。未知或重复题目 ID、未知字段和非法原始类型返回 `VALIDATION_ERROR`，details.path 指向原请求下标。

该接口先执行 Origin、Content-Type、登录与会话所有权检查，再处理已提交会话的幂等返回、账号/会话限流和关闭/截止/会话到期，最后才用独立 4 MiB 解析器读取正文。全局 256 KiB 解析器跳过本路径；未认证的超大请求返回 401 而不是 413。

服务端不接受客户端路径，从第一题开始重新计算真实 questionPath。只校验路径内答案；跳过的必答题不要求回答。已知但位于路径外的答案只经过通用 JSON 结构预检，不执行题型和值域校验，不保存；响应按版本题目顺序返回 ignoredQuestionIds。未知题目 ID 始终拒绝。多选答案按版本选项顺序保存。

路径内校验错误一次返回，按真实路径顺序排列：

```json
{
  "error": {
    "code": "ANSWER_VALIDATION_FAILED",
    "message": "部分回答不符合要求",
    "details": {
      "issues": [
        {
          "questionId": "q_3",
          "code": "REQUIRED",
          "path": "",
          "message": "此题为必答题"
        }
      ]
    }
  }
}
```

存在请求项时 path 使用 `answers[n].value`；完全缺失的必答题 path 为空。code 是稳定机器码，包含 REQUIRED、TYPE_MISMATCH、UNKNOWN_OPTION、DUPLICATE_SELECTION、SELECTION_COUNT、TOO_SHORT、TOO_LONG、DIGITS_ONLY、OUT_OF_RANGE 和 NOT_INTEGER。

首次成功返回 201：

```json
{
  "submission": {
    "id": "response ObjectId",
    "submittedAt": "2026-10-20T14:30:00.000Z",
    "versionId": "version ObjectId",
    "questionPath": ["q_1", "q_3"],
    "ignoredQuestionIds": ["q_2"],
    "alreadySubmitted": false
  }
}
```

所有权验证后若会话已经 submitted，服务在检查关闭、截止、会话到期和解析正文之前，按 fillSessionId 返回第一次保存的结果，状态为 200、alreadySubmitted 为 true；不读取或比较重试正文。首次和幂等成功都用与创建时相同的 Cookie Name 和 Path 清除 survey_fill，设置 Max-Age=0。

事务内每次重试重新取得 now，先用 active 与 expiresAt 条件把会话更新为 submitted、清空 activeSlot，再插入 response。两个写入使用相同 submittedAt；任何失败完全回滚。禁止重复由 `(surveyVersionId,dedupKey)` 条件唯一索引保证，同会话唯一性由 fillSessionId 唯一索引保证。完整约定见 `RESPONSE_SUBMISSION_DESIGN.md`。

## 稳定错误码

| HTTP | 错误码                         | 含义                                                       |
| ---: | ------------------------------ | ---------------------------------------------------------- |
|  400 | `VALIDATION_ERROR`             | 字段类型、规则或 JSON 格式错误                             |
|  400 | `ANSWER_VALIDATION_FAILED`     | 真实路径上的一个或多个回答不符合题目规则                   |
|  401 | `AUTH_REQUIRED`                | 未提供登录 Cookie                                          |
|  401 | `AUTH_INVALID`                 | 登录令牌或对应用户无效                                     |
|  401 | `INVALID_CREDENTIALS`          | 用户名或密码错误                                           |
|  403 | `ORIGIN_NOT_ALLOWED`           | 写请求来源缺失或不匹配                                     |
|  404 | `NOT_FOUND`                    | `/api` 下路由不存在                                        |
|  404 | `SURVEY_NOT_FOUND`             | 问卷/版本不存在、不属于当前用户或组合错误                  |
|  404 | `QUESTION_NOT_FOUND`           | 格式合法的题目 ID 在目标版本中不存在                       |
|  404 | `PUBLIC_SURVEY_NOT_FOUND`      | publicId 不存在或问卷尚未发布                              |
|  404 | `SESSION_NOT_FOUND`            | 会话、填写令牌或当前账号不匹配，统一隐藏存在性             |
|  409 | `USERNAME_TAKEN`               | 规范化用户名已存在                                         |
|  409 | `VERSION_NOT_EDITABLE`         | 目标版本已经发布，不能通过草稿接口修改                     |
|  409 | `DRAFT_CONFLICT`               | 草稿 revision 已变化；`details.currentRevision` 返回当前值 |
|  409 | `SURVEY_LIMIT_REACHED`         | 当前用户已达到可创建的问卷数量上限                         |
|  409 | `QUESTION_LIMIT_REACHED`       | 草稿已经达到 100 道题上限                                  |
|  409 | `QUESTION_REFERENCED`          | 题目仍被其他跳转规则作为目标引用                           |
|  409 | `OPTION_REFERENCED`            | 选项仍被来源题的跳转条件引用                               |
|  409 | `PUBLISH_BLOCKED`              | 发布检查存在阻止项；details 返回最新检查                   |
|  409 | `PUBLISH_WARNINGS_UNCONFIRMED` | 发布警告尚未明确确认                                       |
|  409 | `DRAFT_ALREADY_EXISTS`         | 问卷已经有下一版本草稿                                     |
|  409 | `SURVEY_NOT_PUBLISHED`         | 操作要求问卷已有当前发布版本                               |
|  409 | `SOURCE_VERSION_NOT_CURRENT`   | 创建草稿的来源不是当前发布版本                             |
|  409 | `SURVEY_CLOSED`                | 问卷被创建者手工关闭                                       |
|  409 | `SURVEY_EXPIRED`               | 会话绑定版本的截止时间已到                                 |
|  409 | `SESSION_EXPIRED`              | 填写会话自身的 30 分钟期限已到                             |
|  409 | `SESSION_LIMIT_REACHED`        | 同一账号在同一问卷已有五个活动会话                         |
|  409 | `ALREADY_SUBMITTED`            | 禁止重复时当前 ownerKey 已向该版本提交                     |
|  409 | `SURVEY_VERSION_INVALID`       | 发布版本内部结构损坏，无法可信计算提交路径                 |
|  413 | `PAYLOAD_TOO_LARGE`            | 普通 JSON 超过 256 KiB，或提交正文超过 4 MiB               |
|  415 | `UNSUPPORTED_MEDIA_TYPE`       | 带请求体的接口未使用 `application/json`                    |
|  429 | `RATE_LIMITED`                 | 请求超过限流；响应含 `Retry-After`                         |
|  500 | `INTERNAL_ERROR`               | 未预期服务错误，不向客户端暴露内部信息                     |

## 当前实现边界

登录 Cookie 有效期为 2 小时，不提供刷新或服务端撤销。限流保存在单进程内存中，重启会清空且多实例不共享；生产多实例部署应换成 Redis 等共享存储。账号、问卷、题目、跳转、发布检查、完整版本生命周期和正式提交前的公开填写会话均已实现并验收。正式回答提交已完成设计、尚未编码；统计尚未开始。
