# 用户账号与身份认证设计

## 文档状态

本文记录里程碑 2 开工前经人工确认的认证方案。实现、测试和 `docs/API.md` 必须以本文为基线；发现新歧义时先追加决策，再修改代码。

## 用户名

- 只允许英文字母、数字和下划线，长度 3–20 个字符。
- 输入时去除首尾空格，并转换为小写的 `usernameNormalized`。
- `usernameNormalized` 建立唯一索引；`Alice` 与 `alice` 是同一账号。
- 第一阶段不允许中文用户名，避免 Unicode 规范化和相似字符问题；以后如需中文，增加独立展示名字段。
- 用户名注册后暂不支持修改。

## 密码规则和存储

- 密码最少 10 个、最多 128 个 Unicode 码点。
- 至少包含一个英文字母和一个数字，允许空格和其他符号。
- 密码不能与规范化用户名完全相同。
- 校验层首先确认密码是字符串，拒绝对象、数组和其他类型。
- 密码先使用 Unicode NFKC 规范化，再计算码点长度、执行规则校验和哈希；登录验证执行完全相同的规范化。
- 前端提供即时提示，后端执行最终可信校验。

密码使用 Node.js 内置的异步 `crypto.scrypt`，不增加密码哈希依赖，也没有 bcrypt 的 72 字节截断边界。参数固定为：

```text
N = 2^15
r = 8
p = 3
maxmem = 64 MiB
salt = 16 个随机字节
derivedKey = 64 字节
```

保存格式包含算法版本、参数、随机盐和派生密钥，例如：

```text
scrypt$32768$8$3$<salt-base64url>$<derived-key-base64url>
```

验证时不能无条件信任数据库记录中的参数。实现采用显式允许的版本化参数档位；v1 只接受上述 `N`、`r`、`p`、盐长度和派生密钥长度。未知算法、未知档位、参数超限、Base64 解码失败或字段长度不符都直接按验证失败处理，不进入高成本派生。`crypto.timingSafeEqual` 调用及记录解析必须捕获异常，长度不一致的畸形记录返回验证失败，不能产生 500。

用户不存在时仍必须执行一次 scrypt 验证：使用离线预先生成、与生产 v1 参数完全相同的假哈希记录调用同一个 `verifyPassword`，然后统一返回 `INVALID_CREDENTIALS`。假哈希不是密钥，不在每次请求中重新生成。测试注入低成本测试参数和对应假哈希，并断言不存在用户的路径确实调用了 scrypt；至少保留一项使用生产参数档位的兼容性测试。

生产哈希档位固定，不允许通过普通环境变量降低。哈希服务通过依赖注入接收测试专用档位，使自动测试保持快速；测试生成的低参数记录只能由测试实例接受，不能进入生产允许列表。该结构为以后提高生产参数保留迁移空间。数据库、日志、错误响应和 AI 使用记录中不得出现明文密码。

选择依据：OWASP 在 Argon2id 不可用时推荐 scrypt，并给出 `N=2^15、r=8、p=3` 的约 32 MiB 折中配置；Node.js 官方文档建议使用随机且至少 16 字节的盐，并说明 `maxmem` 必须覆盖 `128 × N × r` 的近似内存需求。

## 用户集合与唯一性

```json
{
  "_id": "ObjectId",
  "username": "alice",
  "usernameNormalized": "alice",
  "passwordHash": "scrypt$...",
  "registeredAt": "Date"
}
```

- 测试和服务启动时通过 `UserModel.init()` 确认唯一索引已建立。
- 注册可以先做友好性查询，但并发正确性只能依赖唯一索引。
- 捕获 MongoDB 重复键错误 `11000` 后，还必须确认 `keyPattern` 指向 `usernameNormalized`，才转换为 `USERNAME_TAKEN`；其他唯一索引冲突交给统一错误处理，不能误报用户名占用。
- 必须测试两个并发请求注册同一规范化用户名时，只产生一个用户。

## JWT 与 Cookie

- 登录令牌使用 JWT，签名算法固定为 `HS256`。
- 签发和验证均使用代码配置的算法白名单，不能根据令牌头动态选择算法。
- 拒绝 `alg: none`、其他算法、错误密钥、无效签名和过期令牌。
- 有效期为 2 小时，不实现刷新令牌。
- JWT 只包含 `sub`、`iat`、`exp`、`iss` 和 `aud`；不保存用户名、密码、权限或匿名标识。
- `iss` 固定为项目服务标识，`aud` 固定为项目 Web 客户端标识，验证时同时检查。
- 验证签名后仍根据 `sub` 查询用户；用户已删除时返回 `AUTH_INVALID`。

令牌保存于 Cookie：

```text
Name = survey_session
HttpOnly = true
SameSite = Lax
Secure = 生产环境 true，开发环境 false
Path = /
Max-Age = 2 小时
```

前端不把 JWT 保存到 `localStorage`、`sessionStorage` 或普通 JavaScript 状态。退出登录清除 Cookie；第一阶段不实现服务端令牌撤销表，因此已经泄露的令牌理论上可使用到过期，报告中必须写明该边界。

## 密钥启动校验

API 启动时必须校验：

- `JWT_SECRET` 至少 32 个字符。
- `ANONYMOUS_ID_SECRET` 至少 32 个字符。
- 两个密钥不能相同。
- 两个密钥不能仍是 `.env.example` 中的占位值。
- 缺失或不满足要求时输出不含密钥值的错误并拒绝启动。

README 推荐使用 `openssl rand -hex 32` 分别生成两个 32 字节随机值。HS256 验证始终只使用 `JWT_SECRET`，匿名标识始终只使用 `ANONYMOUS_ID_SECRET`。

## CSRF、Origin 与 CORS

- 开发环境由 Vite 把浏览器的 `/api` 请求代理到 `http://localhost:3000`，前端代码只访问同源相对路径。
- 后端仍保留严格 CORS，仅允许 `WEB_ORIGIN`，并显式配置允许的方法、请求头和 credentials。
- `GET` 和 `HEAD` 不改变状态。
- 所有改变状态的方法，包括 `POST`、`PUT`、`PATCH` 和 `DELETE`，必须带有与 `WEB_ORIGIN` 完全一致的 `Origin`。
- CORS 预检 `OPTIONS` 只接受允许的 Origin。
- Origin 缺失或不匹配时返回 `403 ORIGIN_NOT_ALLOWED`。测试和非浏览器调用必须显式提供允许的 Origin。

`SameSite=Lax` 与 Origin 校验共同构成第一阶段的 CSRF 防护。生产环境还必须通过 HTTPS 设置 `Secure` Cookie。

## API

| 方法   | 路径                 | 成功状态 | 行为                      |
| ------ | -------------------- | -------- | ------------------------- |
| `POST` | `/api/auth/register` | `201`    | 注册并写入登录 Cookie     |
| `POST` | `/api/auth/login`    | `200`    | 验证凭据并写入登录 Cookie |
| `GET`  | `/api/auth/me`       | `200`    | 返回数据库中的当前用户    |
| `POST` | `/api/auth/logout`   | `204`    | 清除登录 Cookie           |

注册、登录和当前用户接口的成功响应固定为：

```json
{
  "user": {
    "id": "用户 ObjectId 字符串",
    "username": "alice",
    "registeredAt": "2026-10-17T00:00:00.000Z"
  }
}
```

响应不得包含 `passwordHash` 或 `usernameNormalized`。退出成功只返回 `204`，没有响应体。用户不存在和密码错误统一返回 `INVALID_CREDENTIALS`，不泄露用户名是否存在。`docs/API.md` 从本里程碑开始随接口实现持续更新。

## 错误格式与 HTTP 状态

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不符合要求",
    "details": {
      "field": "username"
    }
  }
}
```

| 错误码                   | HTTP 状态 | 适用情况                                       |
| ------------------------ | --------- | ---------------------------------------------- |
| `VALIDATION_ERROR`       | `400`     | 字段类型、格式或取值错误；畸形 JSON 也归入此项 |
| `AUTH_REQUIRED`          | `401`     | 未提供登录 Cookie                              |
| `AUTH_INVALID`           | `401`     | 令牌签名、算法、声明、有效期或对应用户无效     |
| `INVALID_CREDENTIALS`    | `401`     | 用户名不存在或密码错误                         |
| `ORIGIN_NOT_ALLOWED`     | `403`     | 非安全方法的 Origin 缺失或不允许               |
| `USERNAME_TAKEN`         | `409`     | 唯一索引拒绝重复用户名                         |
| `PAYLOAD_TOO_LARGE`      | `413`     | JSON 请求体超过限制                            |
| `UNSUPPORTED_MEDIA_TYPE` | `415`     | 需要 JSON 的接口未使用 `application/json`      |
| `RATE_LIMITED`           | `429`     | 注册或登录超过限流阈值                         |
| `INTERNAL_ERROR`         | `500`     | 未预期的服务端错误                             |
| `NOT_FOUND`              | `404`     | `/api` 下不存在的路由                          |

所有已知错误以及 `/api` 未知路由都返回统一 JSON 结构；404 处理器放在 API 路由之后，不能使用 Express 默认 HTML。生产响应不得返回堆栈、MongoDB 错误详情、密码哈希或密钥。错误码一旦写入 `docs/API.md`，后续修改必须同步记录兼容性影响。

## 限流

默认值：

- 注册：每个来源 IP 每小时最多 5 次。
- 登录：每个来源 IP 与规范化用户名组合每 15 分钟最多 10 次失败尝试。
- 登录总量：每个来源 IP 每 15 分钟最多 100 次，无论用户名是什么，防止密码喷洒。
- 成功登录后清除对应组合的失败计数。
- 超限返回 `429 RATE_LIMITED` 和 `Retry-After`。

窗口、次数和存储容量均由环境变量配置。测试使用依赖注入或仅测试代码可调用的存储清理方法，并使用短窗口和低阈值；不提供可通过 HTTP 访问的生产重置接口。

第一阶段使用进程内存储，并要求：定期清理过期键；设置最大键数量；达到容量上限时对新键封闭失败并返回 `RATE_LIMITED`，不能无限增长，也不能通过逐出活跃键绕过限制。服务重启会清空计数且多实例不能共享；报告中说明生产部署应迁移到 Redis 等共享存储。

开发环境经 Vite 代理后，后端看到的来源地址通常是本机代理，因此多人限流行为不能用开发代理模拟。生产环境只有在明确知道反向代理拓扑时才配置 Express `trust proxy`，并通过环境变量限定可信代理地址或跳数，禁止无条件设为 `true`。

## 中间件顺序

认证写接口采用固定顺序，使多个错误同时存在时仍返回确定结果：

```text
Origin 校验
→ Content-Type 校验
→ JSON 请求体解析及 413/畸形 JSON 映射
→ 字段类型和格式校验
→ IP 总量与接口/账号组合限流
→ 认证业务
→ 未知 API 路由 404
→ 统一错误处理
```

`POST /api/auth/logout` 没有请求体，免除 `application/json` Content-Type 检查，但仍必须通过 Origin 校验和身份相关处理。注册与登录必须使用 `application/json`。

## 输入与 NoSQL 注入防护

- 全局 JSON 请求体上限保持 256 KiB，后续问卷提交仍可使用。
- 认证字段另设严格长度和类型校验。
- 注册和登录只接受 `application/json`；无请求体的退出接口例外。
- 查询条件只能由校验后的标量字符串构造，不能把请求对象直接传给 MongoDB。
- `username: {"$ne": null}`、数组、数字和 `null` 必须在校验层返回 `400 VALIDATION_ERROR`。
- 畸形 JSON 返回相同稳定错误结构，不暴露 Express 解析异常。

## 前端会话行为

- 提供注册、登录、当前用户和退出功能。
- 页面加载时调用 `/api/auth/me` 恢复登录状态。
- 收到 `AUTH_REQUIRED` 或 `AUTH_INVALID` 时跳转登录页。
- 跳转前由具体编辑页面把可恢复但不含凭据的草稿写入短期 `sessionStorage`，登录成功后恢复并清除；密码、JWT、匿名标识和填写会话令牌永不进入该存储。
- 登录失败保留用户名但清空密码；注册失败保留非密码字段。
- Vite 开发服务器代理 `/api`，前端请求使用相对路径并设置 `credentials: "include"`。
- `WEB_ORIGIN` 必须与浏览器地址栏来源完全一致。默认只支持 `http://localhost:5173`，使用 `http://127.0.0.1:5173` 会被 Origin 校验拒绝。

## 必须测试

- 正常注册、自动登录、当前用户和退出。
- 用户名字符、长度、大小写归一和密码边界。
- 数据库不含明文密码，scrypt 记录参数正确。
- 重复用户名及并发注册同一用户名，只产生一条记录。
- 测试开始前 `UserModel.init()` 已完成。
- 正确密码、错误密码和不存在用户；后两者响应完全一致。
- 不存在用户时确实使用预生成假哈希调用 scrypt。
- 未知或超限 scrypt 参数、畸形 Base64、错误派生密钥长度和 `timingSafeEqual` 异常均按验证失败处理。
- NoSQL 注入对象、数组、数字和 `null` 被类型校验拒绝。
- 无 Cookie、畸形 JWT、过期 JWT、错误密钥、`alg: none` 和其他算法。
- 令牌有效但用户已删除时返回 `AUTH_INVALID`。
- Cookie 的 `HttpOnly`、`SameSite`、Path、Max-Age，以及开发/生产 `Secure` 差异。
- 非允许或缺失 Origin、CORS 非允许来源、非 JSON、畸形 JSON 和超大请求体。
- 注册和登录限流、`Retry-After`、短测试窗口和计数重置。
- 登录 IP 总阈值、过期键清理、存储容量上限和满载封闭失败。
- 错误响应不泄露密码、哈希、密钥、数据库详情或堆栈。
- 成功响应只包含 `id`、`username` 和 `registeredAt`；未知 API 路由返回 JSON `404 NOT_FOUND`。
- `AUTH_INVALID` 触发登录跳转，并恢复不含凭据的页面草稿。

## 参考资料

- [Node.js Crypto：`crypto.scrypt`](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html)
- [OWASP NoSQL Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NoSQL_Security_Cheat_Sheet.html)
