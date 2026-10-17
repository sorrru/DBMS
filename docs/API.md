# API 说明

本文从里程碑 2 起随代码维护。默认基址为 `/api`，请求和响应均使用 JSON；`204` 响应例外。浏览器认证使用名为 `survey_session` 的 HttpOnly Cookie。

## 通用约定

- 所有带请求体的接口必须发送 `Content-Type: application/json`；无请求体的退出接口例外。
- `POST`、`PUT`、`PATCH`、`DELETE` 必须携带与 `WEB_ORIGIN` 完全相同的 `Origin`。
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

## 问卷主体与草稿接口（里程碑 3 设计）

以下接口已经完成人工方案讨论，尚待里程碑 3 编码和验收。全部需要有效登录 Cookie；写接口还必须满足通用 Origin 与 JSON 要求。

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

## 稳定错误码

| HTTP | 错误码                   | 含义                                      |
| ---: | ------------------------ | ----------------------------------------- |
|  400 | `VALIDATION_ERROR`       | 字段类型、规则或 JSON 格式错误            |
|  401 | `AUTH_REQUIRED`          | 未提供登录 Cookie                         |
|  401 | `AUTH_INVALID`           | 登录令牌或对应用户无效                    |
|  401 | `INVALID_CREDENTIALS`    | 用户名或密码错误                          |
|  403 | `ORIGIN_NOT_ALLOWED`     | 写请求来源缺失或不匹配                    |
|  404 | `NOT_FOUND`              | `/api` 下路由不存在                       |
|  404 | `SURVEY_NOT_FOUND`       | 问卷/版本不存在、不属于当前用户或组合错误 |
|  409 | `USERNAME_TAKEN`         | 规范化用户名已存在                        |
|  409 | `VERSION_NOT_EDITABLE`   | 目标版本已经发布，不能通过草稿接口修改    |
|  409 | `DRAFT_CONFLICT`         | 草稿 revision 已变化，需要重新加载        |
|  409 | `SURVEY_LIMIT_REACHED`   | 当前用户已达到可创建的问卷数量上限        |
|  413 | `PAYLOAD_TOO_LARGE`      | JSON 请求体超过 256 KiB                   |
|  415 | `UNSUPPORTED_MEDIA_TYPE` | 带请求体的接口未使用 `application/json`   |
|  429 | `RATE_LIMITED`           | 请求超过限流；响应含 `Retry-After`        |
|  500 | `INTERNAL_ERROR`         | 未预期服务错误，不向客户端暴露内部信息    |

## 当前实现边界

登录 Cookie 有效期为 2 小时，不提供刷新或服务端撤销。限流保存在单进程内存中，重启会清空且多实例不共享；生产多实例部署应换成 Redis 等共享存储。账号接口已经实现并验收；上面的里程碑 3 问卷接口目前是待人工确认的契约，不能视为已经可调用。
