# 里程碑 9：按版本统计与文本回答分页设计

本文记录里程碑 9 开工前经人工审阅的统计方案。统计只读取已发布版本的正式回答，严格以 `surveyVersionId` 隔离；草稿返回 `VERSION_NOT_PUBLISHED`。范围包括聚合指标、只读快照、匿名文本分页、不透明加密游标、超时与限流、执行计划和两套实验数据。方案确认后已经实现并验收；里程碑 10 又补充了实名提交记录，使没有文本回答的实名版本也能列出全部提交账号。本段保留原始决策背景，不把后续实现倒写成开工前事实。

## 1. 接口与判定顺序

创建者接口：

```http
GET /api/surveys/:surveyId/versions/:versionId/statistics
GET /api/surveys/:surveyId/versions/:versionId/responses?questionId=q_text&limit=20&cursor=...
GET /api/surveys/:surveyId/versions/:versionId/submissions?limit=20&cursor=...
```

`statistics` 拒绝全部未知查询参数。`responses` 只分页读取文本题回答；`questionId` 必填并先按题目 ID 格式校验。`submissions` 只分页读取实名版本的提交账号与时间。两个分页接口的 `limit` 缺省为 20，必须是 1–50 的整数，cursor 必须成功解密并绑定当前问卷、版本和游标类型；文本游标还绑定题目。固定判定顺序：

1. 查询参数或路径格式错误：`400 VALIDATION_ERROR`；
2. 问卷、版本不存在、组合错误或不属于当前账号：`404 SURVEY_NOT_FOUND`；
3. 版本不是 `published`：`409 VERSION_NOT_PUBLISHED`；
4. 文本分页的题目不存在：`404 QUESTION_NOT_FOUND`；
5. 题目不是文本题：`400 VALIDATION_ERROR`；
6. submissions 的版本不是实名模式：`400 VALIDATION_ERROR`；
7. 用户统计限流；
8. 执行有 10 秒上限的统计或分页查询。

查询超时、快照事务无法在限制内完成或数据库暂时无法提供统计时，返回 `503 STATISTICS_UNAVAILABLE`，不暴露驱动错误。三个接口均设置 `Cache-Control: no-store`。越权统一 404。

## 2. 指标定义

每份 response 是一次正式提交：

- `submissionCount`：目标版本的正式回答数；
- `reachedCount`：`questionPath` 包含该题的回答数；
- `answeredCount`：`answers` 包含该题的回答数；
- `notReachedCount = submissionCount - reachedCount`，界面文案为“未到达（被跳转跳过）”；
- `unansweredReachedCount = reachedCount - answeredCount`；
- `reachRate = reachedCount / submissionCount`；
- `answerRate = answeredCount / reachedCount`。

比例分母为零时返回 0。后端返回 JavaScript 双精度计算结果，不预先按显示位数四舍五入；前端负责格式化。每题同时返回发布版本中的 `required`。

所有结果必须满足：

```text
answeredCount <= reachedCount <= submissionCount
```

生产环境若发现不变量被损坏，只累计一条结构化服务端日志摘要，不按每条异常回答刷日志，也不把损坏细节返回创建者。

## 3. 各题型结果

单选题按发布版本选项顺序返回所有选项；未选择项也返回 0。选项人数之和必须等于 `answeredCount`，`percentageOfAnswered=count/answeredCount`。

多选题对数组值展开，统计选择每个选项的回答人数。规范回答内无重复选项，因此每个选项人数不得超过 `answeredCount`；各选项百分比之和允许超过 100%。

文本题的统计摘要只返回到达数和回答数，正文由分页接口读取。

数字题返回：

```json
{
  "count": 35,
  "average": 4.285714285714286,
  "minimum": 0,
  "maximum": 12
}
```

`count` 必须等于该题 `answeredCount`。没有数值答案时 `count` 为 0，`average`、`minimum`、`maximum` 均为 `null`，因为 0 是合法答案，不能代表无数据。

## 4. 聚合与一致性

不使用一个大型 `$facet`。MongoDB 官方文档说明 `$facet` 每个阶段生成的文档受 100 MB 限制、不能落盘且 `allowDiskUse` 不改变限制，最终结果仍受 16 MiB BSON 文档限制。

统计在一个 `readConcern: "snapshot"` 的只读事务中执行五条职责单一的管道，全部显式传入同一个 session 和 `maxTimeMS: 10000`：

1. 版本提交总数；
2. 展开 `questionPath` 并按 questionId 统计到达数；
3. 展开 `answers` 并按 questionId 统计回答数；
4. 合并选择题统计：只保留单选和多选 questionId，再展开 `answers.value`；MongoDB 对非数组值按单元素处理，最后按 questionId 与 optionId 分组；
5. 只保留数字题并计算 `$sum`、`$avg`、`$min`、`$max`。

每条管道第一阶段都 `$match: { surveyVersionId }`，随后尽早 `$project`，只保留该管道需要的 `questionPath` 或 `answers`。事务内不使用 `$out`、`$merge` 或 `explain`。应用层按不可变发布版本的题目与选项顺序组装结果、补零并计算比例。

快照一致性测试在第一条和第二条管道之间通过测试注入点、用事务外的另一连接插入一份新回答；当前请求的五条管道仍必须看到同一个快照并满足全部不变量，新回答只出现在下一次统计请求。

## 5. 文本回答分页管道

第一页和后续页都沿现有索引 `{ surveyVersionId: 1, submittedAt: -1, _id: -1 }` 扫描。第一阶段 `$match` 同时包含：

- `surveyVersionId`；
- `"answers.questionId": questionId`；
- 后续页的 `(submittedAt, _id)` 字典序范围。

随后按 `{ submittedAt: -1, _id: -1 }` 排序并 `$limit(limit + 1)`，最后才 `$project`，通过 `$filter` 和 `$arrayElemAt` 取出目标题的文本值。实现使用预期索引 hint，避免阻塞排序；`answers.questionId` 不在该索引中，因此没有回答该题的记录越多，`totalDocsExamined` 可能越大，报告必须如实记录。正式回答不可修改，新回答只出现在第一页之前，旧页游标顺序稳定。

实名版本收集当前页所有 `respondentId`，以一次 `_id: { $in: [...] }` 批量读取用户，禁止逐条查询。测试通过查询监控断言用户查询恰好一次。

## 6. AES-256-GCM 不透明游标

里程碑 3 和 6 的问卷、版本游标属于创建者自己的管理数据，继续使用签名游标。匿名文本游标不能使用可读的 Base64URL JSON，因为精确 submittedAt 和带时间信息的 ObjectId 会泄露提交时间。

文本回答游标使用 AES-256-GCM。256 位密钥从 `JWT_SECRET` 通过 HMAC-SHA-256 与专用标签 `statistics-text-cursor-key:v1` 派生；每次编码生成随机 12 字节 IV，使用固定版本字符串作为 AAD，输出版本、IV、密文和 16 字节认证标签的 Base64URL 组合。GCM 标签同时验证完整性，不再叠加独立签名。

加密明文严格包含：

```json
{
  "v": 1,
  "kind": "text-responses",
  "surveyId": "...",
  "versionId": "...",
  "questionId": "q_text",
  "submittedAt": "精确 ISO 时间，仅服务端可见",
  "id": "response ObjectId，仅服务端可见"
}
```

解密后严格校验字段集合、版本、kind、三个绑定 ID、ISO 时间和 ObjectId。认证失败、字段错误、跨接口/问卷/版本/题目复用统一返回 `400 VALIDATION_ERROR`。JWT_SECRET 轮换会使旧分页游标失效，这是可接受边界。

测试必须证明：直接 Base64URL 解码任一游标片段得不到合法 JSON，完整游标不包含明文时间字符串或 ObjectId，任意一位篡改都会被拒绝。

## 7. 匿名与实名响应白名单

匿名文本项只返回：

```json
{ "value": "文本回答", "submittedDate": "2026-10-20" }
```

日期固定为 UTC 的 `YYYY-MM-DD`，前端明确标注“UTC 日期”。不返回 response id、精确时间、respondentId 或任何内部身份键；页面使用当前页数组下标作为渲染 key。

实名文本项返回 value、精确 submittedAt 和 `{ id, username }` respondent。所有创建者响应都递归扫描并禁止 `ownerKey`、`dedupKey`、`fillSessionId`、`respondentKey`；匿名响应另外禁止 `respondentId`、`submittedAt` 和通用 `id` 字段。

匿名仍有两个明确边界：页内顺序会泄露相对提交先后；样本很少时，文本内容以及数字最小值、最大值可能让创建者推断回答者。第一阶段不做小样本抑制或随机扰动。

实名版本另提供提交记录分页，不依赖任何题目是否作答。每份 response 对应一项，返回精确 submittedAt 和 `{ id, username }` respondent；允许重复填写时同一账号的多份回答分别出现，不做去重。查询沿 `{ surveyVersionId, submittedAt: -1, _id: -1 }` 索引倒序分页，并以一次用户批量查询补全账号。匿名版本不开放该接口。

## 8. 限流、超时与日志

新增并在启动时校验正整数及合理上限：

- `STATISTICS_RATE_LIMIT_WINDOW_MS=60000`；
- `STATISTICS_RATE_LIMIT_USER_MAX=30`；
- `STATISTICS_MAX_TIME_MS=10000`。

统计、文本分页和实名提交记录共享单用户窗口，返回既有 `RATE_LIMITED` 与 `Retry-After`。MongoDB `MaxTimeMSExpired`、事务时间限制或可重试后仍无法取得快照统一映射为 `503 STATISTICS_UNAVAILABLE`。未预期错误仍为 `INTERNAL_ERROR`。

损坏回答日志按一次请求汇总：未知题目数、未知选项数、非法数字数和受影响版本，不记录匿名正文、ownerKey 或完整 response。

## 9. 前端

已发布版本只读页与版本历史提供“查看统计”。页面顶部显示版本、提交数、生成时间和手工刷新；不自动轮询。每题卡显示 required、到达、回答、未到达（被跳转跳过）和到达但未答。

实名版本统计页底部自动显示“实名提交记录”，即使问卷没有文本题或填写者未回答文本题也能看到账号。每次提交单独一行显示账号与本地化提交时间，并可继续加载下一页；匿名版本不渲染该区域。

单选、多选显示人数和比例条；多选注明比例之和可能超过 100%。数字无数据时显示“暂无数据”。文本题按页加载，保留换行使用 `white-space: pre-wrap`，匿名条目标注 UTC 日期，实名条目显示账号和精确时间。全部内容按纯文本渲染，不使用 `v-html`。

## 10. 实验数据与 explain

准备两套相互独立的数据：

1. 小型固定数据：覆盖跳转、未回答、全部题型、匿名和实名，可逐项手算并写入报告对照表；
2. 性能数据：用固定随机种子直接向受保护的本地测试库写入 50,000 份回答，用于 explain 和耗时比较。保存生成脚本、随机种子、版本、参数与清理命令；脚本复用生产环境拒绝、本地主机白名单和测试库名保护。

`explain("executionStats")` 不能在事务中运行，因此 `docs/experiments/MILESTONE9_STATISTICS_EXPLAIN.md` 使用相同参数和同一批管道在事务外单独执行。记录 winningPlan、索引、totalKeysExamined、totalDocsExamined、executionTimeMillis、是否阻塞排序，以及 `$unwind`、`$group` 等索引后阶段为何不能继续使用索引。文本分页另记录低回答率时扫描文档数增加的结果。

MongoDB 限制依据：[官方 `$facet` 文档](https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/)和[官方 aggregate command 文档](https://www.mongodb.com/docs/manual/reference/command/aggregate/)；最终报告引用这两个一手来源，不把测试日志当成规范依据。

## 11. 测试预言

- 两个版本完全隔离，草稿返回 409，越权统一 404；
- 三个接口均 `no-store`；未知参数、非法 questionId、limit 0/51/非整数均 400；
- `answered <= reached <= submissions`；单选总和等于 answered，多选单项不超过 answered，数字 count 等于 answered；
- 跳转、非必答、零回答、零计数选项、负数和小数均正确；数字无数据三个统计值为 null；
- 快照注入测试仍满足全部不变量；
- 匿名响应和加密游标通过递归泄露扫描，实名用户只批量查询一次；
- 游标倒序、同时间 `_id` 次序、篡改和跨范围复用均正确；
- 每条管道传 session 和 maxTimeMS，超时稳定返回 503；限流覆盖 Retry-After 与窗口恢复；
- 实名提交记录逐次列出所有提交，不依赖文本题作答；匿名版本拒绝该接口；
- 前端覆盖百分比、空状态、UTC 标签、分页、换行、实名提交记录和纯文本渲染。
