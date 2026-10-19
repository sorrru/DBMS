# 里程碑 6：版本发布与生命周期设计

本文记录里程碑 6 开工前经人工审阅的候选方案。范围包括发布事务、下一版本草稿、放弃草稿、版本历史、手工关闭与重新开放；公开填写仍留到里程碑 7。

## 核心不变量

- 一份问卷最多有一个 `draft` 版本，由 `surveys.draftVersionId` 指向，并由 `survey_versions` 上的草稿部分唯一索引兜底。
- 一份问卷最多有一个当前发布版本，由 `surveys.currentVersionId` 指向；旧发布版本继续保留。
- 对任一版本，`status === "published"` 当且仅当 `publishedAt !== null`。
- 已发布版本不可修改。新草稿只复制允许的问卷定义字段，不共享可变嵌套对象。
- 发布新版本不改变 `publicId`，不自动修改 `manualStatus`，也不删除旧版本。
- 所有权或问卷/版本组合错误统一返回 `SURVEY_NOT_FOUND`，避免越权探测。

## 有效状态与共享时钟

问卷对外状态统一为 `draft | published | closed | expired`，不再把 `open` 暴露为有效状态。`manualStatus` 仍只在数据库内部使用 `open | closed`。

```text
没有 currentVersionId                  → draft
manualStatus=closed                    → closed
currentVersion.deadline <= now         → expired
其他                                   → published
```

`closed` 的优先级高于 `expired`。重新开放只把 `manualStatus` 改为 `open`；若当前版本已经到期，有效状态仍为 `expired`。发布新版本时保留 `manualStatus`：手工关闭的问卷发布 v2 后仍为 `closed`；原来仅因旧版本到期而 `expired` 的问卷，发布带未来截止时间的 v2 后可自然变为 `published`。

`computeSurveyStatus(survey, currentVersion, now)` 放在 `packages/survey-logic`，创建者列表、后续公开摘要、创建填写会话和提交服务共用。`now` 必须显式传入；API 服务通过构造函数注入时钟，生产默认使用系统时间，测试使用固定时间。时钟不暴露为 HTTP 参数或环境开关。

问卷摘要中的 `currentVersion` 与 `draftVersion` 都增加 `deadline`；列表继续一次批量读取一页问卷涉及的全部版本，禁止 N+1，然后用共享函数计算状态。

## 发布接口与两步警告确认

`POST /api/surveys/:surveyId/versions/:versionId/publish`

请求字段必须完整且无未知字段：

```json
{ "revision": 9, "acknowledgeWarnings": false }
```

`acknowledgeWarnings` 是必填布尔值，不设缺省值。警告只由草稿内容决定；确认天然绑定 revision：内容未变时警告不变，内容变化后旧 revision 返回 `DRAFT_CONFLICT`，用户必须重新检查和确认。

错误判定顺序固定为：

1. 请求结构、路径格式和 `acknowledgeWarnings` 类型错误：`400 VALIDATION_ERROR`。
2. 问卷、版本、不属于当前用户或组合错误：`404 SURVEY_NOT_FOUND`。
3. 版本不是草稿：`409 VERSION_NOT_EDITABLE`。
4. revision 或当前草稿指针已经变化：`409 DRAFT_CONFLICT`，能取得时返回 `details.currentRevision`。
5. 发布检查含阻止项：`409 PUBLISH_BLOCKED`，`details.check` 返回完整检查结果。
6. 只有警告且 `acknowledgeWarnings=false`：`409 PUBLISH_WARNINGS_UNCONFIRMED`，`details.check` 返回最新警告。

`acknowledgeWarnings=true` 且无阻止项时允许发布；没有警告时传 true 也合法。成功返回完整 `{ survey, version, check }`。`check.revision` 等于发布请求 revision。

## 发布事务与条件更新

发布使用 `withTransaction`。事务内读取最新问卷和版本并调用共享 `validateForPublish`，但最终并发正确性不依赖“先读后判断”。写入必须使用以下条件：

- 版本：`{ _id: versionId, surveyId, status: "draft", revision }`。
- 问卷：`{ _id: surveyId, ownerId, draftVersionId: versionId }`。

`withTransaction` 可能重新执行回调，因此 `now` 必须在事务回调内部、每次执行回调时重新从注入时钟读取，不能在调用 `withTransaction` 之前缓存。一次回调内只读取一次，并让版本的 `publishedAt`、版本的 `updatedAt` 和问卷的 `updatedAt` 共用同一个 `now`。

事务内按顺序：

1. 重新读取并检查所有权、版本状态、revision 和当前草稿指针。
2. 对事务快照中的草稿重新执行 `validateForPublish`。
3. 条件更新版本为 `published`，设置 `publishedAt=now`、`updatedAt=now`，不增加 revision。
4. 条件更新问卷：`currentVersionId=versionId`、`draftVersionId=null`、`updatedAt=now`，不修改 `manualStatus`。

任一条件更新未命中就中止事务，并在事务外重新读取最小必要字段，按前述顺序区分 `SURVEY_NOT_FOUND`、`VERSION_NOT_EDITABLE` 和 `DRAFT_CONFLICT`。并发草稿编辑或另一次发布会产生写冲突；`withTransaction` 自动重试后必须落到稳定的业务错误，不能无条件覆盖。

测试通过服务构造函数注入仅测试使用的失败协作者，在“版本状态更新后”和“问卷指针更新后”分别抛错。该能力不提供路由、环境变量或生产开关。两个注入点都必须验证版本状态、`publishedAt`、当前版本指针、草稿指针和 `updatedAt` 完全回滚。

## 创建下一版本草稿

`POST /api/surveys/:surveyId/versions`

请求：

```json
{ "sourceVersionId": "当前发布版本 ObjectId" }
```

创建顺序固定为：请求校验 → 问卷所有权 → 没有发布版本 `SURVEY_NOT_PUBLISHED` → 已有草稿 `DRAFT_ALREADY_EXISTS` → 来源不是当前版本 `SOURCE_VERSION_NOT_CURRENT` → 事务写入。这样初始 v1 草稿稳定命中 `SURVEY_NOT_PUBLISHED`，而已发布且已有下一版草稿的问卷仍可命中 `DRAFT_ALREADY_EXISTS`。

事务开始前生成新 version ObjectId。事务内重新读取问卷，并使用条件更新保护：

```js
{
  _id: surveyId,
  ownerId,
  draftVersionId: null,
  currentVersionId: sourceVersionId
}
```

新版本使用字段白名单和 `structuredClone` 深复制 `title`、`description`、`identityMode`、`allowMultipleSubmissions`、`deadline`、`sessionDurationMinutes`、`questions` 与 `schemaVersion`。不得复制 `_id`、`status`、`revision`、`publishedAt`、`createdAt` 或 `updatedAt`。新值固定为：

- 新 `_id`
- `versionNumber = current.versionNumber + 1`
- `status = draft`
- `revision = 1`
- `publishedAt = null`
- 题目、选项和规则稳定 ID 原样保留

同一事务把 `draftVersionId` 指向新版本并刷新 `surveys.updatedAt`；`currentVersionId` 不变，旧版本继续服务。

两次并发创建由问卷条件更新和“每问卷最多一个草稿”的部分唯一索引双重保护。捕获 `11000` 时必须检查 `keyPattern`；只有草稿部分唯一索引才直接映射为 `DRAFT_ALREADY_EXISTS`。若先触发 `{surveyId, versionNumber}` 唯一索引或事务写冲突，则重新读取问卷：已经出现草稿时同样返回 `DRAFT_ALREADY_EXISTS`，否则按真实原因处理，其他重复键不得误报。

插入版本后、更新问卷前设置失败注入点，验证事务不会留下孤立版本。

## 放弃下一版本草稿

采用人工建议，提供 `DELETE /api/surveys/:surveyId/versions/:versionId`。请求体固定为：

```json
{ "revision": 3 }
```

只允许删除当前 `draftVersionId` 指向的草稿，并且问卷必须已有 `currentVersionId`；因此初始 v1 草稿不能放弃，已发布版本不能删除。操作使用事务和条件删除：版本条件包含 `_id`、`surveyId`、`status: draft`、`revision`，问卷条件包含 `ownerId`、`draftVersionId: versionId`。事务清空 `draftVersionId` 并刷新 `surveys.updatedAt`。

错误判定顺序固定为：请求结构与路径格式错误 `400 VALIDATION_ERROR` → 问卷、版本、所有权或组合错误 `404 SURVEY_NOT_FOUND` → 没有当前发布版本 `409 SURVEY_NOT_PUBLISHED` → 目标不是草稿 `409 VERSION_NOT_EDITABLE` → revision 或草稿指针过期 `409 DRAFT_CONFLICT`。初始 v1 草稿命中 `SURVEY_NOT_PUBLISHED`，其错误消息固定为“初始草稿不能放弃”。DELETE 的 JSON 请求体沿用里程碑 4 已通过人工检查的 Vite 代理行为；缺少或错误类型的 `revision` 在第一步拒绝。

草稿从未开放填写，不会被填写会话或回答引用。下次创建仍从当前发布版本计算 `versionNumber + 1`，因此不会留下版本号空洞。失败区分 `SURVEY_NOT_FOUND`、`SURVEY_NOT_PUBLISHED`、`VERSION_NOT_EDITABLE` 和 `DRAFT_CONFLICT`。

## 版本历史

`GET /api/surveys/:surveyId/versions?limit=20&cursor=...`

先验证问卷所有权，再查询版本。按 `versionNumber DESC` 排序，`limit` 默认 20、范围 1–50；无效值返回 `VALIDATION_ERROR`。

历史列表使用聚合管道：

1. `$match`：`surveyId` 及游标的版本号范围。
2. `$sort`：`versionNumber: -1`。
3. `$limit`：多取一条判断下一页。
4. `$project`：只返回摘要字段，并用 `$size` 计算 `questionCount`。

不得把最坏约 4 MiB 的完整 `questions` 数组传回应用层后再计数。现有唯一索引 `{ surveyId: 1, versionNumber: 1 }` 可反向扫描；保存脱敏后的 `explain("executionStats")` 证据，说明 winning plan、扫描方向、返回数和文档/索引键扫描数。

两个分页接口改用同一套通用 HMAC 游标签名器。派生标签统一迁移为 `survey-cursor-signing-key:v2`，具体接口由已签名负载中的 `kind` 隔离：

```json
{ "kind": "versions", "surveyId": "...", "versionNumber": 3 }
```

问卷列表游标固定为 `{ "kind": "surveys", "updatedAt": "...", "id": "..." }`。kind、问卷 ID、字段集合、签名或格式不匹配均返回 `VALIDATION_ERROR`，两个接口的游标不能混用。该迁移会使里程碑 3 旧的临时分页游标失效；游标本来就是短期页面状态，刷新列表即可取得新游标，这是本地课程项目接受的兼容性取舍。

版本摘要包含 `id`、`versionNumber`、`status`、`title`、`questionCount`、`revision`、`deadline`、三个时间字段、`isCurrent` 和 `isDraft`。完整内容继续由现有版本详情接口读取；发布版本前端只读显示。

## 手工关闭与重新开放

`PATCH /api/surveys/:surveyId/status`

请求只允许：

```json
{ "manualStatus": "closed" }
```

或：

```json
{ "manualStatus": "open" }
```

拒绝 `manualStatus` 之外的未知字段。首次条件更新的过滤固定包含 `_id`、`ownerId`、`currentVersionId: { $ne: null }` 和与请求值相反的 `manualStatus`；只有实际变化时才写入新状态并刷新 `surveys.updatedAt`。

条件更新未命中后重新按 `_id + ownerId` 读取：问卷不存在或越权返回 `SURVEY_NOT_FOUND`，没有当前版本返回 `SURVEY_NOT_PUBLISHED`，当前值已经等于请求值则按幂等成功返回且不写入。单文档原子更新即可，不使用事务。成功响应批量/单次读取当前版本摘要，并使用其中的 `deadline` 与当前服务端时间重新计算 `{ survey }` 的有效状态。

## 前端行为

- 发布按钮位于发布前检查之后。服务器返回阻止项时复用稳定 ID 定位；返回未确认警告时展示明确确认，再用同一 revision 和 `acknowledgeWarnings=true` 重试。
- 发布请求若因网络重试得到 `VERSION_NOT_EDITABLE`，前端重新获取问卷和版本；若该版本已经成为当前版本，按发布成功后的状态呈现，不显示误导性的失败提示。
- 发布成功后当前版本只读显示；用户明确点击“创建下一版本草稿”才生成 v2。
- 版本历史标明当前版本和编辑中草稿，可打开任一版本查看；发布版本不显示编辑控件。
- 下一版本草稿提供“放弃草稿”，操作前二次确认。
- 手工关闭状态下发布新版本后提示“新版本已发布，但问卷仍处于关闭状态”。
- 重新开放后如果有效状态仍为 `expired`，提示“当前版本已过期，需要发布带新截止时间的版本”。
- 从旧版本复制出的截止时间若已过去，草稿编辑页立即标记；发布仍由 `DEADLINE_PASSED` 阻止。

## 测试矩阵

- 不可变矩阵：已发布版本的设置修改、题目增删改排序、规则 PUT、validate 和再次 publish 全部返回 `VERSION_NOT_EDITABLE`。
- 不变量：所有版本均满足 `status === published` 当且仅当 `publishedAt` 非空。
- 发布阻止：分别以 `EMPTY_SURVEY`、`JUMP_CYCLE`、`DEADLINE_PASSED` 阻止发布，并断言 `details.check` 的完整结构；固定时钟下 deadline 恰好等于 now 时也视为已过期。
- 首次发布：`currentVersionId` 指向 v1、`draftVersionId` 清空、`manualStatus` 保持原值；`publishedAt`、版本 `updatedAt` 和问卷 `updatedAt` 使用同一次事务回调内的 now，revision 不变。
- 回滚：发布的两个失败注入点和创建草稿的一个失败注入点均完全回滚。
- 并发：相同 revision 的两个发布恰好一个成功；发布与题目编辑、发布与放弃草稿分别竞争且恰好一个成功；两个并发创建草稿一个 `201`、一个 `DRAFT_ALREADY_EXISTS`。
- 两步确认：false 返回最新警告，true 成功；修改内容后旧 revision 不能继续确认。
- 深复制：v2 保留全部稳定 ID；依次修改 v2 设置、题目、选项和规则后，逐字段比较 v1 文档保持不变。
- 状态矩阵：固定时钟覆盖 draft、published、closed、expired 和 `deadline=null`，关闭优先于到期，发布 v2 不改变 manualStatus，重新开放不绕过截止时间，幂等状态请求不刷新时间。
- 历史：倒序、游标、题数、标记、越权 404、跨接口/跨问卷游标拒绝和索引 explain。
- 放弃草稿：v1、发布版本和 stale revision 均不能删除；删除 v2 后没有孤立版本或版本号空洞，可再次创建 v2；发布与放弃竞争时恰好一个成功。
- 输入与越权：`acknowledgeWarnings` 缺失或非布尔值返回 400；发布、创建草稿、放弃草稿、历史和状态修改对非所有者一律返回 404；状态请求拒绝未知字段。
- 索引：通过 `listIndexes` 断言“每问卷一个草稿”的部分唯一索引存在，且 `unique`、键和 `partialFilterExpression: { status: "draft" }` 与设计完全一致。
- 种子：至少包含“已发布 v1 + 草稿 v2”、手工关闭和自动到期样例；过期样例通过固定时钟或受保护的直接数据库构造，不放宽生产截止时间校验。

## 错误码

| HTTP | 错误码                         | 含义                           |
| ---: | ------------------------------ | ------------------------------ |
|  409 | `PUBLISH_BLOCKED`              | 发布检查存在阻止项             |
|  409 | `PUBLISH_WARNINGS_UNCONFIRMED` | 存在尚未明确确认的发布警告     |
|  409 | `DRAFT_ALREADY_EXISTS`         | 问卷已经有下一版本草稿         |
|  409 | `SURVEY_NOT_PUBLISHED`         | 操作要求已有当前发布版本       |
|  409 | `SOURCE_VERSION_NOT_CURRENT`   | 创建草稿的来源不是当前发布版本 |

其余请求继续复用 `VALIDATION_ERROR`、`SURVEY_NOT_FOUND`、`VERSION_NOT_EDITABLE`、`DRAFT_CONFLICT` 和统一认证错误。
