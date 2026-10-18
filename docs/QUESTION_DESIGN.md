# 里程碑 4：题目与校验规则设计

本文固定里程碑 4 的题目数据结构、编辑接口、校验语义和并发行为。范围只包括草稿中的题目与校验规则；跳转规则留到里程碑 5，发布、填写会话和正式回答仍不在本里程碑实现。

## 已确认的交互原则

- 支持 `single`、`multiple`、`text`、`number` 四种题型。
- 题型创建后不可直接修改；需要换题型时新建题目并删除旧题。
- `questions` 数组位置是唯一顺序，不保存 `order` 字段。
- 每张题目卡片明确保存，不自动保存；新增但尚未满足规则的卡片只保留在前端本地。
- 每次保存、删除或移动都是一次版本级修改，成功后整个版本的 `revision` 加一。
- 页面只维护一个版本级 `revision` 状态，基础设置表单和全部题目卡片共同读取它。任一设置或题目写请求进行中时，同时禁用“保存设置”和所有题目的保存、移动、删除按钮；成功后立即用响应中的新 revision 更新这一单一状态，使写请求严格串行。
- 上移、下移每次各发送一个排序请求。数组顺序也决定“没有跳转规则时进入下一题”的默认路径，因此里程碑 5 的发布检查必须按最新顺序重新检查回跳和循环。

## 嵌套数据结构

Mongoose 的题目、选项、校验和跳转子文档均关闭自动 `_id`。稳定业务 ID 由服务端生成。

```json
{
  "questionId": "q_URL安全随机值",
  "type": "multiple",
  "title": "本课程哪些部分最有帮助？",
  "required": false,
  "validation": {
    "minSelections": 1,
    "maxSelections": 2
  },
  "options": [
    { "optionId": "o_URL安全随机值", "text": "课堂讲解" },
    { "optionId": "o_URL安全随机值", "text": "课程实验" }
  ],
  "jumpRules": []
}
```

约束：

- 每个版本最多 100 道题。
- `questionId` 格式固定为 `^q_[A-Za-z0-9_-]+$`；`optionId` 格式固定为 `^o_[A-Za-z0-9_-]+$`。
- 题目标题先做 Unicode NFC 规范化，再去除首尾空白并按码点计数，处理后为 1–300 个码点。标题拒绝换行、Unicode `Cc` 类控制字符，以及双向控制符 U+202A–U+202E、U+2066–U+2069；保留 ZWJ，使 emoji 组合序列可用。
- 选择题有 2–50 个选项。选项文字采用相同的 NFC、trim、码点和字符规则，处理后为 1–200 个码点。
- 同一道题内，选项文字先做 NFC 规范化和 trim 再比较；比较区分大小写，完全相同才视为重复。
- 选项固定为 `{ optionId, text }`，不接受其他字段。
- 修改请求中的 `optionId` 不得重复。服务端生成新 optionId 时与同一版本已有选项 ID 比对；若发生内存碰撞则重新生成，数据库不承担嵌套选项 ID 的唯一性判断。
- 里程碑 4 的 `jumpRules` 永远是空数组。创建、修改请求只要携带 `jumpRules` 字段就返回 `VALIDATION_ERROR`，不能静默忽略。

## 各题型定义规则

### 单选题 `single`

- `options` 必须有 2–50 项。
- `validation` 必须是空对象。
- 答案为一个属于该题的 `optionId` 字符串。

### 多选题 `multiple`

- `options` 必须有 2–50 项。
- `minSelections` 缺省为 1。
- `maxSelections` 缺省为选项数量。
- 有效范围为 `1 ≤ minSelections ≤ maxSelections ≤ 选项数量`，两者都必须是整数。
- 答案为不含重复值、且全部属于该题的 `optionId` 数组。

### 文本题 `text`

- `options` 必须为空数组。
- `minLength` 缺省为 0，`maxLength` 缺省为 2000；两者必须是整数，且 `0 ≤ minLength ≤ maxLength ≤ 2000`。
- `digitsOnly` 缺省为 `false`。启用时只接受 ASCII `0`–`9`；全角数字和阿拉伯-印度数字均不接受。
- 文本答案先去除首尾 Unicode 空白，再判断是否未回答、执行长度与数字字符校验，并保存处理后的值；中间的空白和换行保留。
- 手机号使用文本题与 `digitsOnly: true`，不使用数字题，以保留前导零并避免数值范围问题。

### 数字题 `number`

- `options` 必须为空数组。
- `integerOnly` 缺省为 `false`。
- `minValue`、`maxValue` 可省略，存在时必须为有限数值，且位于 `-(2^53-1)` 至 `2^53-1` 之间；两者同时存在时必须满足 `minValue ≤ maxValue`。
- `integerOnly` 为真时，`minValue` 和 `maxValue` 本身也必须是整数。
- 数字答案同样必须有限并位于上述安全范围内。`1e999` 解析得到的 `Infinity` 被拒绝；数值 `-0` 可接受，但校验结果和持久化值规范化为 `0`。

未知校验字段一律拒绝，不按题型默默丢弃。

所有题型的 `validation` 字段都必须随请求提供，但可以是空对象。允许省略的内部规则字段采用上述缺省值；服务端在保存前将缺省值全部补齐，并把补全后的规范形式写入版本文档。已保存及已发布版本的语义因此只由文档本身决定，不会因以后修改代码缺省值而改变。

规范存储形态固定如下：

| 题型       | 存储的 `validation`                                                                |
| ---------- | ---------------------------------------------------------------------------------- |
| `single`   | `{}`                                                                               |
| `multiple` | `{ minSelections: 1, maxSelections: options.length }`，使用请求值覆盖对应缺省值    |
| `text`     | `{ minLength: 0, maxLength: 2000, digitsOnly: false }`，使用请求值覆盖对应缺省值   |
| `number`   | `{ integerOnly: false, minValue: null, maxValue: null }`，使用请求值覆盖对应缺省值 |

数字题请求中的 `minValue`、`maxValue` 省略或显式为 `null` 都表示无边界，存储时统一为 `null`。`required` 也总是作为显式布尔值存储；创建请求省略它时写入 `false`。

## 题目定义校验与答案校验

实现分成两类纯校验：

1. 题目定义校验检查题型配置本身是否合法，例如选项数量、重复选项、`minSelections ≤ maxSelections` 和数字上下界。
2. `validateAnswer(question, value)` 检查一个回答是否满足已经合法且规范化的题目定义。它返回带判别字段的结果，而不是布尔值：有效回答为 `{ ok: true, value: 规范值, answered: true }`；非必答且未回答为 `{ ok: true, value: null, answered: false }`；失败为 `{ ok: false, path, reason }`。规范值包括 trim 后的文本和已把 `-0` 转成 `0` 的数字。该纯函数在里程碑 4 完成并测试，里程碑 7 和 8 直接复用，不得另写一套答案规范化。

统一的答案形态和“未回答”定义如下：

| 题型       | 答案形态          | 视为未回答               |
| ---------- | ----------------- | ------------------------ |
| `single`   | `optionId` 字符串 | 字段缺失或 `null`        |
| `multiple` | `optionId` 数组   | 字段缺失或空数组         |
| `text`     | 字符串            | 字段缺失或 trim 后为空串 |
| `number`   | 有限数值          | 字段缺失或 `null`        |

必答题未回答时校验失败；非必答题未回答时立即通过并跳过其他规则。类型不符不视为未回答，而是校验失败。

## 编辑接口语义

所有接口需要登录、资源所有权、合法 `Origin` 和 JSON 请求体，并继续受到问卷写限流与 256 KiB 请求体上限保护。为容纳逐次上移、下移，里程碑 4 把问卷写限流统一调整为每用户每 60 秒 120 次，通过 `SURVEY_WRITE_RATE_LIMIT=120` 和 `SURVEY_WRITE_RATE_WINDOW_MS=60000` 配置；创建问卷、保存设置、改管理名称和全部题目写接口共享计数，超限返回 `429 RATE_LIMITED` 并携带 `Retry-After`。

后端 CORS 明确允许 `POST`、`PUT`、`PATCH` 和 `DELETE`，以便浏览器直连后端时通过预检。

### 新增题目

`POST /api/surveys/:surveyId/versions/:versionId/questions`

- 请求包含 `revision`、`type`、`title`、必填的 `validation` 对象和完整 `options`；`validation` 可以是 `{}`，省略的内部规则字段由服务端补全并按规范形式存储。`required` 可省略，缺省为 `false`。
- 请求不得包含 `questionId`、任何 `optionId` 或 `jumpRules`。
- 服务端生成题目与选项 ID，并把新题追加到数组末尾。
- 成功返回 `201`、完整新版本、`surveyUpdatedAt` 和额外的 `questionId`，方便前端定位新卡片。

### 完整替换题目

`PATCH /api/surveys/:surveyId/versions/:versionId/questions/:questionId`

这里的 `PATCH` 与里程碑 3 的版本局部 PATCH 不同：题目请求必须完整提供 `revision`、`title`、`required`、`validation` 和完整 `options`，服务端不与旧定义做字段级合并。

- 明确拒绝 `type`、`questionId`、`jumpRules` 和未知字段。
- 已存在并保留的选项必须提交其原 `optionId`。
- 新选项不带 `optionId`，由服务端生成。
- 带有不属于当前题目的 `optionId`，包括伪造 ID 或借用其他题目的 ID，均返回 `VALIDATION_ERROR`。
- 省略原有选项表示删除该选项。里程碑 5 加入跳转引用后，删除被规则引用的题目或选项应被阻止并给出提示，不做级联删除。
- 前端必须按白名单逐项构造请求体，不能把后端题目对象展开后回传，否则只读的 `type`、`questionId` 和 `jumpRules` 会被后端拒绝。

### 删除题目

`DELETE /api/surveys/:surveyId/versions/:versionId/questions/:questionId`

请求体固定为 `{ "revision": 3 }`。缺少或错误类型的 `revision` 返回 `VALIDATION_ERROR`。因为部分代理可能丢弃 DELETE 请求体，里程碑 4 必须通过 Vite `/api` 代理做一次真实验证并记录结果；若实测丢失，则接口改为 `DELETE .../:questionId?revision=3`，文档、前端和测试同时切换，不同时支持两种来源。

### 重排题目

`PUT /api/surveys/:surveyId/versions/:versionId/question-order`

请求包含 `revision` 和完整的 `questionIds` 数组。数组必须与当前题目 ID 集合完全相同；缺少、重复、多余或格式错误的 ID 都返回 `VALIDATION_ERROR`。使用独立路径可避免 `reorder` 被 `:questionId` 路由误匹配。

只有一道题或提交与现状相同的顺序都视为合法操作，仍成功、刷新更新时间并使 revision 加一，保持所有成功题目写请求的一致语义。

格式错误的 `questionId` 返回 `400 VALIDATION_ERROR`；格式正确但在该版本中不存在时返回 `404 QUESTION_NOT_FOUND`。

## 错误判定顺序

为保证同一请求稳定得到同一错误，题目写接口按以下顺序判定：

1. 请求结构、Content-Type、路径 ID 格式和字段类型错误：`400 VALIDATION_ERROR`。
2. 问卷、版本不存在，组合错误或不属于当前用户：`404 SURVEY_NOT_FOUND`。
3. 目标版本不是草稿：`409 VERSION_NOT_EDITABLE`。
4. 客户端 `revision` 已过期：`409 DRAFT_CONFLICT`，`details.currentRevision` 返回当前值。
5. 格式正确的题目 ID 在该版本中不存在：`404 QUESTION_NOT_FOUND`。
6. 题目数量、选项重复等业务规则失败：相应业务错误；没有专用错误码时使用 `400 VALIDATION_ERROR`。

第 1 步只处理 JSON 形态、字段白名单、必填字段、原始类型和 ID 格式；长度、选项归属、重复值、完整排序集合及跨字段关系在资源、状态和 revision 检查后作为业务规则判断。新增题目没有第 5 步。字段错误的 `details.path` 使用固定路径格式，例如 `validation.maxSelections`、`options[2].text` 和 `questionIds[3]`，前端据此把错误显示在对应控件下方。

### 本里程碑新增错误码

| HTTP | 错误码                   | 判定位置与含义                               |
| ---: | ------------------------ | -------------------------------------------- |
|  404 | `QUESTION_NOT_FOUND`     | 第 5 步；格式合法的题目 ID 在版本中不存在    |
|  409 | `QUESTION_LIMIT_REACHED` | 第 6 步；新增题目时版本已经达到 100 道题上限 |

所有题目接口和里程碑 3 的版本设置 PATCH 在 revision 过期时都返回 `409 DRAFT_CONFLICT`，并固定携带 `details.currentRevision`。

## 原子更新与并发

服务先读取版本，在内存中构造并校验完整的新 `questions` 状态，然后使用 `revision` 作为条件整体 `$set` 新数组并 `$inc` revision。版本的 `updatedAt` 与 `surveys.updatedAt` 在同一 `withTransaction` 中使用同一时间更新，所有数据库操作显式传递同一 session。

条件写入未命中后重新查询，按照前述顺序区分资源不存在、版本不可编辑和 revision 冲突。这个模型也保证在已有 99 道题时，两个携带相同 revision 的并发新增请求恰好一个成功，另一个得到 `DRAFT_CONFLICT`，最终不会超过 100 道题。

## 体积边界

按标题 300 个码点、50 个选项且每项 200 个码点估算，单题正文最多约 10,300 个码点；UTF-8 全部使用四字节字符时约 41,200 字节，即约 40 KiB。若客户端 JSON 序列化器把每个非 BMP 字符写成两个 `\uXXXX` 转义，则每个 emoji 最坏占 12 个 ASCII 字节，正文约 123,600 字节，即约 121 KiB，仍低于 256 KiB 请求体上限。100 道题的 BSON 正文最坏约 4 MiB，加上字段开销仍低于 MongoDB 16 MiB 单文档限制。该估算和实际 BSON 体积检查应写入实验报告；若未来扩大限制，需要重新评估嵌套模型。

## 前端与测试验收

- 新增无效或未写完的卡片保留在前端，不发送到服务端；保存失败时不丢失输入。
- 每次成功写入都更新页面唯一的版本与 revision；写入期间统一禁用保存设置、保存题目、删除、上移和下移。
- 前端测试题目完整替换请求按白名单构造，不携带响应中的 `type`、`questionId` 或 `jumpRules`；PATCH 缺少 `required` 时后端返回 400。
- 不使用 `v-html` 渲染题目或选项文字；字段错误按 `details.path` 就近显示。
- 测试题型定义和答案校验的全部边界，包括 Unicode 码点、ASCII 数字、全角数字、阿拉伯-印度数字、`Infinity`、`-0`、安全数值范围和默认值。
- 测试请求携带 `type`、`questionId`、`jumpRules` 或未知字段会被拒绝；重复、伪造或借用其他题的 `optionId` 会被拒绝。
- 测试第 101 道题返回 `QUESTION_LIMIT_REACHED`，最坏体积单题可以保存。
- 测试排序缺少、重复或多余 ID，题目 ID 格式错误与不存在的差异；只有一道题和相同顺序的重排仍成功并使 revision 加一；测试 DELETE 请求体通过 Vite 代理。
- 测试两个相同 revision 的并发修改只有一个成功；在 99 题时并发添加不会超过 100 题。
- 99 题、100 题和最坏体积状态由受保护的测试辅助方法直接写入独立测试库构造，不通过接口循环创建，避免 revision 和限流干扰。
- 测试规范化后的 validation 缺省值实际写入数据库；NFC 等价选项被判重复，标题换行和双向控制符被拒绝，含 ZWJ 的 emoji 通过。
- 测试必答文本的纯空白答案失败；单选传数组、数字传字符串、多选重复或使用其他题 optionId 均失败；文本成功结果返回 trim 后的值、保留中间换行并按 trim 后码点数判断长度。
- 扩展种子数据，提供四种题型和手机号文本题，便于人工检查。

本设计通过人工检查后再实现，不把上述约定提前视为已完成代码。
