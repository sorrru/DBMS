# 里程碑 7：填写会话与逐题填写设计

## 文档状态与范围

本文记录里程碑 7 开工前经人工审阅的候选方案。范围包括公开摘要、登录后创建和恢复填写会话、固定发布版本、逐题路径、倒计时及安全的本地答案恢复。正式写入回答、服务端路径复核、重复提交唯一索引和会话原子提交留到里程碑 8。

## 公开入口与认证

稳定公开页面路径为 `/fill/:publicId`。未登录用户可以读取公开摘要，但点击“开始填写”必须登录。匿名只表示创建者不能看到账号身份，不表示免登录；匿名页面明确提示“创建者看不到您的身份，登录仅用于会话所有权和防止重复”，实名页面明确提示“创建者将看到您的账号”。

登录返回地址只接受匹配下式的站内绝对路径：

```text
^/fill/[A-Za-z0-9_-]+(/session/[A-Za-z0-9]+)?$
```

不接受协议、主机、双斜线、反斜线、编码后绕过或其他路径。无效返回地址一律忽略并进入默认登录后页面，防止开放重定向。

登录 JWT 继续严格遵守 `AUTH_DESIGN.md`：最长两小时，不刷新。创建填写会话不得重新签发登录 Cookie。登录过期或用户主动退出时，前端先尽力保存不含凭据的答案草稿，再进入登录页；同一账号重新登录后，凭仍有效的填写 Cookie 恢复。其他账号不能读取会话。前端可以提示登录可能在填写期间过期，但 HttpOnly JWT 不向 JavaScript 暴露精确到期时间；本里程碑不为该可选提示扩大认证响应。

## 公开响应白名单与缓存

三个公开接口的响应统一设置 `Cache-Control: no-store`。公开摘要只返回 `publicId`、有效状态、标题、说明、身份模式、截止时间、题数和会话时长。创建和恢复返回的版本只含 `id`、`versionNumber`、标题、说明、身份模式、截止时间、会话时长、题目、选项、校验和跳转规则。

填写者响应不得包含 `surveyId`、revision、schemaVersion、发布时间、创建/更新时间、`allowMultipleSubmissions`、内部管理名称、用户 ID、`ownerKey`、`sessionTokenHash`、`activeSlot` 或 MongoDB 内部字段。服务端业务仍可读取未公开字段决定是否允许重复填写。

## fill_sessions 数据模型

```json
{
  "_id": "ObjectId",
  "surveyId": "ObjectId(surveys)",
  "surveyVersionId": "ObjectId(survey_versions)",
  "identityMode": "anonymous | identified",
  "ownerKey": "HMAC 摘要",
  "userId": "仅 identified 模式保存；anonymous 模式字段不存在",
  "sessionTokenHash": "SHA-256 随机令牌摘要",
  "status": "active | expired | submitted",
  "activeSlot": "active 时为 0–4；其他状态为 null",
  "startedAt": "Date",
  "expiresAt": "Date",
  "purgeAt": "expiresAt 后 7 天",
  "submittedAt": null
}
```

版本定义不可变，因此会话只引用 `surveyVersionId`，不复制题目。里程碑 7 不在会话中保存答案。`submitted` 字段和转换约定先建模，实际原子提交在里程碑 8 接入。

## ownerKey、匿名边界与密钥轮换

匿名和实名会话都生成同一个内部所有权键：

```text
ownerKey = HMAC-SHA256(
  ANONYMOUS_ID_SECRET,
  "survey-owner:v1\0" + surveyId + "\0" + userId
)
```

域标签、分隔符和字段顺序固定，防止不同用途或拼接边界混淆。不包含版本 ID，因此同一账号在同一问卷的不同版本中稳定，在不同问卷中不可关联。匿名会话不保存 `userId`；实名会话额外保存 `userId`，供里程碑 8 的实名回答使用。后续禁止重复时，匿名和实名均以 `ownerKey` 作为版本内去重身份键，不再维护含义重复的 `respondentKey`。

这是面向创建者的假名化，不是绝对匿名：能够读取 `ANONYMOUS_ID_SECRET` 和用户表的运维人员可以重新计算并关联身份。该限制必须写进报告。已有数据存续期间不得直接轮换此密钥；轮换会导致会话所有权恢复和跨时间去重失效。未来若必须轮换，需要带 key version 的双读迁移方案，本阶段不实现。

## 会话令牌与双 Cookie

创建会话时生成 32 个随机字节，以 Base64URL 作为明文令牌，仅通过 Cookie 发送；数据库只保存 SHA-256 摘要。高熵随机令牌不需要慢密码哈希。Cookie 固定为：

```text
Name = survey_fill
HttpOnly = true
SameSite = Lax
Secure = 生产 true，开发 false
Path = /api/public/sessions/{sessionId}
Max-Age = expiresAt - startedAt 的秒数
```

页面地址 `/fill/:publicId/session/:sessionId` 只包含非机密 sessionId。动态 Path 允许多个标签页同时填写不同会话，并使 Cookie 自动覆盖恢复和后续 `/submit` 子路径。令牌不得出现在 JSON、URL、日志、JavaScript 状态、`localStorage` 或 `sessionStorage`。

创建接口要求登录 Cookie。恢复和以后提交同时要求登录 Cookie 与填写 Cookie：缺少或无效登录 Cookie 沿用 `AUTH_REQUIRED`/`AUTH_INVALID`；会话不存在、填写令牌缺失或错误、令牌属于其他会话、ownerKey 不匹配均统一为 `SESSION_NOT_FOUND`，不泄露会话是否存在。退出登录只清除登录 Cookie，因双 Cookie 校验立即失去访问能力；填写 Cookie 在剩余 30 分钟内保留，以支持同账号重新登录后继续。

## 状态计算

共享包新增纯函数 `computeSessionState(session, survey, sessionVersion, now)`。它不复用只针对当前版本的 `computeSurveyStatus`，顺序固定为：

```text
session.status=submitted                          → submitted
survey.manualStatus=closed                       → closed
sessionVersion.deadline != null 且 deadline<=now → survey_expired
session.expiresAt<=now                           → expired
否则                                              → active
```

关闭优先于两种到期，版本截止优先于会话计时。旧会话始终使用自己绑定版本的 deadline；例如 v2 已截止而当前 v3 无截止时间，v2 会话仍为 `survey_expired`。边界统一使用 `<= now`。

业务判断每次都调用纯函数，不依赖 TTL 或后台任务。服务在创建和恢复等相关操作中把已到期且仍存为 `active` 的会话惰性条件更新为 `expired`，同时把 `activeSlot` 设为 null；状态只允许 `active → expired` 或里程碑 8 的 `active → submitted`，不可逆。并发提交仍必须以 `status=active + expiresAt>now` 条件更新，不能依赖惰性写回。

## 每问卷活动会话上限

同一 `surveyId + ownerKey` 最多五个有效活动会话。每个 active 会话由服务分配 `activeSlot` 0–4，并建立条件唯一索引：

```js
{ surveyId: 1, ownerKey: 1, activeSlot: 1 }
unique: true
partialFilterExpression: { status: "active" }
```

创建前先惰性释放已过期槽位，再读取已占槽位并尝试最小空槽。并发请求若争用同一槽位，捕获 `11000` 后必须核对 `keyPattern`，重新读取并尝试其他槽；五个槽全部占用时返回 `SESSION_LIMIT_REACHED`。最多进行有限的五槽尝试，其他重复键不误报。这样上限由索引保证，不依赖“先 count 再 insert”的竞态检查。

另建 `{ surveyId: 1, ownerKey: 1, status: 1, expiresAt: 1 }` 支持惰性过期和活动会话查询。`purgeAt` 建 TTL `expireAfterSeconds: 0`；其值为 expiresAt 加七天。业务到期即时生效，MongoDB TTL 仅负责延迟物理清理。

## API 与固定顺序

### 公开摘要

`GET /api/public/surveys/:publicId` 无需登录。草稿、从未发布或 publicId 不存在统一返回 `PUBLIC_SURVEY_NOT_FOUND`。关闭和到期仍返回 200 摘要及对应状态，使页面可以解释原因；不能开始填写。

### 创建会话

`POST /api/public/surveys/:publicId/sessions` 必须发送 JSON 空对象 `{}`，拒绝未知字段，成功返回 201、写入填写 Cookie，并返回白名单会话与版本。中间件和业务顺序固定为：

```text
Origin / Content-Type / JSON / 空对象校验
→ 登录认证
→ 账号+IP 与 IP 总量限流
→ 公开问卷存在
→ 手工关闭
→ 当前版本截止
→ allowMultipleSubmissions=false 时检查当前版本已有 response
→ 惰性释放过期槽位并检查五会话上限
→ 创建并绑定调用时读取到的当前发布版本
```

`ALREADY_SUBMITTED` 的数据依据只能是里程碑 8 的 `responses(surveyVersionId, ownerKey)`，不能以会话记录代替；里程碑 7 只完成接口位置和服务依赖边界，responses 建立后才启用该分支。摘要与创建之间发生发布时，以创建响应绑定的版本为准。操作开始读取状态时仍开放的并发请求可以线性化为先于关闭或发布；关闭/发布响应完成后才开始的请求必须看到新状态，并通过并发测试固定边界。

### 恢复会话

`GET /api/public/sessions/:sessionId` 需要双 Cookie，成功返回会话、serverNow 与同一份填写者版本白名单。顺序为登录认证 → sessionId 格式 → 会话、令牌和 ownerKey 统一查验 → 手工关闭 → 绑定版本截止 → 30 分钟会话到期 → 返回。状态错误不返回完整版本。

后续提交路径统一为 `POST /api/public/sessions/:sessionId/submit`，不再把明文 token 放入路径。里程碑 8 实现该接口。

## 错误码

| HTTP | 错误码                    | 含义                                                        |
| ---: | ------------------------- | ----------------------------------------------------------- |
|  404 | `PUBLIC_SURVEY_NOT_FOUND` | publicId 不存在、从未发布或只有草稿                         |
|  409 | `SURVEY_CLOSED`           | 问卷被创建者手工关闭                                        |
|  409 | `SURVEY_EXPIRED`          | 会话要使用的发布版本截止时间已到                            |
|  404 | `SESSION_NOT_FOUND`       | 会话、填写令牌或所有权不匹配，统一隐藏存在性                |
|  409 | `SESSION_EXPIRED`         | 填写会话自身的 30 分钟期限已到                              |
|  409 | `SESSION_LIMIT_REACHED`   | 同一账号在同一问卷已有五个活动会话                          |
|  409 | `ALREADY_SUBMITTED`       | 禁止重复时，该 ownerKey 已向当前版本提交；里程碑 8 正式接入 |

限流沿用 `429 RATE_LIMITED`，登录沿用现有认证错误。多个条件同时成立时使用前述接口固定顺序。

## 限流与配置

创建会话使用两层内存限流：同一账号与来源 IP 每 15 分钟 20 次；同一 IP 总计每 15 分钟 100 次。环境变量为：

```text
FILL_SESSION_RATE_LIMIT_WINDOW_MS=900000
FILL_SESSION_RATE_LIMIT_ACCOUNT_IP_MAX=20
FILL_SESSION_RATE_LIMIT_IP_MAX=100
```

三个值启动时必须是正整数，并设置合理上限，防止溢出或形同虚设；窗口最大 24 小时、两个次数最大 10000。超限返回 `RATE_LIMITED` 和 `Retry-After`。复用现有限流器的过期清理、容量上限和测试注入，不提供生产 HTTP 重置接口。限流发生在认证和请求结构校验后、数据库业务查询前。

## 逐题填写与路径

页面一次显示一道题。进度显示“第 n 题（最多 N 题）”，因为条件跳转会改变实际路径；上一题按已经走过的路径回退，不按版本数组下标减一。点击下一题先调用共享 `validateAnswer`，再用规范值调用 `evaluateNextQuestion`。修改早期答案后重新调用 `computePath`，立即清除新路径之外的答案。

单选使用单选按钮，多选使用复选框，文本题不使用 HTML `maxlength`，长度完全由共享函数按 Unicode 码点校验。数字输入的空串视为未回答；无法解析成安全有限数值时显示题下错误，不做隐式类型转换。错误始终显示在对应控件下。

最后一题后进入回答检查页。里程碑 7 只展示“回答已准备完成”，不伪造提交成功；正式提交按钮和事务在里程碑 8 接入。

## 倒计时与本地恢复

服务端返回 `serverNow`、`expiresAt` 和版本 deadline。前端以取得响应时的 `performance.now()` 为基点，使用服务端剩余毫秒减去单调经过时间，不受用户修改系统时钟影响；标签页后台恢复时重新按单调时间计算，不简单每秒递减。最终有效性始终由服务端时钟判断。

非凭据答案草稿自动防抖写入：

```text
sessionStorage key = fill-draft:{sessionId}:{versionId}
value = { answers, currentQuestionId, savedAt }
```

写入使用 try/catch；配额或浏览器策略拒绝时显示非阻塞提示，不能影响继续填写。序列化草稿上限固定为 2 MiB，超过时停止本地保存并提示。该上限独立于普通 API 的 256 KiB：100 道合法文本答案合计可能超过 256 KiB，里程碑 8 必须为提交路由设置独立的 4 MiB 原始请求上限，同时保持其他接口的全局小上限。

恢复前先成功调用恢复接口，再把本地数据作为不可信输入处理：严格解析对象、限制总大小、丢弃未知题目 ID和错误类型的值，对保留值重新执行 `validateAnswer`，最后重算 `computePath` 并删除路径外答案。收到 `SESSION_NOT_FOUND` 时立即删除该 sessionId 对应的本地草稿，避免共用电脑换账号后残留答案；`SESSION_EXPIRED`、成功提交或用户明确放弃时同样清除。

## 测试矩阵

- 响应白名单和 `Cache-Control: no-store`；公开与创建者接口均不泄露 ownerKey、令牌摘要或匿名 userId。
- 摘要无需登录，创建必须登录；返回地址仅接受规定的站内填写路径。
- 登录 JWT 不刷新；登录过期和主动退出后，同账号重新登录可恢复，其他账号统一 404。
- 填写 Cookie 的 HttpOnly、SameSite、动态 Path、Max-Age 和开发/生产 Secure 差异。
- 双 Cookie 矩阵：缺登录、缺填写令牌、错会话令牌、错误 sessionId 和其他账号。
- 匿名数据库文档没有 userId；同问卷跨版本 ownerKey 相同，跨问卷不同；所有响应隐藏 ownerKey。
- 新会话绑定当前版本，发布后旧会话仍绑定旧版本；v2 deadline 已过而 v3 开放时，旧 v2 会话返回 SURVEY_EXPIRED。
- 草稿/未发布、关闭、版本截止、会话截止、五会话上限及每个边界等于 now。
- activeSlot 条件唯一索引、并发六次创建最多五个成功、过期后释放槽位；TTL 的键和 expireAfterSeconds 正确。
- 两层限流、Retry-After、窗口重置、配置启动校验和容量封闭失败。
- sessionStorage 防抖、配额异常、大小上限、不可信恢复、未知题目、错误值和 SESSION_NOT_FOUND 清理。
- 第一条规则、修改早期答案、路径外答案清除、上一题历史路径、文本码点和数字错误。
- 创建会话与发布/关闭的竞争满足文档线性化边界。
- 本地种子提供匿名、实名、关闭、到期和带旧版本会话的人工检查场景。
