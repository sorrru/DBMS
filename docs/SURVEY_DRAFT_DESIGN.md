# 问卷主体与 v1 草稿设计

## 文档状态与范围

本文记录里程碑 3 开工前经人工确认的方案。范围只包括问卷长期主体、v1 基础设置草稿、创建者列表和安全种子数据；不包含题目、发布、关闭、填写、统计、删除或归档。

不提供删除与归档是有意的边界。发布后删除将影响历史版本和回答，必须在完整生命周期下另行设计；开发数据由受保护的种子清理命令处理。

## 字段与默认值

`surveys.internalName` 是仅创建者可见的管理名称，长度为 1–80 个 Unicode 码点。`survey_versions.title` 是以后向填写者展示的公开标题，长度为 1–120 个 Unicode 码点。创建时只要求一个 `internalName`，并把它同时作为 v1 初始标题；以后修改公开标题不会自动修改管理名称。

管理名称和标题先去除首尾空白；处理后为空则拒绝。两者不允许换行或 Unicode 控制字符。说明字段保留换行，但拒绝换行以外的控制字符。规范化后的值再按 Unicode 码点计算长度。

管理名称通过 `PATCH /api/surveys/:surveyId` 单独修改，并更新 `surveys.updatedAt`，因此也会把该问卷移到最近编辑列表前方。本里程碑不为该低风险私有标签增加独立 revision，多个页面同时改名时采用最后一次成功写入；草稿定义仍使用严格的 revision 并发控制。

v1 默认值：

```json
{
  "versionNumber": 1,
  "status": "draft",
  "revision": 1,
  "title": "创建时的管理名称",
  "description": "",
  "identityMode": "anonymous",
  "allowMultipleSubmissions": false,
  "deadline": null,
  "sessionDurationMinutes": 30,
  "questions": [],
  "schemaVersion": 1,
  "createdAt": "数据库写入时间",
  "updatedAt": "数据库写入时间",
  "publishedAt": null
}
```

说明最多 2,000 个 Unicode 码点。长度统一在后端校验层通过码点计数，不依赖 Mongoose 按 UTF-16 单元计算的 `maxlength`；必须用 emoji 边界测试证明行为一致。名称、标题和说明全部按纯文本保存和渲染，Vue 模板不使用 `v-html`。

`identityMode` 只能为 `anonymous` 或 `identified`，`allowMultipleSubmissions` 必须为布尔值。`deadline` 为 `null` 或带 `Z`/明确时区偏移的 ISO 8601 字符串；无时区字符串、无效日期、对象和数组均拒绝。设置非空截止时间时必须晚于保存时刻、不得超过保存时刻后 5 年，并按 UTC 保存；发布时再次校验。

## 创建事务与公开标识

`POST /api/surveys` 使用 MongoDB `withTransaction`，让驱动处理可重试的瞬时事务错误。事务开始前生成 survey 与 version 两个 ObjectId，并在首次插入时直接写入相互引用：

- survey 的 `draftVersionId` 直接指向 v1，`currentVersionId` 为 `null`。
- v1 的 `surveyId` 直接指向 survey。
- 两个文档全部写入成功后才提交。

`publicId` 使用至少 128 位随机值和 URL 安全编码。数据库唯一索引是最终保障；随机碰撞实际可忽略，不在事务内部局部重试。重复键等写入错误会使整个事务中止，不能留下孤立文档。

事务开始前必须完成 `SurveyModel.init()` 和 `SurveyVersionModel.init()`，不能在事务内临时建索引。`survey_versions` 建立 `{ surveyId: 1, status: 1 }` 条件唯一索引，仅对 `status: "draft"` 生效，保证每份问卷最多一个草稿。事务内每一次读取和写入都必须显式传递同一个 session。强制失败注入只通过测试依赖提供，生产构建不暴露开关、环境变量或 HTTP 入口。

## 创建数量与写入限流

每个用户默认最多创建 100 份问卷，通过 `SURVEY_MAX_PER_USER` 配置。创建前按所有者计数，达到上限返回 `409 SURVEY_LIMIT_REACHED`。第一阶段接受极端并发下少量超过上限，因为唯一的严格计数器会显著增加写入复杂度；报告中明确这一边界。

创建问卷、修改管理名称和保存草稿共用每用户写限流，默认 15 分钟 60 次，通过 `SURVEY_WRITE_RATE_LIMIT` 与 `SURVEY_WRITE_RATE_WINDOW_MS` 配置。超限沿用 `429 RATE_LIMITED` 和 `Retry-After`。数量上限控制长期数据增长，速率限制控制脚本式快速写入，两者不能互相替代。

## 草稿保存与并发

草稿使用从 1 开始的整数 `revision`。PATCH 请求必须提交客户端读取到的 revision，并只提交实际修改的设置字段。后端在事务中执行条件更新：

```text
surveyId + versionId + status=draft + revision=请求 revision
```

匹配成功时更新设置、令 `revision + 1`、刷新版本自身的 `updatedAt`，并在同一事务中更新 `surveys.updatedAt`。响应返回完整公开草稿、新 revision 和 `surveyUpdatedAt`。

条件更新未匹配时不更新 survey。事务退出后再进行一次归属和状态查询，将失败稳定地区分为：

- 问卷不存在、不属于当前用户、版本不存在或版本不属于该问卷：`404 SURVEY_NOT_FOUND`。
- 版本存在但不是 `draft`：`409 VERSION_NOT_EDITABLE`。
- 草稿仍可编辑但 revision 已变化：`409 DRAFT_CONFLICT`，错误 `details.currentRevision` 返回数据库中的当前 revision，便于前端直接比较。

两个并发 PATCH 使用相同 revision 时，必须恰好一个返回 `200`，另一个返回 `409 DRAFT_CONFLICT`，不能静默覆盖。

PATCH 请求中 `revision` 必填且必须是正整数。`deadline: null` 表示清除截止时间，不传 `deadline` 表示保持原值。除 `revision`、`title`、`description`、`identityMode`、`allowMultipleSubmissions` 和 `deadline` 外的字段全部拒绝；空修改、`ownerId`、`sessionDurationMinutes`、客户端指定的新 revision 及其他未知字段都返回 `VALIDATION_ERROR`。

## 所有权与响应边界

后端只从登录 Cookie 确定当前用户，查询问卷时始终同时使用 `_id` 与 `ownerId`。格式错误的 ObjectId 返回 `VALIDATION_ERROR`；合法但不存在或属于其他用户的 ID 返回 `SURVEY_NOT_FOUND`，不泄露资源是否存在。

响应只返回 API 定义的字段，不返回 `ownerId`、MongoDB `__v` 或内部索引信息。`surveyId` 与 `versionId` 可以返回给所有者用于后续操作。

## 列表与游标

“我的问卷”按 `surveys.updatedAt DESC, _id DESC` 稳定排序，使用索引：

```js
{ ownerId: 1, updatedAt: -1, _id: -1 }
```

默认每页 20 条，最大 50 条。`limit` 必须是 1–50 的整数，越界或格式错误时返回 `VALIDATION_ERROR`，不静默截断。查询多取一条判断是否存在下一页。游标是不透明、带版本号和签名的 Base64URL 值，内部包含上一页末项的 `updatedAt` 与 `_id`。签名密钥通过 `HMAC-SHA256(key=JWT_SECRET, data="survey-list-cursor-key:v1")` 做用途隔离派生，再用派生密钥签名游标负载；游标不是登录令牌，也不能作为授权依据。格式错误、签名错误、字段错误或被篡改的游标返回 `VALIDATION_ERROR`。

下一页查询固定为同一所有者，且满足 `updatedAt` 小于游标时间，或 `updatedAt` 相同而 `_id` 小于游标 ID。即使游标通过签名，也仍重新应用 `ownerId` 条件。

`updatedAt` 会在编辑时变化，因此翻页期间恰好被编辑的问卷可能重复出现或被跳过。本项目接受这种弱一致分页特性；刷新列表会恢复最新顺序。游标签名只用于稳定格式与发现篡改，不是安全边界，所有查询仍重新应用 `ownerId`。

列表需要的版本信息不在 surveys 中。取得一页 surveys 后，后端同时收集非空的 `draftVersionId` 与 `currentVersionId`，通过一次 `_id: { $in: [...] }` 查询批量取得草稿和当前版本摘要，再在内存中按 ID 合并；禁止逐条查询造成 N+1。里程碑 3 的 `currentVersionId` 恒为 `null`，但现在保留该路径以避免里程碑 6 重写列表查询。

里程碑 9 保存 `explain("executionStats")` 证据，证明列表查询使用上述复合索引。里程碑 3 先建立索引并测试分页顺序、同时间戳下的 `_id` 次序和批量版本查询。

## 前端保存和恢复

使用明确的“保存设置”按钮，不自动保存。修改后显示未保存状态，成功后显示保存时间；离开有未保存内容的页面前提示。

截止时间在界面上拆分为年、月、日、小时、分钟和时区，但不再要求用户切换输入模式。年份和分钟使用可直接键入、可用滚轮微调的输入框；月、日、小时和时区使用原生选择框，移动端可调用系统滚轮式选择器。关闭“设置截止时间”时提交 `null`。界面先检查字段完整性、日期是否真实存在及 UTC 偏移范围，再组合为秒固定为 `00` 的带时区 ISO 8601 字符串；未来时间和五年上限仍由后端最终校验。数据库返回的 UTC 时间按浏览器当前时区展示，只有用户实际修改后才加入差量 PATCH。

登录失效时，可恢复的纯业务字段写入 `sessionStorage`。键同时包含 `surveyId`、`versionId` 和编辑开始时的 revision。重新登录后先取得服务器当前 revision，再显示服务器值与本地值对比，由用户确认后才能保存；不能自动覆盖。保存成功或用户放弃恢复后立即删除本地草稿。密码、JWT、匿名标识和任何会话令牌仍禁止进入存储。

## 种子数据与清理

种子脚本使用固定的开发测试用户名，密码必须由 `SEED_USER_PASSWORD` 提供。每次执行先清理该种子账号拥有的数据，再创建账号、匿名 v1 草稿和实名 v1 草稿，因此可重复运行。

保护规则：

- `NODE_ENV=production` 时拒绝运行。
- `mongodb+srv` URI 直接拒绝。解析普通 MongoDB URI 后，其中每一个主机都必须属于明确的本地/Compose 允许列表，只要一个主机不匹配就拒绝运行。
- 清理范围只基于固定种子账号的 `_id`，不接受任意用户名或 ID 参数。
- 清理顺序从依赖端开始：`responses` → `fill_sessions` → `survey_versions` → `surveys` → `users`。当前尚不存在数据的集合允许跳过，后续里程碑沿用并扩展同一清理函数。

提供 `seed` 和 `seed:clean` 两个命令。它们只负责开发演示数据，不能替代正式的删除或归档业务。

`.env.example` 只提供空的 `SEED_USER_PASSWORD=`。脚本复用正式密码规则；变量缺失、为空或不合规时给出明确错误，并且不连接或修改数据库。

测试数据库固定使用与开发库不同且名称以 `_test` 结尾的数据库。任何清库或 `dropDatabase()` 前都必须检查 `NODE_ENV=test`、拒绝 `mongodb+srv`、确认 URI 中每个主机均为本地允许值，并确认数据库名以 `_test` 结尾；任一条件不满足时立即拒绝执行。

## 必须测试

- 创建事务成功，survey 与 v1 直接互相引用，默认值正确。
- 在两次插入之间强制失败，事务完全回滚。
- `publicId` 唯一索引存在，响应不含 `ownerId` 或 `__v`。
- 管理名称、标题和说明按 Unicode 码点校验，包含 emoji 边界。
- 默认匿名、默认禁止重复，截止时间 `null`、时区偏移、UTC 保存和过期值校验。
- `ownerId`、未知字段、对象式 deadline、空 PATCH，以及 revision 缺失或类型错误被拒绝。
- 修改管理名称不会修改公开标题。
- 草稿保存与 survey 的 `updatedAt` 在同一事务中完成。
- 每次成功保存草稿都会刷新版本自身的 `updatedAt`，响应中的 `surveyUpdatedAt` 与问卷记录一致。
- 不存在、非所有者、错误问卷/版本组合和已发布版本返回约定错误。
- 两个相同 revision 的并发 PATCH 恰好一个 `200`、一个 `409`，成功响应包含递增后的 revision。
- 列表参数越界返回 `VALIDATION_ERROR`；列表使用稳定游标、多取一条，并一次批量取得草稿与当前版本摘要，不执行逐条版本查询。
- 游标格式或签名被篡改时返回 `VALIDATION_ERROR`。
- 文本以纯文本渲染，不使用 `v-html`。
- `sessionStorage` 键包含 surveyId、versionId、revision；恢复需确认，成功保存后清除。
- 前端保存请求只发送真正修改过的字段，未修改但已经过期的旧 deadline 不会被重新提交。
- 种子和清理脚本在生产环境及非本地数据库上拒绝运行，并可在本地重复执行。
- 测试清库在环境、所有 URI 主机和 `_test` 库名校验通过后才能执行。
