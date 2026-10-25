# 第二阶段提交材料索引与检查清单

日期：2026-10-25。用户已授权将两阶段统一提交到 https://github.com/sorrru/DBMS 。`stage1-final` 固定第一阶段 `90c2504`；`stage2-final` 固定第二阶段交付，`main` 为第二阶段完整系统。里程碑 0–6 已通过人工检查，本文件列出第二阶段提交范围。

## 1. 报告与说明

| 材料                               | 路径                                                                                                    | 状态                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 第二阶段完整项目报告（当前主报告） | [PROJECT_REPORT_STAGE2.md](PROJECT_REPORT_STAGE2.md)                                                    | 已按总要求精简为 12 章，纳入本次提交   |
| 完整系统说明                       | [SYSTEM_DESIGN_STAGE2.md](SYSTEM_DESIGN_STAGE2.md)                                                      | 当前模块、权限、流程及运行边界         |
| 完整数据库设计                     | [DATABASE_DESIGN.md](DATABASE_DESIGN.md)                                                                | 13 集合字段、23 二级索引、事务与选型   |
| API 与关键逻辑                     | [API.md](API.md)、[STAGE2_DESIGN.md](STAGE2_DESIGN.md)                                                  | 原有及新增接口、状态、事务、兼容与统计 |
| 需求解释与设计冲击                 | [STAGE2_REQUIREMENTS.md](STAGE2_REQUIREMENTS.md)                                                        | R1–R8、歧义解释与不推倒重做说明        |
| 配置、启动及入口                   | [README.md](../README.md)、[.env.example](../.env.example)、[docker-compose.yml](../docker-compose.yml) | 可从零运行；真实密钥须本地填写         |
| 维护与隔离演示                     | [STAGE2_OPERATIONS.md](STAGE2_OPERATIONS.md)                                                            | 默认只读审计，定向修复及独立演示       |
| 事实底稿                           | [REPORT_FACT_CHECK_STAGE2.md](REPORT_FACT_CHECK_STAGE2.md)                                              | 本轮测试、环境与实际索引               |
| AI 使用日志及说明                  | [AI_USAGE_LOG.md](AI_USAGE_LOG.md)、主报告第 10–11 章                                                   | 真实目标、产出、人工修改、失败与验证   |

第一阶段材料以 `stage1-final` 内版本为准，不把旧 DOCX 误作为第二阶段主报告。第二阶段当前主报告为 Markdown，同时包含工作区已有的 [Word](PROJECT_REPORT_STAGE2.docx) 和 [PDF](PROJECT_REPORT_STAGE2.pdf)；本轮上传不重新生成或声称重新渲染这两个文件。第一阶段原 Word 的本地既有修改不并入第二阶段提交，历史提交中的文件仍保留。

## 2. 代码与 schema

| 部分           | 范围                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 后端与数据模型 | apps/api/src，含 models、auth/security、surveys、fills、statistics、library、banks、library-statistics、maintenance 和 scripts |
| 前端           | apps/web/src，包括原问卷/填写及新增题目、题库、跨问卷统计和字段提示                                                            |
| 共享业务规则   | packages/survey-logic/src                                                                                                      |
| 自动测试       | apps/api/test、apps/web/src 下 *.test.ts、共享包测试                                                                           |
| 可复现依赖     | package.json、package-lock.json、工作区 package.json、.nvmrc、tsconfig 与 Vite/Vitest 配置                                     |
| 数据库启动     | docker-compose.yml、docker/init-replica-set.sh                                                                                 |

第二阶段新目录和测试均纳入提交。下载完整第二阶段源码应选择 `stage2-final` 标签或本次交付的 `main`，不能导出第一阶段旧提交充当第二阶段。未另行制作源码压缩包。

## 3. 测试与实验证据

- [需求测试矩阵](experiments/STAGE2_REQUIREMENT_TEST_MATRIX.md)：R1–R8、旧功能、权限、并发与兼容的用例对应。
- [第一阶段干净基线](experiments/STAGE1_BASELINE_20261022.md)：184 项复跑。
- [D8 比较](experiments/STAGE2_D8_COMPARISON.md)及[原始 JSON](experiments/STAGE2_D8_RESULTS.json)：反向引用取舍。
- [跨问卷 explain](experiments/STAGE2_STATISTICS_EXPLAIN.json)：实际回答索引过滤及手算核对。
- [里程碑 1](experiments/STAGE2_MILESTONE1_TEST_REPORT.md)、[2](experiments/STAGE2_MILESTONE2_TEST_REPORT.md)、[3](experiments/STAGE2_MILESTONE3_TEST_REPORT.md)、[4](experiments/STAGE2_MILESTONE4_TEST_REPORT.md)、[5](experiments/STAGE2_MILESTONE5_TEST_REPORT.md)、[6](experiments/STAGE2_MILESTONE6_TEST_REPORT.md)：输入、步骤、预期、结果与人工清单。
- [CLI 输出](experiments/STAGE2_MILESTONE6_CLI_RESULTS.json)及[清理计数](experiments/STAGE2_MILESTONE6_CLEANUP.json)：独立演示的真实执行。
- [本轮索引事实](experiments/STAGE2_REPORT_FACTS.json)及[最终检查记录](experiments/STAGE2_FINAL_VERIFICATION.md)：当前 schema、测试及文档检查。

## 4. 交付前确认

- [x] 保留第一阶段代码和主要功能，提供独立基线与兼容回归。
- [x] 增量实现八项需求，不按标题迁移旧回答。
- [x] 第二阶段完整报告覆盖项目目标、系统、数据库、跳转、校验、AI、测试及问题解决。
- [x] 配套 schema、API、关键逻辑、配置与运行步骤齐全。
- [x] 测试说明含输入、步骤、预期、实际结果及原始证据。
- [x] 当前源码和可审阅文档已整理，现有 DOCX 保留。
- [x] 用户明确授权提交到原仓库，并要求区分两个阶段。
- [x] 工作区已有第二阶段 Word/PDF 随报告提交，本轮未重新生成。
- [x] 上传前完整 301 项回归、类型检查和生产构建通过。
- [x] 提交范围排除真实配置、密钥、依赖与构建目录。

Git 上传与远端标签核验见本次交付记录和 GitHub 分支/标签。

## 5. 不应放入公开交付物的内容

真实 .env、Cookie、密钥、密码、node_modules、临时调试文件、开发数据库卷及真实用户回答不进入源码材料。dist 可由构建生成；原始实验 JSON 是专用合成数据证据，可以随报告提交。报告没有嵌入真实 seed 密码，也没有把用户现有账号当作可随意重置的演示账号。
