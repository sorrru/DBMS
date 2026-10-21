# 需求—测试追踪矩阵

## 使用方式

本矩阵把已确认需求映射到当前可定位的自动测试、实验或人工证据。状态含义：

- **已覆盖**：已有直接自动测试或可重复实验；
- **待补 Pn**：里程碑 10 已确认的证据缺口；
- **待人工**：主要属于端到端交互，需要项目负责人操作并记录；
- **设计边界**：有明确设计说明，但不声称系统实现了范围外能力。

测试名称使用源码中的 `it(...)` 文本，避免行号变化后引用失效。补缺前基线为共享逻辑 11 项、API 140 项、Web 22 项，共 173 项。

## 认证、安全与运行环境

| ID      | 需求行为                                                                    | 自动或实验依据                                                                                                       | 人工依据                     | 状态   |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------ |
| AUTH-01 | 用户名仅允许英文、数字、下划线；查询名规范化，公开名保留                    | `validation.test.ts`：trims and lowercases only the lookup username；`auth.integration.test.ts` 注册与登录场景       | 注册页错误提示               | 已覆盖 |
| AUTH-02 | 并发注册同一规范化用户名只能成功一次                                        | `auth.integration.test.ts`：uses the unique normalized index under concurrent registration                           | 无需重复人工并发             | 已覆盖 |
| AUTH-03 | 密码 NFKC 后以受限参数 scrypt 保存；不存在用户执行假哈希                    | `password.test.ts` 两项；`auth.integration.test.ts`：performs dummy verification for a missing user                  | 无                           | 已覆盖 |
| AUTH-04 | JWT 固定 HS256、2 小时有效；错误算法、密钥、过期或用户删除均失效            | `token.test.ts`；`auth.integration.test.ts`：rejects forged tokens and a valid token whose user was deleted          | 登录过期跳转在历次验收中检查 | 已覆盖 |
| AUTH-05 | 登录 Cookie HttpOnly、SameSite=Lax，生产 Secure；退出不要求 JSON            | `auth.integration.test.ts`：sets Secure、logs out；注册场景检查 Cookie                                               | 登录、退出已人工验收         | 已覆盖 |
| SEC-01  | 非 GET 校验 Origin，带正文接口要求 JSON，畸形和超限正文返回稳定错误         | `auth.integration.test.ts`：missing origin/non-JSON/malformed/oversized；`survey.integration.test.ts`：requires JSON | 无                           | 已覆盖 |
| SEC-02  | 注册、登录、问卷写入、会话、提交和统计均有限流与 Retry-After                | 各集成测试中的 rate limit 场景；`rate-limit.test.ts` 容量和窗口                                                      | 无                           | 已覆盖 |
| ENV-01  | 密钥、端口、规则上限和各限流配置启动时校验                                  | `config.test.ts` 六组配置边界                                                                                        | `.env.example` 人工核对      | 已覆盖 |
| ENV-02  | 健康检查主动 ping，区分 connected/connecting/disconnected/unknown，2 秒超时 | `database-connection.test.ts`；`health.test.ts`                                                                      | 里程碑 1 已人工停启 MongoDB  | 已覆盖 |

## 问卷、草稿与题目

| ID          | 需求行为                                                              | 自动或实验依据                                                                                       | 人工依据               | 状态   |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- | ------ |
| SURVEY-01   | 创建问卷与 v1 草稿为一个事务，默认匿名且交叉引用一致                  | `survey.integration.test.ts`：creates a survey and v1 draft atomically                               | 创建页已人工验收       | 已覆盖 |
| SURVEY-02   | 创建中途失败不留下问卷或孤立版本                                      | 同文件：rolls back when the second transaction insert fails                                          | 无                     | 已覆盖 |
| SURVEY-03   | 管理名称与公开标题分离；草稿 PATCH 只改白名单字段并同步两个 updatedAt | 同文件：renames...；updates only changed draft fields...                                             | 编辑页已人工验收       | 已覆盖 |
| SURVEY-04   | 所有创建者接口按 ownerId 隔离，越权统一 404                           | 同文件：hides another owner's survey；hides every lifecycle endpoint                                 | 无                     | 已覆盖 |
| SURVEY-05   | 问卷数量、写入频率、分页参数和游标均严格限制                          | 同文件：quantity limit、rate limits、pagination/tampered cursor                                      | 列表加载更多已人工检查 | 已覆盖 |
| SURVEY-06   | 列表按 ownerId + updatedAt + _id 使用复合索引稳定分页                 | `survey-indexes.test.ts` 验证索引结构；`MILESTONE10_SURVEY_LIST_EXPLAIN.md` 验证首屏和游标页执行计划 | 无                     | 已覆盖 |
| QUESTION-01 | 四种题型以规范默认值保存，数组顺序是唯一题目顺序                      | `question-validation.test.ts`；`question.integration.test.ts`：adds all types、reorders              | 题目编辑已人工验收     | 已覆盖 |
| QUESTION-02 | 文本按 NFC 和码点计数，拒绝控制/双向字符，保留 ZWJ                    | `survey-validation.test.ts`；`question-validation.test.ts`                                           | 无                     | 已覆盖 |
| QUESTION-03 | 题目、选项和请求体上限明确，最坏单题可保存，第 101 题拒绝             | `question.integration.test.ts`：maximum-size question、99 questions concurrent add                   | 无                     | 已覆盖 |
| QUESTION-04 | questionId/type/jumpRules 不可伪造，外来 optionId 被拒绝              | `question-validation.test.ts`；`question.integration.test.ts`：replaces by whitelist...              | 无                     | 已覆盖 |
| QUESTION-05 | 删除、排序和规则引用保护采用 revision 条件更新                        | `question.integration.test.ts`：reorders and deletes、protects referenced...                         | 编辑锁已人工验收       | 已覆盖 |
| ANSWER-01   | 答案纯函数统一处理必答、类型、ASCII 数字、trim、-0 和选项顺序         | `question-validation.test.ts`；`survey-logic/index.test.ts`                                          | 填写错误定位已人工验收 | 已覆盖 |

## 跳转、发布与版本生命周期

| ID         | 需求行为                                                     | 自动或实验依据                                                                                              | 人工依据               | 状态   |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------- | ------ |
| JUMP-01    | 第一条规则命中优先，未回答或未命中走默认边，最后一题结束     | `survey-logic/index.test.ts`：first matching rule、numeric operators                                        | 跳转填写已人工验收     | 已覆盖 |
| JUMP-02    | 题型与操作符矩阵、自跳转、外来选项、规则上限严格校验         | `jump-validation.test.ts` 全部四项                                                                          | 无                     | 已覆盖 |
| JUMP-03    | 草稿允许回跳但发布阻止循环；精确模型报告不可达和稳定最短回路 | `survey-logic/index.test.ts`：unreachable、backward rule、lazy path enumeration                             | 发布检查结果已人工验收 | 已覆盖 |
| JUMP-04    | 跳转整组保存、数组值规范排序、并发 revision 只允许一个成功   | `question.integration.test.ts`：saves ordered jump rules...                                                 | 跳转编辑器已人工验收   | 已覆盖 |
| PUBLISH-01 | 空问卷、循环、已过截止时间阻止发布；警告需要第二次明确确认   | `survey.integration.test.ts`：blocks empty publication、requires second request、deadline equal now         | 预览与发布已人工验收   | 已覆盖 |
| VERSION-01 | 已发布版本不可被任何草稿写接口修改                           | `question.integration.test.ts`：rejects every draft mutation and publication action for a published version | 已发布只读页已人工查看 | 已覆盖 |
| VERSION-02 | 发布同时更新版本状态与问卷指针，失败注入完全回滚             | `survey.integration.test.ts`：rolls back both publish failure points                                        | 无                     | 已覆盖 |
| VERSION-03 | 下一版本深复制且每问卷最多一个草稿；并发创建仅一个成功       | 同文件：publishes v1...、partial unique single-draft index、serializes concurrent...                        | 版本历史已人工验收     | 已覆盖 |
| VERSION-04 | 关闭优先于到期；重开不绕过截止时间；状态修改幂等             | `survey-logic/index.test.ts` 状态优先级；`survey.integration.test.ts` lifecycle/status                      | 关闭与重开已人工验收   | 已覆盖 |
| VERSION-05 | 版本历史用版本号索引反向扫描，不读取完整 questions 后计数    | `MILESTONE6_EXPLAIN.md`；版本列表批量查询测试                                                               | 版本历史已人工验收     | 已覆盖 |

## 填写会话、匿名与正式提交

| ID        | 需求行为                                                                       | 自动或实验依据                                                                                                                             | 人工依据                   | 状态   |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------ |
| FILL-01   | 未登录可看 no-store 公开摘要；草稿、关闭和到期状态正确                         | `fill-session.integration.test.ts`：is public...；hides drafts...                                                                          | 公开填写页已人工验收       | 已覆盖 |
| FILL-02   | 创建会话必须登录，匿名会话不存 userId，实名会话保存 userId，登录 Cookie 不刷新 | 同文件：creates an anonymous session...；stores userId only...                                                                             | 身份提示已人工验收         | 已覆盖 |
| FILL-03   | ownerKey 同一问卷跨版本稳定、不同问卷不同，且不向创建者/填写者泄露             | 跨版本稳定由 `response-submission.integration.test.ts` 断言；`fill-session.integration.test.ts`：derives a different anonymous ownerKey... | 匿名数据库结构已人工检查   | 已覆盖 |
| FILL-04   | 恢复会话需要登录 Cookie 与动态 Path 填写 Cookie，换账号统一 404                | `fill-session.integration.test.ts`：requires both cookies...                                                                               | 退出后同账号恢复已人工验收 | 已覆盖 |
| FILL-05   | 每账号每问卷最多五个未过期活动会话；过期会话惰性释放槽位                       | 五会话并发上限测试；`fill-session.integration.test.ts`：releases expired active slots...                                                   | 无                         | 已覆盖 |
| FILL-06   | 旧会话固定旧版本并使用旧版本截止时间，不受新版本放宽影响                       | 同文件：uses the bound old-version deadline...；共享逻辑 session state 测试                                                                | 无                         | 已覆盖 |
| FILL-07   | 本地草稿不含凭据，按会话与版本隔离，恢复时丢弃未知/非法答案                    | `auth.test.ts` safe draft；`fill.test.ts` known valid answers/session key                                                                  | 刷新恢复已人工验收         | 已覆盖 |
| SUBMIT-01 | 提交先认证和所有权，再读取独立 4 MiB 正文                                      | `response-submission.integration.test.ts`：authenticates before...、4 MiB limit                                                            | 无                         | 已覆盖 |
| SUBMIT-02 | 服务端重算真实路径，只校验路径内答案，路径外已知答案忽略                       | 同文件：stores canonical path、ignores business-invalid off-path                                                                           | 复核页已人工验收           | 已覆盖 |
| SUBMIT-03 | 回答错误一次返回稳定、按路径排序的 issues                                      | 同文件：returns stable path-ordered validation issues                                                                                      | 第一错误题定位已人工验收   | 已覆盖 |
| SUBMIT-04 | 事务先占会话再插入回答，两处失败完全回滚                                       | 同文件参数化 fully rolls back...                                                                                                           | 无                         | 已覆盖 |
| SUBMIT-05 | 同会话重试幂等；关闭、截止或会话到期后仍返回原 submission                      | 同文件：returns original submission...、concurrent same-session retries                                                                    | 成功页已人工验收           | 已覆盖 |
| SUBMIT-06 | 禁止重复按版本 + ownerKey 唯一；允许重复可多次；不同版本分别一次               | 同文件：prevents new session、allows repeats、same ownerKey each version、dedup race                                                       | 重复开关已人工验收         | 已覆盖 |
| SUBMIT-07 | 匿名回答不保存 respondentId；实名回答保存账号；内部键不出 API                  | 提交与填写集成测试直接检查数据库和响应白名单                                                                                               | 匿名数据库记录已人工检查   | 已覆盖 |

## 统计、实验与前端

| ID          | 需求行为                                                                 | 自动或实验依据                                                                                        | 人工依据                                                          | 状态   |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| STATS-01    | 统计只开放给创建者和已发布版本，草稿 409、越权 404、响应 no-store        | `statistics.integration.test.ts`：rejects drafts...、hand-checkable aggregates                        | 已发布统计页已人工验收                                            | 已覆盖 |
| STATS-02    | reached/answered/notReached/unanswered、选择和数字指标可手算且满足不变量 | 同文件：hand-checkable aggregates、null number extrema                                                | `MILESTONE10_SEED_VERIFICATION.md` 给出匿名 3 份、实名 2 份手算表 | 已覆盖 |
| STATS-03    | 五条管道在同一 snapshot 事务，期间新增回答不破坏一致性                   | 同文件：keeps all pipelines on one snapshot                                                           | `MILESTONE9_STATISTICS_EXPLAIN.md`                                | 已覆盖 |
| STATS-04    | 文本分页沿版本时间索引，实名用户一次批量查询，匿名只显示 UTC 日期        | 同文件匿名/实名分页；`MILESTONE9_STATISTICS_EXPLAIN.md`                                               | 实名文本页已人工查看                                              | 已覆盖 |
| STATS-05    | 匿名游标 AES-256-GCM 加密、绑定查询并拒绝篡改，不泄露时间和 ObjectId     | `statistics-cursor.test.ts`；统计集成递归泄露扫描                                                     | 无                                                                | 已覆盖 |
| STATS-06    | 不同 surveyVersionId 的统计和文本回答绝不混合                            | `statistics.integration.test.ts`：keeps totals, options, and text responses isolated between versions | 无                                                                | 已覆盖 |
| STATS-07    | 实名版本逐次列出全部提交账号，不依赖文本作答；匿名版本不开放身份列表     | `statistics.integration.test.ts`：lists every identified submission...、never exposes...              | 实名 v2 与匿名 v1 页面均已人工确认                                | 已覆盖 |
| FRONTEND-01 | 已发布内容只读可见；草稿检查后可预览；导航可定位题目、跳转、发布和统计   | `PublishedVersionView.test.ts`；前端请求测试                                                          | 历次界面检查，包括半屏、按钮与统计                                | 已覆盖 |
| FRONTEND-02 | 截止时间分栏输入、时区、错误就地展示；密码可见按钮                       | `deadline.test.ts`；界面人工检查                                                                      | 已人工验收                                                        | 已覆盖 |
| SEED-01     | 种子覆盖多版本、四题型、分支、匿名/实名回答、关闭、到期和旧会话          | `seed.ts`；`MILESTONE10_SEED_VERIFICATION.md` 的固定数据关系与手算表                                  | 演示数据已恢复，待最终人工验收                                    | 已覆盖 |
| SEED-02     | seed 可重复、clean 完整且幂等，并拒绝危险数据库                          | 本地 URI 保护测试；2026-10-20 实际两次 seed、两次 clean 的集合计数                                    | `MILESTONE10_SEED_VERIFICATION.md`                                | 已覆盖 |
| BUILD-01    | 从依赖安装到共享包、API、Web 构建顺序可重复                              | `MILESTONE10_TEST_REPORT.md`：npm ci、typecheck、177 项测试、生产构建、格式与忽略规则实测             | 无                                                                | 已覆盖 |

## 已确认不在第一阶段实现的边界

| ID       | 边界                         | 处理                                                                 |
| -------- | ---------------------------- | -------------------------------------------------------------------- |
| LIMIT-01 | 删除整份问卷、归档问卷       | 第一阶段不提供；种子脚本只清理自身测试数据                           |
| LIMIT-02 | 登录令牌刷新和服务端撤销     | 固定 2 小时，不滑动续期；重新登录后凭仍有效填写 Cookie 恢复          |
| LIMIT-03 | 密钥轮换后保持 ownerKey 可用 | 第一阶段明确禁止轮换 `ANONYMOUS_ID_SECRET`，否则历史所有权和去重失效 |
| LIMIT-04 | 匿名达到不可重新识别         | 定义为创建者不可见的假名化；运维持有密钥仍有重新识别能力             |
| LIMIT-05 | 多实例共享限流               | 当前进程内存限流；生产多实例需替换为 Redis 等共享存储                |

## 人工端到端验收待办

最终人工验收分四组，详细步骤将在自动补缺和种子验证完成后写入测试报告：

1. 注册、登录、退出和错误输入；
2. 创建问卷、四题型、跳转、发布和下一版本；
3. 匿名/实名填写、重复限制、关闭和截止；
4. 历史版本、版本统计、文本回答和匿名信息边界。
