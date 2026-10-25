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

创建会话不会刷新两小时登录 JWT。`survey_fill` Cookie 固定为 HttpOnly、SameSite=Lax、Path `/api/public/sessions/{sessionId}`，Max-Age 为会话时长，Secure 仅在生产开启。创建接口先执行账号+IP 与 IP 总量限流，再按公开问卷不存在、手工关闭、当前版本截止、禁止重复时已经提交、五个活动会话上限的顺序判定。禁止重复时通过 responses 的版本与 dedupKey 查询，在填写开始前返回 `ALREADY_SUBMITTED`；最终并发正确性仍由条件唯一索引保证。

### `GET /api/public/sessions/:sessionId`

同时需要登录 Cookie 和动态 Path 的填写 Cookie。成功返回与创建接口相同的 session、serverNow 和版本白名单，用于刷新或重新登录后的恢复。会话/令牌不存在、令牌属于另一会话、当前账号不是创建者均统一返回 `SESSION_NOT_FOUND`。随后按手工关闭、绑定版本截止、会话 30 分钟到期判定。旧会话使用自己绑定版本的 deadline，不使用当前版本截止时间。

填写令牌永不出现在路径或 JSON 中。

### `POST /api/public/sessions/:sessionId/submit`

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

## 按版本统计

### `GET /api/surveys/:surveyId/versions/:versionId/statistics`

只允许问卷创建者读取已发布版本；草稿返回 `VERSION_NOT_PUBLISHED`。不接受任何查询参数。成功返回版本标题、提交总数、生成时间和全部题目的统计。每题固定包含 `questionId`、`type`、`title`、`required`、`reachedCount`、`answeredCount`、`notReachedCount`、`unansweredReachedCount`、`reachRate` 和 `answerRate`。

单选、多选按发布版本选项顺序返回 count 与 percentageOfAnswered；数字题返回 count、average、minimum、maximum，无数值答案时后三项为 null；文本正文不进入统计摘要。比例分母为零时返回 0，其他结果不提前按显示位数舍入。

统计在 `readConcern: snapshot` 的只读事务中执行五条有 `maxTimeMS` 的聚合：提交总数、路径到达、题目回答、合并选择题选项和数字汇总。事务内禁止 explain、`$out` 和 `$merge`。超时或无法完成快照返回 `503 STATISTICS_UNAVAILABLE`。

### `GET /api/surveys/:surveyId/versions/:versionId/responses`

只分页读取文本题回答。查询参数：

- `questionId` 必填，必须是目标发布版本中的文本题；
- `limit` 缺省 20，必须是 1–50 的整数；
- `cursor` 可选，必须是绑定当前问卷、版本和题目的 AES-256-GCM 不透明游标；
- 未知查询参数返回 `VALIDATION_ERROR`。

分页先以 `surveyVersionId`、`answers.questionId` 和游标范围 `$match`，按 `submittedAt DESC, _id DESC` 沿既有索引排序并多取一条，最后通过 `$filter` 和 `$arrayElemAt` 投影目标文本。实名页以一次 `_id: {$in: [...]}` 批量读取账号。

匿名项只返回 value 和 UTC `submittedDate`，不返回 ID、精确时间或身份字段；实名项返回 value、精确 submittedAt 和 respondent 的 id、username。匿名页游标使用从 JWT_SECRET 和专用标签派生的 AES-256-GCM 密钥，随机 IV 与认证标签同时保证机密性和防篡改。完整隐私边界、管道和测试约定见 `STATISTICS_DESIGN.md`。

### `GET /api/surveys/:surveyId/versions/:versionId/submissions`

只允许问卷创建者读取已发布的实名版本，用于在没有文本回答时仍能核对全部填写账号。匿名版本返回 `400 VALIDATION_ERROR`，绝不返回账号或精确提交时间。

- `limit` 缺省 20，必须是 1–50 的整数；
- `cursor` 可选，必须是绑定当前问卷、版本和 `identified-submissions` 类型的 AES-256-GCM 不透明游标；
- 未知查询参数返回 `VALIDATION_ERROR`。

每次正式提交单独返回一项，不按账号去重；允许重复填写时，同一账号可出现多次。结果按 `submittedAt DESC, _id DESC` 排序，沿既有版本时间索引分页。每项只含精确 `submittedAt` 和 respondent 的 id、username；账号已删除时 respondent 为 null。响应不含 response id、答案、ownerKey、dedupKey 或 fillSessionId，并设置 `Cache-Control: no-store`。

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
|  409 | `VERSION_NOT_PUBLISHED`        | 统计目标版本不是已发布版本                                 |
|  413 | `PAYLOAD_TOO_LARGE`            | 普通 JSON 超过 256 KiB，或提交正文超过 4 MiB               |
|  415 | `UNSUPPORTED_MEDIA_TYPE`       | 带请求体的接口未使用 `application/json`                    |
|  429 | `RATE_LIMITED`                 | 请求超过限流；响应含 `Retry-After`                         |
|  500 | `INTERNAL_ERROR`               | 未预期服务错误，不向客户端暴露内部信息                     |
|  503 | `STATISTICS_UNAVAILABLE`       | 统计查询超时或暂时无法取得一致快照                         |

## 当前实现边界

登录 Cookie 有效期为 2 小时，不提供刷新或服务端撤销。限流保存在单进程内存中，重启会清空且多实例不共享；生产多实例部署应换成 Redis 等共享存储。账号、问卷、题目、跳转、发布检查、完整版本生命周期、公开填写会话、正式回答提交和按版本统计均已实现并完成当前里程碑验收。

## 第二阶段里程碑 1 独立题目与版本

本节为已经实现的独立题目管理接口。题目选入问卷、共享授权、题库成员和跨问卷统计不在本里程碑接口范围。题库身份名为 `libraryQuestionId`，具体内容版本为 `questionVersionId`；原问卷中的 `questionId` 继续表示问卷实例。

### 认证和公共规则

所有 `/api/questions` 接口要求现有登录 Cookie。写入继续要求正确 Origin 与 application/json，使用独立 `library-write:{userId}` 限流键，阈值沿用 `SURVEY_WRITE_RATE_LIMIT` 和 `SURVEY_WRITE_RATE_WINDOW_MS`。当前写入顺序为公共 Origin 与正文检查、认证、写限流、路径与正文解析、服务所有权和版本状态检查；无效请求也可能消耗写限额。

资源 ID 仅接受 24 位小写十六进制字符串；合法但越权或不属于该题目的版本均返回 `404 LIBRARY_QUESTION_NOT_FOUND`。正文拒绝未知字段，客户端不能写 ownerId、冻结标记、来源或版本号。分页只允许 limit 和 cursor；limit 默认 20、范围 1–50，游标绑定当前用户和资源类型或具体题目，不可跨用户或跨题目使用。列表按身份 `_id` 降序，历史按 versionNumber 降序；分页不承诺并发编辑下的快照读取。

### 接口索引

| 方法  | 路径                                                                 | 作用                         | 成功状态 |
| ----- | -------------------------------------------------------------------- | ---------------------------- | -------- |
| POST  | `/api/questions`                                                     | 创建独立题目及 v1            | 201      |
| GET   | `/api/questions`                                                     | 分页列出自己的题目和最新版本 | 200      |
| GET   | `/api/questions/:libraryQuestionId`                                  | 身份、最新版本及修改状态     | 200      |
| GET   | `/api/questions/:libraryQuestionId/versions`                         | 分页历史                     | 200      |
| GET   | `/api/questions/:libraryQuestionId/versions/:questionVersionId`      | 指定版本与修改状态           | 200      |
| PATCH | `/api/questions/:libraryQuestionId/versions/:questionVersionId`      | 原地修改未冻结版本           | 200      |
| POST  | `/api/questions/:libraryQuestionId/versions`                         | 从选定版本派生新版本         | 201      |
| POST  | `/api/questions/:libraryQuestionId/restore`                          | 恢复旧内容为新版本           | 201      |
| POST  | `/api/questions/:libraryQuestionId/versions/:questionVersionId/copy` | 所有者另存独立新题           | 201      |

### 题目定义与创建

```json
{
  "type": "number",
  "title": "你的年龄",
  "required": true,
  "validation": { "integerOnly": true, "minValue": 0, "maxValue": 120 },
  "options": []
}
```

创建支持 single、multiple、text、number 四种题型，复用第一阶段题目定义校验、长度、数字边界、默认值和选项规则。创建时 required 可省略，默认 false；其余定义字段必须提供。创建选项只有 text，服务端分配库内 optionId。题库定义不含 questionId 和 jumpRules。

### 原地修改与派生

原地修改请求含 `contentRevision`、`title`、`required`、`validation`、`options`，全部必填。派生请求增加 `sourceVersionId`，指向本题目任一历史版本，contentRevision 校验该来源版本当前内容。两者均不接受 type；同身份题型固定。

已有选项可携带该来源定义中的 optionId，新增选项仅提供 text。借用另一版本中不在当前来源的 ID、跨题 ID 或重复 ID 均拒绝。新版本保留继承选项的 ID，新选项获得新 ID；另存新题则所有选项重新生成身份。删除的 ID 在库内注册集合保留，不回收；可通过从历史版本派生或恢复重新采用其原有选项。

原地修改保持版本号并把 contentRevision 加一；冻结后返回 `409 LIBRARY_VERSION_FROZEN`。未冻结但 revision 不匹配返回 `409 LIBRARY_CONFLICT`。派生可基于冻结版本，冻结来源并增加新版本号，新版从 contentRevision 1 开始且初始未冻结。并发派生通过事务分配不同的连续版本号；不以最后写入覆盖内容。

### 恢复和另存

恢复请求：

```json
{
  "restoredFromVersionId": "24位目标版本ID",
  "sourceContentRevision": 1,
  "baseVersionId": "24位当前最新版本ID",
  "baseContentRevision": 1
}
```

ID 示例文字须替换为真实 ID。base 必须仍是当前最新版本；source、base 都须属于该身份且 revision 匹配，否则返回 404 或 `LIBRARY_CONFLICT`。恢复复制 source 内容，生成新版本；parentVersionId 指向 base，restoredFromVersionId 指向 source，相关来源均冻结，旧版本不删除。

另存请求只有 `{ "contentRevision": 1 }`。当前里程碑只允许所有者另存；生成新身份及 v1，copiedFrom 保存原身份、版本和 revision，源版本冻结。新身份不继承原题的统计归属或任何授权。接收者另存留待共享里程碑实现。

### 响应与修改前检查

创建、详情和全部写入返回 `{ question, version, modificationStatus }`。question 包含 libraryQuestionId、type、latestVersionId、versionCount、copiedFrom 与时间；version 包含 questionVersionId、libraryQuestionId、versionNumber、contentRevision、frozenAt、freezeReasons、parentVersionId、restoredFromVersionId、definition 与时间。时间为 UTC ISO 字符串。响应不返回 ownerId、内部序列字段或 MongoDB __v。

modificationStatus 包含 canEditInPlace、ownUsageCount、otherUsageCount。计数是该版本当前使用实例数，不是问卷份数；只对源题所有者提供。本里程碑尚未接入选题，因此正常新题使用计数为 0；复制、派生或恢复也可使其冻结。冻结原因分别为 adopted、copied、derived、restored；冻结永久保留，不依据当前引用数量解冻。

列表返回 `{ items: [{ question, version }], nextCursor }`；历史返回 `{ items: [version], nextCursor }`。身份列表一页用一次批量查询读取最新版本，不逐行关联。页面在修改前展示使用与冻结情况；服务端写入时重新检查，不能把前次 GET 当成有效修改授权。

### 新增稳定错误码

| HTTP | code                       | 含义                                           |
| ---- | -------------------------- | ---------------------------------------------- |
| 400  | VALIDATION_ERROR           | 参数或题目定义不合法，details.path 定位字段    |
| 404  | LIBRARY_QUESTION_NOT_FOUND | 题目或版本不存在、越权或不属于该身份           |
| 409  | LIBRARY_VERSION_FROZEN     | 禁止原地覆盖已冻结版本，先于内容 revision 检查 |
| 409  | LIBRARY_CONFLICT           | 内容 revision 过期或恢复基线已变化             |

认证、Origin、JSON、限流和内部错误继续使用原有错误码。

## 第二阶段里程碑 2 常用题目接入问卷草稿

下列接口已实现，均复用原问卷写入认证、Origin、JSON、每用户写限流与 revision 乐观锁。当前只可使用自己拥有的常用题目，用户间共享在里程碑 3 接入。

| 方法 | 路径                                                                               | 作用                           | 成功状态 |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------ | -------- |
| POST | `/api/surveys/:surveyId/versions/:versionId/library-questions`                     | 从常用题目选入一个实例         | 201      |
| PUT  | `/api/surveys/:surveyId/versions/:versionId/questions/:questionId/library-source`  | 显式换用同一常用题目的其他版本 | 200      |
| POST | `/api/surveys/:surveyId/versions/:versionId/questions/:questionId/detach-library`  | 转为本地题目                   | 200      |
| POST | `/api/surveys/:surveyId/versions/:versionId/questions/:questionId/save-to-library` | 保存本地题目为独立常用题目     | 201      |

### 选入与换版本请求

```json
{
  "revision": 3,
  "libraryQuestionId": "24位题目身份ID",
  "questionVersionId": "24位题目版本ID",
  "contentRevision": 1
}
```

ID 示例须换成真实 24 位小写十六进制 ID。revision 是目标问卷草稿 revision，contentRevision 是所选题目库版本的内容修订。缺少、类型错误、未知字段或伪造 source、选项映射等一律 400；版本不属于该身份或不是当前用户的资源返回 404。全部接口只修改草稿，发布版本始终返回 VERSION_NOT_EDITABLE。

选入先检查草稿所有权、状态、revision 及 100 题上限，再读取获授权来源并校验 contentRevision。在同一事务内永久冻结题目库版本，生成新的问卷实例 ID 和选项实例 ID，保存完整定义、来源映射、使用记录，并更新草稿 revision 及问卷修改时间。第一次选入使目标结构 schemaVersion 升为 2。同一来源可在同一问卷多次选入，各实例独立。

换版本只接受当前实例的同一 libraryQuestionId 下的其他版本。当前已使用的版本不允许重复换入。有任何入站跳转返回 QUESTION_REFERENCED 并列出 references；当前题存在出站规则返回 QUESTION_HAS_JUMP_RULES。须先解决引用并清空出站规则，接口才会在原位置生成新实例，移除旧实例和旧使用记录；不猜测选项对应，也不继承跳转。换版本不改变已发布快照或回答。

成功返回 `{ version, questionId, surveyUpdatedAt }`，questionId 为新实例 ID。草稿 revision 递增，返回完整最新草稿。

### 保存为常用题目与解除来源

两接口请求都只有 `{ "revision": 3 }`。

save-to-library 仅接受本地题目，把已保存的标题、题型、必答、选项及校验保存成一个新身份及 v1；选项生成新的库内 ID，跳转不进入题目库。当前问卷实例保持本地，不自动关联来源，不回溯认领旧回答，新库版本初始可修改。该操作也以问卷 revision 条件写入来防止读取定义与并发修改之间的竞态，成功会增加草稿 revision；题目定义、顺序及跳转保持原样。返回 `{ version, surveyUpdatedAt, libraryQuestionId, questionVersionId }`。

detach-library 仅接受带来源实例，删除该实例 source 及使用记录；保留原 questionId、选项实例 ID、题目定义和所有跳转，因此入站引用仍有效。返回 `{ version, surveyUpdatedAt }`。转换后可通过原题目 PATCH 编辑定义。源题目版本永久冻结，最后一个引用移除也不解冻。

直接通过原 PATCH 修改带来源的定义返回 LIBRARY_SNAPSHOT_READ_ONLY，即使提交相同内容也必须先显式转换；客户端提交 source:null 不能绕过白名单。带来源的题目排序和跳转仍用原接口，服务端保留来源。

### 来源及使用记录

每个带来源的问卷实例含 source：libraryQuestionId、questionVersionId、contentRevision、versionNumber，以及 `{ optionId, sourceOptionId }` 数组。前者 optionId 是本问卷实例选项，后者是题目库内跨版本稳定的选项 ID。来源由服务端生成，调用者不能自行填写。来源 ID 以规范的 24 位字符串保存于快照，共享包直接使用；题目资源 `_id` 和 question_usages 的引用字段仍为 ObjectId，投影层显式转换。

只有新来源结构才提升 schemaVersion；原有本地题目及历史发布快照不批量升级。转本地后不把 schemaVersion 2 降回 1。公开填写仍使用安全字段投影，不返回来源、授权或内部身份元数据。

question_usages 与业务写入共用 session：

- 选入插入一条；换版本删除旧实例并插入新实例；解除来源及删除题目删除对应记录。
- 排序或跳转只保留原记录，不增加重复使用。
- 发布把对应记录标为 published；复制下一草稿为新 surveyVersionId 复制来源及记录。
- 放弃后续草稿删除该版记录，历史发布版记录保留。
- 保存本地题目入库不创建使用记录。

任何事务失败都回滚来源冻结、新资源、使用记录和草稿写入。复制下一草稿使用已经固定的旧快照，不读取题目库最新内容。引用明细及跨问卷回答聚合属于后续里程碑，本节不宣称已提供这些接口。

### 新增错误码

| HTTP | code                       | 含义                                                           |
| ---- | -------------------------- | -------------------------------------------------------------- |
| 409  | LIBRARY_SNAPSHOT_READ_ONLY | 带来源实例禁止直接修改定义，或已经来自常用题目，须使用显式流程 |
| 409  | QUESTION_HAS_JUMP_RULES    | 换版本前须清空当前实例出站规则                                 |

其余沿用 QUESTION_REFERENCED、QUESTION_LIMIT_REACHED、DRAFT_CONFLICT、VERSION_NOT_EDITABLE、LIBRARY_CONFLICT、LIBRARY_QUESTION_NOT_FOUND 及原通用错误码。

## 第二阶段里程碑 3 版本共享与分级引用查询

当前支持按具体版本向已注册用户批量共享。共享授予读取、选入自己草稿和另存新题的权限，不授予原题编辑、派生、恢复、转授、授权管理或他人回答访问权。

### 接口

| 方法   | 路径                                                | 功能                                                 | 成功状态 |
| ------ | --------------------------------------------------- | ---------------------------------------------------- | -------- |
| GET    | `/api/questions/shared`                             | 分页列出共享给当前用户的题目身份，展示最新获授权版本 | 200      |
| POST   | `/api/questions/:libraryQuestionId/shares`          | 批量授予指定版本                                     | 202      |
| GET    | `/api/questions/:libraryQuestionId/shares`          | 所有者分页管理已建立授权                             | 200      |
| DELETE | `/api/questions/:libraryQuestionId/shares/:shareId` | 所有者撤销一条用户与版本授权                         | 204      |
| GET    | `/api/questions/:libraryQuestionId/usages`          | 当前用户自己问卷中的引用明细                         | 200      |
| GET    | `/api/questions/:libraryQuestionId/usages/others`   | 仅源题所有者可读的他人使用汇总                       | 200      |

全部要求原登录 Cookie。共享给我、授权及使用列表沿用 limit 1–50、默认 20 和不透明绑定游标；不同用户、资源、列表类型的游标不能混用。自己题目列表仍只返回自己的题，接收题目使用单独 shared 列表，问卷选题器提供两个入口。

### 批量授权与撤销

```json
{
  "usernames": ["student_a", "student_b"],
  "questionVersionIds": ["24位版本ID"]
}
```

两个数组各 1–50 项，用户名沿用 3–20 位 ASCII 字母、数字或下划线规则，trim、小写规范化并去重；版本 ID 也去重。所有版本必须属于当前所有者的该题目身份，任一版本无效则整个授权事务失败。每批最多 2,500 个用户与版本组合，不接受未知字段。不会给自己建立共享记录。

对有效请求中的已有账号、不存在账号和已授权账号统一返回 `202 { "accepted": true }`，不返回命中数量或逐项失败名单；所有者可从授权列表管理实际建立的记录。按用户每 15 分钟 20 次、来源 IP 每 15 分钟 100 次限制授权和撤销请求，并继续执行原每用户 library-write 限流。统一受理不能消除授权管理带来的账号发现能力，属于需求决策已接受的边界，不声称完全防账号枚举。

授权列表项仅包含 shareId、username 和 versionNumber；shareId 用于撤销，不返回 recipientId。撤销请求体为 `{}`；合法但已不存在的 shareId 幂等返回 204，非所有者不能管理授权。新增题目版本或恢复版本不会自动共享，所有者须再次明确选择。

`question_shares` 每个用户与版本一条记录，唯一索引为 `(questionVersionId, recipientId)`，另有接收者与身份、身份与授权 ID 的列表索引。grant/revoke 在事务中更新题目身份 revision 以串行化同身份授权管理。仅共享不触发冻结；首次选入或另存才冻结并固定内容修订。

### 已有详情 历史和另存接口的权限扩展

题目详情响应新增 `access: owner | shared`。所有者仍有完整历史与原有写权限。接收者的详情、历史和 shared 列表只返回获授权版本；身份的 latestVersionId 和 versionCount 限定在获授权范围，copiedFrom 隐藏，不泄露私有最新版本指针、总版本数或未共享定义。

未授权父版本和恢复来源不返回 ID，而是把对应指针置 null 并返回 parentUnavailable 或 restoredFromUnavailable；允许展示“部分来源不可访问”。接收者 modificationStatus.canEditInPlace 始终 false，otherUsageCount 为 0，只统计自己的使用。

接收者可通过原 copy 接口另存为自己拥有的新身份，copiedFrom 记录当时获授权来源，库内选项重新分配 ID，新身份统计和权限独立。不能通过原 PATCH、新版本、恢复或 shares 接口修改或转授原题。普通授权读请求按检查时权限处理，撤销不追溯取消已经发出的读取响应；新增选入和另存执行下述更严格事务边界。

### 撤销与写入竞争

选入或另存共享版本时，同一事务内对精确的 `(libraryQuestionId, questionVersionId, recipientId)` 授权记录执行 accessRevision 条件写入，再读取版本、冻结及写业务数据；撤销删除同一授权记录。因此：已获得授权写锁并成功提交的使用保留，撤销随后生效；撤销先提交则后续使用返回 404，并且不留下冻结、使用或新身份。

事务失败时授权 accessRevision 的变化也回滚。撤销后不能再从库读取、选入或另存该版本，但已有草稿和发布快照继续有效，可发布及复制下一问卷草稿，原回答不删除。快照延续不恢复题目库权限，所有者仍能看到留存的脱敏使用事实。

### 引用返回字段与隐私

自己引用项返回 surveyId、surveyVersionId、questionId、internalName、surveyVersionNumber、questionVersionNumber、status，支持打开定位。先按当前用户过滤使用记录，再核对问卷所有者与实际快照来源，避免把冗余投影当成最终授权依据。

他人汇总项严格只有 username、versionNumber、status、count 四字段，按用户、题目版本与草稿或发布状态分组。count 是实例次数，同一问卷不同版本及同版重复实例分别计入；不返回他人问卷名称、ID、链接、题目位置、回答或账号 ID。分页游标采用独立派生密钥的 AES-256-GCM 加密，绑定当前所有者及题目，避免分页键暴露内部用户 ID。其他管理列表继续使用绑定范围的签名游标。

引用管理不扩展回答权限，原问卷统计接口仍只允许问卷所有者读取。跨问卷回答聚合已在里程碑 5 实现，仍限当前用户自己的发布来源，详见后文对应接口。

### 当前版本优先界面修订

根据人工反馈，管理页和问卷选题器默认展示当前可访问版本，历史按需展开。共享界面直接提交当前版本 ID，不再显示多版本勾选；历史管理详情只提供查看和恢复为最新版本，不提供原地修改或分享按钮。现有显式版本接口、授权记录及权限检查保留，以兼容旧调用和后续固定版本场景；冻结和恢复事务语义不变。

## 第二阶段 里程碑 4 私有题库分类

所有接口位于 `/api/question-banks`，需要登录，写操作继续执行 Origin、JSON 与 library-write 限流。其他人的题库和不存在题库统一 404 BANK_NOT_FOUND。题库不会赋予题目访问权，不提供题库转授功能。

| 方法   | 路径                     | 请求与结果                                              |
| ------ | ------------------------ | ------------------------------------------------------- |
| GET    | `/`                      | limit 1–50（默认 20）、cursor；返回 items 与 nextCursor |
| POST   | `/`                      | `{name}`，trim 后 1–80 字；201 返回题库                 |
| PATCH  | `/:bankId`               | `{name,revision}`；200 返回更新题库                     |
| DELETE | `/:bankId`               | `{revision}`；204，只移除分类与成员                     |
| GET    | `/:bankId/items`         | 同上分页；返回 bank、items、nextCursor                  |
| POST   | `/:bankId/items`         | 成员策略请求，201 `{accepted:true}`                     |
| PUT    | `/:bankId/items/:itemId` | 成员策略请求加 revision；200 `{accepted:true}`          |
| DELETE | `/:bankId/items/:itemId` | `{revision}`；204，只移出分类                           |

题库返回 bankId、name、revision、createdAt、updatedAt。改名递增题库 revision；成员操作维护内部 membershipRevision，与题库删除串行化，不令其他成员的修订失效。删除需当前题库 revision。无成员总数字段，列表采用独立 ownerId 与范围绑定的签名游标。

成员策略请求包含 libraryQuestionId、versionPolicy 和 questionVersionId。latest 的 questionVersionId 省略或 null；pinned 必须传同身份且有权访问的版本 ID。PUT 额外要求正整数 revision，且不能更换成员所属题目身份。重复加入、陈旧修订或并发更新失败返回 409 BANK_CONFLICT；未知字段、非法策略、ID 或修订返回 400 VALIDATION_ERROR。不可访问题目/版本返回 404 LIBRARY_QUESTION_NOT_FOUND，事务不留下成员。

成员返回 itemId、libraryQuestionId、versionPolicy、questionVersionId、revision、available、version。latest 动态解析所有者最新版本，或接收者最高版本号的获授权版本；不跟随未获授权的私有新版本。pinned 固定版本身份，若该版本被撤销授权则 available=false、version=null，不回退到其他版本。仍可移出失效成员。可用版本沿用题目服务的祖先脱敏，不暴露未授权来源；普通读取沿用检查时权限，在途读不追溯取消。

固定版本不等于冻结内容：未使用版本仍可原地修改，界面明确提示。加入、移出、修改策略及删除题库均不冻结版本、不创建或删除 usages、不改问卷快照和回答。实际选入问卷仍走原采用事务，重新验证精确版本权限和 contentRevision 并冻结。成员写入对精确共享授权作条件写入，与撤销争用；成员、父题库计数及授权修订统一回滚。

前端入口为“管理常用题目与版本 → 管理题库分类”；成员更新先预览差异，可明确选择历史版本固定或切换跟随最新。切换跟随最新会同步刷新最新可用预览。问卷选题器的“按题库选择”采用解析后的具体版本，固定旧版本不会被静默替换成当前版本。已有问卷需要在编辑器中单独换版本。

## 第二阶段 里程碑 5 跨问卷单题统计

统计入口为 `/api/questions/:libraryQuestionId/statistics`。需要登录；查询统一执行 statistics 用户限流和 maxTimeMS，响应带 Cache-Control: no-store。POST 同样需要受信 Origin 和 application/json。该接口不授予任何他人问卷回答权限。

### GET /sources

不接受查询参数，返回 libraryQuestionId、scope=`own-published-surveys`、sourceCount、versions。每个版本项为 questionVersionId、versionNumber、definition、sourceCount、surveyCount；定义来自当前用户真实发布快照，选项 ID 归一为题库源 ID。用于展示统计范围和合并前差异，不返回他人使用情况。

只发现当前用户的已发布引用，包含历史发布版本，排除草稿。先从 question_usages 按 libraryQuestionId/ownerId/status 的索引查询，再核对 surveys.ownerId、已发布 survey_versions、实例来源和版本 ID。usage 只是候选，不作最终授权。旧本地题无来源时不按标题推断同题；另存为新题目的身份也不混入。

有自己真实发布来源时，即使共享已撤销，仍可统计自己快照中该题的回答；无来源则要求题目所有权或现存共享，否则统一 404 LIBRARY_QUESTION_NOT_FOUND。有访问权但无来源返回空 versions。每个身份最多解析 1000 条发布引用，超出明确返回 413 PAYLOAD_TOO_LARGE，不静默截断。不声称能从缺失 usages 自动恢复来源；最终回归里程碑另提供核对修复工具。

### POST /query

```json
{
  "questionVersionIds": ["24位题目版本ID"],
  "merge": false,
  "confirmMerge": false,
  "boundaries": [0, 18, 30, 45, 60, 120],
  "limit": 20
}
```

questionVersionIds 必填 1–50 项，去重并排序，必须全部出现在自己的真实发布来源中。merge 默认 false；合并多个版本时必须传 confirmMerge=true。界面先展示标题、必答、选项和校验差异并要求勾选确认，不能只因题型相同自动认为语义相同。拒绝跨题目身份、未知版本或题型不一致。未知字段拒绝。

boundaries 为 2–31 个严格递增的有限数字，默认如示例；数字桶左闭右开，并额外返回低于首边界、达到末边界的桶，总桶数为边界数加一。没有有效数字时 count/sum 为 0，average/minimum/maximum 为 null；数值 0 是有效回答。非数字统计仍接收合法 boundaries，但不生成数字桶。

返回 libraryQuestionId、scope、countingUnit=`question-instance`、merged、versions（所选定义与来源量）、groups、text、generatedAt。默认每个题目版本一个 group，merge 时为 merged 组。各组字段如下：

| 字段                                         | 含义                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| questionVersionIds、sourceCount、surveyCount | 组成版本、实例数量、不同问卷数量                                   |
| opportunityCount                             | 对每份相关提交，每个相关题目实例各计一次机会                       |
| reachedCount、answeredCount                  | 路径到达实例次数、实际存储的有效回答实例次数                       |
| notReachedCount                              | opportunityCount − reachedCount                                    |
| unansweredReachedCount                       | reachedCount − answeredCount                                       |
| reachRate、answerRate                        | reached/opportunity、answered/reached；分母 0 返回 0               |
| options                                      | 源 optionId、跨版本 labels、count、percentageOfAnswered            |
| number                                       | 数字 count、sum、average、minimum、maximum、buckets；非数字为 null |

按实例而非人数统计；同一提交重复使用同题、不同问卷或不同发布版本的提交均分别计入。仅成功入库的提交参与，重复提交是否允许仍由原填写规则控制；本接口不另外按账号去重。选择题按 source.optionSources 归并到稳定源 optionId，文字相同但 ID 不同不会合并。多选比例的分母为已答实例数，合计可超过 100%。同一源选项改名时 labels 保留各版本文字。

文本题返回 text.items 与 nextCursor；每项严格只有 value、submittedDate（UTC 日期）、questionVersionId。包括实名问卷也不返回账号、响应 ID 或精确时间。每页 limit 为 1–50（默认 20），后续 POST 在相同条件下带 cursor。游标 AES-GCM 加密并绑定当前用户、身份、选中版本、合并模式、桶边界、limit 与真实来源集合；条件或来源改变时返回 400，须重新查询。非文本不接受 cursor。

每次查询在同一 snapshot 只读事务中解析来源并按最多 50 个实例分批聚合。responses 首先按有权 surveyVersionId 作索引过滤，再为该版本的精确实例提取答案和选项映射，不在回答管道中执行 lookup。同一问卷版本中不属于本题的实例不计入。文本每批取 limit+1 后全局按 submittedAt、响应 ID、来源键降序合并，以简单二进制字符串比较保持与 MongoDB 一致；下一页重新建立一致读视图，不承诺跨请求固定快照。

超时或一致性不变量失败返回 503 STATISTICS_UNAVAILABLE，不返回部分统计。对数值桶、回答数、到达数、单选总数和选项映射核对；来源定义异常同样拒绝统计。实际执行计划见 `experiments/STAGE2_STATISTICS_EXPLAIN.json`，复现命令为 `npm run library:statistics-benchmark --workspace @survey/api`，该命令仅使用固定专用本地实验库，结束清理实验集合。

## 第二阶段维护工具（不通过 HTTP 暴露）

里程碑 6 增加 `library:usage-audit` 和 `seed:stage2` 脚本，只允许本地非生产环境。完整参数、限制及修改范围见 [STAGE2_OPERATIONS.md](STAGE2_OPERATIONS.md)。

审计默认只读，全量只报告每问卷差异及孤立数量。修复必须指定 ownerId、surveyId、--apply 和检查生成的 planHash，只替换该问卷的使用投影；更新父问卷 updatedAt 与正常修改串行化，不修改版本快照或回答。过期计划、损坏来源及未冻结版本拒绝修复，不支持全库自动修复。

第二阶段演示由 stage2_demo_manifest 记录演示账号 ID 与 building/ready 状态，初次生成需要 SEED_USER_PASSWORD。默认重复运行只验证；reset/clean 需额外 --confirm-demo-data，且有非演示账号依赖时拒绝清理。不会接管已有同名账号或变更原 seed 账号。原 seed 工具新增第二阶段数据预检，避免清理留下悬空的题目、题库和来源关系。
