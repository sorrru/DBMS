# API 说明

本文从里程碑 2 起随代码维护。默认基址为 `/api`，请求和响应均使用 JSON；`204` 响应例外。浏览器认证使用名为 `survey_session` 的 HttpOnly Cookie。

## 通用约定

- 注册和登录必须发送 `Content-Type: application/json`。
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

## 稳定错误码

| HTTP | 错误码                   | 含义                                   |
| ---: | ------------------------ | -------------------------------------- |
|  400 | `VALIDATION_ERROR`       | 字段类型、规则或 JSON 格式错误         |
|  401 | `AUTH_REQUIRED`          | 未提供登录 Cookie                      |
|  401 | `AUTH_INVALID`           | 登录令牌或对应用户无效                 |
|  401 | `INVALID_CREDENTIALS`    | 用户名或密码错误                       |
|  403 | `ORIGIN_NOT_ALLOWED`     | 写请求来源缺失或不匹配                 |
|  404 | `NOT_FOUND`              | `/api` 下路由不存在                    |
|  409 | `USERNAME_TAKEN`         | 规范化用户名已存在                     |
|  413 | `PAYLOAD_TOO_LARGE`      | JSON 请求体超过 256 KiB                |
|  415 | `UNSUPPORTED_MEDIA_TYPE` | 注册或登录未使用 `application/json`    |
|  429 | `RATE_LIMITED`           | 请求超过限流；响应含 `Retry-After`     |
|  500 | `INTERNAL_ERROR`         | 未预期服务错误，不向客户端暴露内部信息 |

## 当前实现边界

登录 Cookie 有效期为 2 小时，不提供刷新或服务端撤销。限流保存在单进程内存中，重启会清空且多实例不共享；生产多实例部署应换成 Redis 等共享存储。
