# 第二阶段需求—实现—测试追踪矩阵

日期：2026-10-23。第一阶段基线 `90c2504` 的 184 项复跑见 STAGE1_BASELINE_20261022.md；本表按最终代码和真实自动检查建立，不把前端人工检查替换为自动测试通过。

| 需求                            | 已实现行为及主要入口                                                                | 自动测试文件（apps/api/test，除特别说明）                                            | 人工证据或待验收                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| R1 保存及复用题目               | LibraryService.create；保存本地题；复制定义并保留来源；同题多实例独立 ID            | library.integration、library-adoption.integration                                    | 里程碑 1、2 已通过                                                                    |
| R2 共享同一题目给他人           | 版本级批量授权；接收列表、采用、另存；撤销不追溯，第三人不可访问                    | library-sharing.integration；Web LibraryAccessPanel.test                             | 里程碑 3 已通过；默认共享当前版本为人工确认的简化交互                                 |
| R3 修改不影响旧问卷并生成新题目 | 使用后永久冻结；创建版本及所有者/接收者另存；原快照保持                             | library.integration、library-adoption.integration、stage2-demo.integration           | 里程碑 1–3 已通过；完整链路本轮再核对                                                 |
| R4 修改历史及恢复               | 当前版本优先，历史主动展开；恢复新版本含来源，不覆盖旧历史                          | library.integration；Web library.test                                                | 人工已确认简化界面及恢复保留                                                          |
| R5 多版本同时使用               | 显式采用不同版本；问卷实例映射与内容修订校验                                        | library-adoption.integration、library-statistics.integration                         | 里程碑 2、5 已通过                                                                    |
| R6 使用查询及可选新版本修改     | 使用前可原地改、使用后新版本；自己明细、他人脱敏汇总                                | library.integration、library-sharing.integration；维护 maintenance.integration       | 里程碑 1、3 已通过；本轮核对工具需人工审阅                                            |
| R7 题库分类与版本更新           | 多库、latest/pinned、显式更新、撤销后不可用，不自动更新问卷                         | banks.integration；Web banks.test；stage2-demo.integration                           | 里程碑 4 已通过                                                                       |
| R8 跨问卷总体统计               | 自己全部已发布历史快照；默认分版本；确认后合并；稳定选项 ID；数字条件分桶；文本分页 | library-statistics.integration；Web library-statistics.test；stage2-demo.integration | 里程碑 5 已通过；本轮演示教师年龄 count=3/sum=108/avg=36，接收者仅自己 count=1/sum=88 |

## 第一阶段及非功能回归

| 范围                                                       | 自动检查                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 账号、密码、Cookie、令牌、Origin、JSON 与限流              | auth.integration、password、token、validation、rate-limit、config                                  |
| 旧数据无 source/schemaVersion=1 不重写；旧回答按原统计读取 | stage2-demo.integration、maintenance.integration；原 survey/question/statistics 集成               |
| 跳转、默认边、路径、循环、不达、输入校验                   | 共享逻辑 11 项；jump-validation、question-validation、question.integration、Web 原测试             |
| 发布、下一草稿、冻结与并发回滚                             | survey.integration、library-adoption.integration、library.integration                              |
| 填写会话、恢复、截止与提交幂等                             | fill-session.integration、response-submission.integration；演示使用真实 FillService.create/submit  |
| 匿名字段、统计分母及匿名分页                               | statistics.integration、statistics-cursor、library-statistics.integration                          |
| 测试数据隔离与清理                                         | database-safety、local-safety、clean-stage2.ts；maintenance.integration 检查 13 集合清理且拒绝异库 |
| 使用投影损坏、过期计划、定向修复及竞争                     | maintenance.integration；不修改版本定义、回答或冻结标记                                            |
| 演示幂等、账号冲突、外部依赖保护、旧 seed 安全             | stage2-demo.integration；默认不覆盖账号、不重建已有演示                                            |
| 表单校验提示位置                                           | Web LibraryView.test：字段提示、无顶部重复、自动定位、服务错误保留                                 |

本文中的文件名省略 .test.ts 或 .integration.test.ts 后缀。最终实际计数及本轮验收表见 STAGE2_MILESTONE6_TEST_REPORT.md。最终系统报告和提交物审阅留在里程碑 7。
