# 第一阶段项目报告事实核对表

记录日期：2026-10-21

本文件为项目报告的事实底稿，不代替最终报告。每一批 Markdown 草稿都应先核对本表；提交最终 Markdown 前必须重新执行版本、测试、索引和 Git 状态检查，不能把本次快照误写成永久不变的结论。

## 1. 核对优先级

发生不一致时，按以下顺序确认并修正文档：

1. 实际运行的 MongoDB `listIndexes()`、脱敏字段存在性检查和最终测试结果；
2. Mongoose schema、服务代码、共享逻辑与路由代码；
3. `docs/API.md`、设计文档和实验记录；
4. README 与报告草稿。

索引必须同时比较 Mongoose 声明和 MongoDB 实际结果。开发数据库可能保留已经从代码删除的旧索引，因此不能只读取 schema，也不能只读取一套长期使用的数据库。

## 2. 当前环境快照

| 项目           | 当前核对值                              | 事实来源                                   |
| -------------- | --------------------------------------- | ------------------------------------------ |
| Git 基线       | 里程碑 11 文档提交 `825172b`            | `git rev-parse --short HEAD`、`git status` |
| Node.js        | 24.22.0                                 | `node -v`、`.nvmrc`、根 `package.json`     |
| npm            | 11.19.1                                 | `npm -v`                                   |
| TypeScript     | 5.9.3                                   | `package-lock.json`                        |
| Vue            | 3.5.44                                  | `package-lock.json`                        |
| Vite           | 8.3.4                                   | `package-lock.json`                        |
| Express        | 5.3.0                                   | `package-lock.json`                        |
| Mongoose       | 9.11.2                                  | `package-lock.json`                        |
| Vitest         | 5.0.5                                   | `package-lock.json`                        |
| Supertest      | 7.3.1                                   | `package-lock.json`                        |
| MongoDB        | 8.0.34                                  | `docker-compose.yml` 与运行容器            |
| Docker Compose | 5.6.0                                   | 运行容器标签；不是项目锁定依赖             |
| 最新完整测试   | 共享逻辑 11、API 147、Web 26，共 184 项 | 2026-10-21 报告编写阶段再次执行 `npm test` |

## 3. 五个集合的字段核对

字段以 `apps/api/src/models` 中的 Mongoose schema 为主，并于 2026-10-21 在新建的本地 `survey_report_test` 种子库核对实际字段。核对完成后执行 `seed:clean`，不采用长期开发数据库中的偶然文档数量作为报告证据。

| 集合              | schema 中的业务字段                                                                                                                                                                                                                | 实际字段检查   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `users`           | `username`、`usernameNormalized`、`passwordHash`、`registeredAt`                                                                                                                                                                   | 与 schema 一致 |
| `surveys`         | `ownerId`、`publicId`、`internalName`、`manualStatus`、`currentVersionId`、`draftVersionId`、`createdAt`、`updatedAt`                                                                                                              | 与 schema 一致 |
| `survey_versions` | `surveyId`、`versionNumber`、`status`、`revision`、`title`、`description`、`identityMode`、`allowMultipleSubmissions`、`deadline`、`sessionDurationMinutes`、`questions`、`schemaVersion`、`createdAt`、`updatedAt`、`publishedAt` | 与 schema 一致 |
| `fill_sessions`   | `surveyId`、`surveyVersionId`、`identityMode`、`ownerKey`、可选 `userId`、`sessionTokenHash`、`status`、`activeSlot`、`startedAt`、`expiresAt`、`purgeAt`、`submittedAt`                                                           | 与 schema 一致 |
| `responses`       | `surveyId`、`surveyVersionId`、`fillSessionId`、`ownerKey`、可选 `dedupKey`、可选 `respondentId`、`questionPath`、`ignoredQuestionIds`、`answers`、`submittedAt`                                                                   | 与 schema 一致 |

按版本 `identityMode` 分组的字段不变量结果如下：匿名版本有 4 个会话，`userId` 存在数为 0；实名版本有 2 个会话，`userId` 存在数为 2。匿名版本有 3 份回答，`respondentId` 存在数为 0；实名版本有 2 份回答，`respondentId` 存在数为 2。检查只输出模式和计数，没有输出用户名、密码哈希、ownerKey、令牌摘要或回答正文。

执行步骤（`SEED_USER_PASSWORD` 使用临时合规值，记录中不保存其内容）：

```bash
MONGODB_URI='mongodb://127.0.0.1:27017/survey_report_test?replicaSet=rs0&directConnection=true' \
SEED_USER_PASSWORD='<redacted>' npm run seed
docker compose exec -T mongodb mongosh --quiet survey_report_test --eval '<identity-mode aggregation>'
MONGODB_URI='mongodb://127.0.0.1:27017/survey_report_test?replicaSet=rs0&directConnection=true' \
SEED_USER_PASSWORD='<redacted>' npm run seed:clean
```

## 4. 实际索引快照

以下结果来自 2026-10-21 新建并随后清理的 `survey_report_test` 数据库 `listIndexes()`，与 Mongoose schema 和索引测试一致。每个集合自动存在的 `_id` 索引不重复列入业务索引数量。

| 集合              | 键                                                      | 属性                                                     | 服务的查询或不变量                   |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| `users`           | `{ usernameNormalized: 1 }`                             | 唯一                                                     | 规范化用户名注册与登录               |
| `surveys`         | `{ publicId: 1 }`                                       | 唯一                                                     | 稳定公开链接查找                     |
| `surveys`         | `{ ownerId: 1, updatedAt: -1, _id: -1 }`                | 普通复合                                                 | 创建者问卷列表与游标分页             |
| `survey_versions` | `{ surveyId: 1, versionNumber: 1 }`                     | 唯一                                                     | 版本历史倒序扫描和版本号唯一         |
| `survey_versions` | `{ surveyId: 1, status: 1 }`                            | 部分唯一，`partialFilterExpression: { status: "draft" }` | 每份问卷最多一个草稿                 |
| `fill_sessions`   | `{ sessionTokenHash: 1 }`                               | 唯一                                                     | 填写 Cookie 的不可逆令牌查找         |
| `fill_sessions`   | `{ surveyId: 1, ownerKey: 1, activeSlot: 1 }`           | 部分唯一，仅 `status: active`                            | 并发限制每账号每问卷最多五个活动槽位 |
| `fill_sessions`   | `{ surveyId: 1, ownerKey: 1, status: 1, expiresAt: 1 }` | 普通复合                                                 | 活动会话查询和惰性释放过期槽位       |
| `fill_sessions`   | `{ purgeAt: 1 }`                                        | TTL，`expireAfterSeconds: 0`                             | 到达清理时间后物理删除会话           |
| `responses`       | `{ fillSessionId: 1 }`                                  | 唯一                                                     | 同一会话提交幂等性                   |
| `responses`       | `{ surveyVersionId: 1, dedupKey: 1 }`                   | 部分唯一，仅字符串 `dedupKey`                            | 禁止重复时每账号每版本一次           |
| `responses`       | `{ surveyVersionId: 1, submittedAt: -1, _id: -1 }`      | 普通复合                                                 | 版本统计隔离、文本回答和实名提交分页 |

直接证据包括：

- `survey-indexes.test.ts` 的 `declares public, list, version and single-draft indexes`；
- `fill-session.integration.test.ts` 的 `creates every required session index with the active-only slot guard`；
- `response-submission.integration.test.ts` 的 `creates all permanent response indexes`；
- `MILESTONE6_EXPLAIN.md`、`MILESTONE9_STATISTICS_EXPLAIN.md` 和 `MILESTONE10_SURVEY_LIST_EXPLAIN.md`。

## 5. 事务与并发事实

代码中使用 `withTransaction` 的主要业务包括：创建问卷与 v1 草稿、保存草稿并同步问卷更新时间、发布版本、创建下一版本草稿、放弃下一版本草稿、修改题目或跳转并同步问卷更新时间，以及正式提交回答。

关键并发保护不是“事务里先查一次”本身，而是事务、条件更新与唯一索引共同工作：

- 草稿写入条件包含 `_id + surveyId + status: draft + revision`，成功后 `$inc revision`；
- 发布同时条件更新版本状态和 `surveys.draftVersionId`；
- 创建草稿同时依赖问卷指针条件和单草稿部分唯一索引；
- 提交先条件更新活动会话，再插入回答；同会话唯一索引和版本去重部分唯一索引负责最终兜底；
- `withTransaction` 可重试瞬时事务错误，回调中的时间和读取必须按实现约定重新取得。

对应集成测试覆盖事务中途失败回滚、相同 revision 并发、发布与编辑竞争、并发创建草稿、发布与放弃竞争、同会话并发提交和两个会话竞争去重索引。

## 6. 聚合与执行计划事实

- 版本历史：沿 `{ surveyId, versionNumber }` 索引反向扫描，两份种子版本只检查 2 个键和 2 份文档，无阻塞排序。
- 问卷列表：10,000 份固定数据中，首屏和中点游标页均只检查 21 个键和 21 份文档；游标页使用两个索引范围的 `SORT_MERGE`，不是阻塞 `SORT`。
- 回答统计：50,000 份固定随机数据中，总数使用 `COUNT_SCAN`；其他聚合用版本索引隔离后读取该版本全部回答。2026-10-21 的三次独立运行中，选择题管道最重；文本第一页每次扫描 33 份文档返回内部 21 条结果。
- 生产统计在同一 `readConcern: snapshot` 事务中运行五条职责单一的管道。没有采用单个 `$facet`，避免其每阶段 100 MB、不能落盘以及最终 16 MiB BSON 文档限制集中到一个结果中；`explain` 在事务外对相同生产管道执行。

### 6.1 统计性能复测条件与结果

测量日期为 2026-10-21。主机是 Apple M2 八核、16 GB 内存的 MacBook Air；Docker Desktop 报告分配 8 CPU、8,319,770,624 字节内存，MongoDB 镜像为 8.0.34。每次运行都先删除该脚本的旧基准文档，再用固定种子 20261020 重建 50,000 份回答，因此下面三行是独立运行，不是对同一热缓存查询连续计时。

执行命令：

```bash
STATISTICS_BENCHMARK_URI='mongodb://127.0.0.1:27017/survey_statistics_benchmark?replicaSet=rs0&directConnection=true' \
STATISTICS_BENCHMARK_COUNT=50000 \
STATISTICS_BENCHMARK_SEED=20261020 \
npm run --silent statistics:benchmark --workspace @survey/api
```

|   运行 |  总数 |    到达 |    回答 |    选择 |    数字 | 文本第一页 |
| -----: | ----: | ------: | ------: | ------: | ------: | ---------: |
|      1 |    13 |     138 |     200 |     365 |     227 |          0 |
|      2 |    17 |     179 |     252 |     403 |     237 |          0 |
|      3 |    13 |     142 |     202 |     398 |     281 |          0 |
| 中位数 |    13 |     142 |     202 |     398 |     237 |          0 |
|   范围 | 13–17 | 138–179 | 200–252 | 365–403 | 227–281 |        0–0 |

单位均为 `executionTimeMillis`。三次的总数均检查 50,000 个键、0 份文档；到达、回答、选择和数字均检查 50,000 个键并读取 50,000 份文档；文本第一页均检查并读取 33 份文档。测量结束后执行：

```bash
STATISTICS_BENCHMARK_URI='mongodb://127.0.0.1:27017/survey_statistics_benchmark?replicaSet=rs0&directConnection=true' \
npm run --silent statistics:benchmark:clean --workspace @survey/api
```

## 7. 跳转、校验与后端逻辑事实

### 7.1 共享逻辑

`packages/survey-logic/src/index.ts` 是前后端共享的纯 TypeScript 工作区，当前导出：

- `validateAnswer`：返回规范化值、answered 标记或稳定答案错误码；
- `evaluateNextQuestion`：第一条规则命中优先，否则进入数组下一题；
- `computePath`：从第一题计算实际路径并用 visited 集合阻止死循环；
- `validateForPublish`：检查结构、截止时间、精确图循环、不可达和遮蔽规则；
- `computeSurveyStatus` 与 `computeSessionState`：统一问卷及会话状态优先级。

发布图只有在“必答单选且 equals 规则覆盖全部选项”时移除默认边。图论条件关注目标不晚于来源的规则边；自跳转先作为结构错误报告，其余可达来源上的向后规则由 BFS 返回经过该规则的最短回路。未回答或非规范答案不命中跳转规则，正式提交仍会在真实路径上由 `validateAnswer` 拒绝不合法答案。

### 7.2 题目与答案校验

- 题目与选项文本执行 NFC、trim、Unicode 码点计数，拒绝 Cc 和双向控制符，保留 ZWJ；
- 文本答案执行 NFC 与 trim，digitsOnly 仅接受 ASCII `0-9`；
- 多选答案按版本选项顺序保存，数字 `-0` 规范化为 0；
- 题目 definition 的 validation 保存补全后的规范值，而不是读取时动态套默认值；
- 正式提交先限制外层 JSON 形态，再由服务器重算路径；已知路径外答案忽略业务值，未知题目仍返回 `VALIDATION_ERROR`；
- 路径内问题以 `ANSWER_VALIDATION_FAILED` 一次返回，issue 含 questionId、code、path、message；损坏发布版本使用 `SURVEY_VERSION_INVALID`。

### 7.3 认证与安全

- 密码使用 Node `crypto.scrypt`：N=32768、r=8、p=3、maxmem=64 MiB、16 字节盐、64 字节键，哈希前 NFKC；
- 用户不存在时验证固定参数的预生成假哈希；密码记录参数、编码和长度不符均按失败处理；
- JWT 固定 HS256，含 sub/iat/exp/iss/aud，两小时到期，不刷新；Cookie 名 `survey_session`；
- 填写 Cookie 名 `survey_fill`，Path 为 `/api/public/sessions/{sessionId}`；恢复与提交需要登录和填写双 Cookie；
- `JWT_SECRET` 与 `ANONYMOUS_ID_SECRET` 均至少 32 字符、不能使用示例值且必须不同；
- 状态修改请求及 OPTIONS 校验精确 Origin，有正文接口统一要求 JSON，普通正文上限 256 KiB，正式提交认证后使用 4 MiB 解析器。

### 7.4 生命周期、会话、提交与统计

- 发布事务内重新检查草稿，条件更新版本和问卷指针；已发布版本不可变，下一版本用字段白名单深复制；
- 有效状态顺序为 draft → closed 优先 → expired → published；会话按已提交、显式过期、关闭、绑定版本截止、自身到期判断；
- 每账号每问卷最多五个 activeSlot，过期会话惰性释放，TTL 仅负责七天后删除；
- 已提交会话的重试在关闭和过期判断、4 MiB 正文解析之前返回原 response；新提交先条件更新会话，再插入回答；
- 禁止重复依靠 `{ surveyVersionId, dedupKey }` 部分唯一索引，范围是每版本一次；
- 统计使用 snapshot 事务和五条管道，文本与实名提交游标为 AES-256-GCM；匿名输出不含精确时间、响应 ID 和用户身份。

## 8. 提交最终 Markdown 前必须刷新

- [x] 重新读取 `.nvmrc`、`package-lock.json` 和 Compose 镜像版本；
- [x] 运行 `npm ci`、typecheck、完整测试、build 和 format check；
- [x] 更新测试文件数和断言总数；
- [x] 再次比较 Mongoose `schema.indexes()` 与全新数据库 `listIndexes()`；
- [x] 核对 API 路由和错误码；
- [ ] 核对 Git 提交哈希、工作区状态和最终仓库地址；
- [ ] 扫描报告、日志和截图，确认没有密钥、Cookie、令牌或真实密码。
