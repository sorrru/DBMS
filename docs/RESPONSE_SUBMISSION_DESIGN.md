# 正式回答提交设计

本文记录里程碑 8 开工前经人工审阅的正式回答提交方案。范围包括可信路径重算、答案规范化、事务写入、按版本去重、幂等重试、4 MiB 独立正文限制和填写端提交结果。统计与创建者回答分页留到里程碑 9。

## 1. 提交接口与请求结构

接口固定为：

```http
POST /api/public/sessions/:sessionId/submit
Content-Type: application/json
```

请求只允许：

```json
{
  "answers": [
    { "questionId": "q_1", "value": "option_a" },
    { "questionId": "q_3", "value": "文本回答" }
  ]
}
```

`answers` 必填且可以为空，最多 100 项；空数组在真实路径全部为非必答题且均未回答时可以成功。每项只允许 `questionId` 和 `value`。重复或未知 questionId、未知字段、非法 ID 格式均返回 `400 VALIDATION_ERROR`，`details.path` 指向原请求位置，例如 `answers[2].questionId`。

结构预检只接受字符串、有限数值、字符串数组或 null；数组最多 50 项。对象、布尔值、非有限数值、嵌套数组等在路径计算前返回 `VALIDATION_ERROR`。结构合法但题型不匹配的值，例如数字题的字符串、外来选项或重复多选值，不在结构预检阶段失败。

## 2. 中间件顺序与独立正文限制

提交接口的顺序固定为：

1. Origin 校验；
2. Content-Type 校验；
3. 登录 Cookie 认证；
4. sessionId、填写 Cookie、ownerKey 所有权校验；
5. 对已提交会话执行幂等返回；
6. 按账号和会话执行提交限流；
7. 检查手工关闭、绑定版本截止和会话到期；
8. 用独立 `express.json({ limit: "4mb" })` 解析正文；
9. 请求结构预检；
10. 真实路径计算与路径内答案校验；
11. 事务写入。

全局 256 KiB 解析器必须跳过提交路径，提交路由在认证和状态校验之后才调用 4 MiB 解析器。未认证的超大请求返回 401，服务不会先缓冲和解析其正文。超过 4 MiB 返回 `PAYLOAD_TOO_LARGE`，畸形 JSON 返回 `VALIDATION_ERROR`，其他接口仍保持 256 KiB。

4 MiB 的依据是最坏合法提交约含 100 道文本题，每题 2000 个码点；即使 JSON 把非 BMP 字符写成两个 `\uXXXX`，正文约 2.4 MB，加字段开销后仍低于 4 MiB。该估算写入实验报告。

提交限流新增三个启动配置：窗口、单账号上限和单会话上限。候选默认值为 15 分钟内每账号 60 次、每会话 10 次；均使用现有有容量上限的内存限流器，返回 `RATE_LIMITED` 与 `Retry-After`。限流发生在正文解析前；已经 submitted 的廉价幂等读取在限流之前返回，不消耗活动提交额度，保证响应丢失后的恢复路径不会被此前的失败尝试阻断。

## 3. 幂等重试优先级

所有权校验成功后，如果会话已经是 submitted，服务立即按 `fillSessionId` 读取既有回答并返回 200：

```json
{
  "submission": {
    "id": "response ObjectId",
    "submittedAt": "2026-10-20T14:30:00.000Z",
    "versionId": "version ObjectId",
    "questionPath": ["q_1", "q_3"],
    "ignoredQuestionIds": ["q_2"],
    "alreadySubmitted": true
  }
}
```

幂等判定早于手工关闭、版本截止、会话到期和正文解析。因此成功发生在第 29 分 59 秒、重试发生在第 30 分 01 秒，或成功后问卷被关闭时，仍返回原提交结果。幂等响应以第一次保存的数据为准，不读取、不解析也不比较重试请求体。

首次 201 和幂等 200 都清除填写 Cookie。清除头必须使用创建时完全相同的 Name `survey_fill` 和 Path `/api/public/sessions/{sessionId}`，设置 `Max-Age=0`，并保持 HttpOnly、SameSite 与生产 Secure 规则。

## 4. 服务端真实路径与答案校验

客户端不提交 questionPath；若提交未知顶层字段则返回 `VALIDATION_ERROR`。服务端从发布版本第一题开始，使用共享 `evaluateNextQuestion` 和规范答案语义计算路径。非规范答案在路由阶段按未回答处理，不做类型转换；路径确定后再对路径内题目调用共享答案校验。

规则如下：

- 只校验真实路径上的题目；跳过的必答题不要求回答。
- 路径内必答题未回答失败；非必答题未回答不写入 answers。
- 已知但位于路径外的答案不校验内容并忽略，包括题型不匹配、外来选项等业务非法值；但所有值仍须先通过 JSON 结构预检。
- 未知题目 ID 和重复题目 ID直接拒绝，不属于 ignored。
- 路径外题目按发布版本题目顺序写入并返回 `ignoredQuestionIds`，保证稳定。
- 文本保存 NFC、trim 后的值并保留中间换行；-0 保存为 0。
- 多选答案按题目 options 的顺序保存，不保留客户端数组顺序。
- 路径计算出现循环，或题目、选项、规则结构损坏时，记录服务端错误并返回 `409 SURVEY_VERSION_INVALID`。

路径内校验失败返回 `400 ANSWER_VALIDATION_FAILED`：

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

每项包含稳定 questionId、机器码 code、path 和中文 message。存在请求项时 path 使用原数组下标，例如 `answers[1].value`；完全缺失的必答题 path 为空。issues 按真实路径题目顺序排列，每题最多一项，总数不超过 100。机器码至少覆盖 `REQUIRED`、`TYPE_MISMATCH`、`UNKNOWN_OPTION`、`DUPLICATE_SELECTION`、`SELECTION_COUNT`、`TOO_SHORT`、`TOO_LONG`、`DIGITS_ONLY`、`OUT_OF_RANGE` 和 `NOT_INTEGER`。共享 `validateAnswer` 的失败结果扩展 code，既有调用者可以继续使用 path 和 reason/message。

## 5. responses 文档与匿名边界

正式回答结构：

```json
{
  "_id": "ObjectId",
  "surveyId": "ObjectId(surveys)",
  "surveyVersionId": "ObjectId(survey_versions)",
  "fillSessionId": "ObjectId(fill_sessions)",
  "ownerKey": "内部问卷内稳定 HMAC 键",
  "dedupKey": "仅禁止重复时存在",
  "respondentId": "仅实名版本存在",
  "questionPath": ["q_1", "q_3", "q_5"],
  "ignoredQuestionIds": ["q_2"],
  "answers": [{ "questionId": "q_1", "value": "option_a" }],
  "submittedAt": "Date"
}
```

`ignoredQuestionIds` 随回答保存，使不读取重试正文的幂等响应仍能返回第一次的完整结果。问卷、版本和题目定义不复制进回答，依赖不可变 surveyVersionId。responses 永久保存，不设 TTL。

匿名版本不写 respondentId；实名版本从已验证会话的 userId 复制，绝不读取请求中的账号字段。两种模式都保存内部 ownerKey。创建者接口永远删除 ownerKey、dedupKey 和 fillSessionId；里程碑 9 对匿名回答的提交时间只提供日期等粗粒度值，避免用毫秒时间与具体人员活动对应。

fillSessionId 是一次提交的唯一性锚点，不要求永久引用完整性；fill_sessions 会在 purgeAt 到达后由 TTL 清理，因此该引用以后可能悬空，responses 仍保持独立有效。

## 6. 索引与重复限制

建立三个索引：

```js
{ fillSessionId: 1 }
unique: true

{ surveyVersionId: 1, dedupKey: 1 }
unique: true
partialFilterExpression: { dedupKey: { $type: "string" } }

{ surveyVersionId: 1, submittedAt: -1, _id: -1 }
```

禁止重复时写入 dedupKey=ownerKey；允许重复时省略 dedupKey。ownerKey 按问卷稳定，但唯一索引包含 surveyVersionId，所以同一账号仍可分别向 v1 和 v2 提交一次。允许重复时同一账号可用多个会话提交多次，但 fillSessionId 唯一索引保证一个会话最多产生一份回答。

里程碑 7 的创建会话 `SubmissionLookup` 在本里程碑连接到 responses 查询，使禁止重复的用户在开始填写前就收到 `ALREADY_SUBMITTED`。并发正确性仍由唯一索引保证，不能依赖先查再写。捕获 11000 时必须核对 keyPattern：版本去重索引映射为 `ALREADY_SUBMITTED`；fillSessionId 冲突进入同会话幂等分类；其他重复键继续作为内部错误。

## 7. 事务与状态转换

提交使用 `withTransaction`。每次事务回调重试时重新取得 now，并在事务内重读会话、问卷、绑定版本和可能存在的 response。顺序为：

1. 已提交会话返回既有 response；
2. 检查关闭、绑定版本截止和会话 expiresAt；
3. 重算路径并规范化答案；
4. 以 `_id + status:active + expiresAt:{$gt:now}` 条件更新会话为 submitted，同时设置 submittedAt=now、activeSlot=null；
5. 在会话更新成功后插入 response，使用同一个 now；
6. 提交事务。

先条件更新会话会占住该会话文档。同会话并发请求发生写冲突，驱动重试后看到 submitted 并返回同一个幂等结果。条件更新未命中后重新读取，只可能分类为已提交幂等成功或 `SESSION_EXPIRED`；不新增不可达的 `SUBMISSION_CONFLICT`。

禁止重复的不同会话并发时，其中一个 response 插入命中版本去重唯一索引，整个失败事务会回滚其会话状态，返回 `ALREADY_SUBMITTED`。允许重复的不同会话可以分别成功。

测试失败注入点放在“会话更新后”和“回答插入后”，两个位置都必须验证会话、activeSlot 和 response 完全回滚。手工关闭与提交并发时允许线性化为任一先后；关闭响应完成后才开始的提交必须看到 closed。

里程碑 7 已实现创建会话前的惰性槽位回收：按同一 surveyId+ownerKey 读取 active 会话，用各自绑定版本 deadline 与 expiresAt 计算状态，对过期项条件更新为 expired 并把 activeSlot 设为 null。因此未提交的过期会话不会在七天 TTL 清理前持续占用五个活动槽位。

## 8. 成功响应与前端

首次事务成功返回 201，结构与幂等响应一致，仅 `alreadySubmitted:false`。响应不含 ownerKey、dedupKey、respondentId、fillSessionId 或规范化答案正文。

前端复核页增加正式提交按钮。成功后清除对应 sessionStorage 草稿和填写 Cookie，显示提交编号与时间。`ANSWER_VALIDATION_FAILED` 保留草稿，按 issues 第一项回到题目并在题下显示错误；路径外答案同步从本地删除。关闭、截止、会话过期和 SESSION_NOT_FOUND 清除无效草稿并显示对应原因。网络错误保留草稿，允许用户重试；幂等 200 显示“该回答此前已提交成功”。

## 9. 测试矩阵

- 四种题型成功与失败、规范化存储、多选按选项顺序存储。
- answers 空数组、未知/重复题目、未知字段、非法原始值、数组超过 50。
- 跳过的必答题允许提交；跳转到的必答题必须回答。
- 路径外业务非法值被忽略；客户端无法伪造 questionPath。
- issues 含稳定 code，按真实路径排序，缺失必答题 path 为空。
- 匿名 response 无 respondentId，实名 response 使用会话账号，所有对外响应隐藏内部身份字段。
- 禁止重复时同一版本一次，v1/v2 各一次；允许重复时不同会话均成功。
- 同一会话并发和到期后重试均返回相同 submission.id 的幂等成功。
- 不同会话并发禁止重复时只有一份 response，失败事务恢复 active 会话。
- 关闭、绑定版本截止和会话到期的 <=now 边界。
- 会话更新后、回答插入后两个失败注入点完全回滚。
- 未认证超大请求返回 401；认证后的超限请求 413；普通接口仍为 256 KiB。
- 账号和会话限流、Retry-After、窗口恢复和容量边界。
- 首次及幂等成功的 Cookie 清除 Name、Path、Max-Age 和 Secure 差异。
- listIndexes 断言三个索引；最坏合法体积可以保存。
- 种子数据加入匿名、实名、分支路径和允许/禁止重复的既有回答，供里程碑 9 人工核算。
