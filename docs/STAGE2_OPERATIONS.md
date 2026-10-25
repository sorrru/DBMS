# 第二阶段维护与隔离演示

适用本地开发，禁止生产环境和远程 MongoDB。工具读取现有 `.env`；不新增必填运行变量。维护命令不通过公开 HTTP 暴露，也不改变应用账号权限。完整需求与测试对照见 experiments/STAGE2_REQUIREMENT_TEST_MATRIX.md。

## 原有数据保护

原五集合与所有无 source 的第一阶段快照保持兼容。无来源题目不按标题认领历史回答。使用投影核对以真实问卷和版本快照为准，不用当前引用数量解除冻结，不通过修复脚本重写定义或回答。

原 `npm run seed` / `seed:clean` 仍属于第一阶段重建工具；新增预检发现原种子账号已有第二阶段题目、题库、共享、来源或 usages 时会拒绝清理，保留现有资料。原 seed 仍有其既有的重建行为，维护期间应停止应用写入；不要拿它来准备第二阶段验收。

## 隔离的第二阶段演示

先打开 Docker Desktop，然后在项目根目录执行：

```bash
docker compose up -d
read -s "SEED_USER_PASSWORD?输入演示密码（至少10位，含英文字母和数字）: "
export SEED_USER_PASSWORD
npm run seed:stage2 --workspace @survey/api
unset SEED_USER_PASSWORD
npm run dev
```

上面的 read 为 macOS 默认 zsh 语法，输入隐藏。三个新账号 stage2_teacher、stage2_student、stage2_outsider 使用本次输入的相同密码；密码只存哈希，不打印、不写入报告或内置在代码里。原 seed_demo / seed_guest_a / seed_guest_b 不受影响。

默认命令仅在无演示 manifest 时创建；已有 ready 演示则验证当前结果，不重置账号或手工改动。占用同名账号但无 manifest 时拒绝接管；上次生成中断为 building 时拒绝自动覆盖，需人工检查。manifest 保存三个演示账号 ID 和状态，清理按这些 ID 的资源范围执行，不按用户名猜测归属。

初始数据：3 个账号、4 份问卷、5 个独立题目身份、3 个题库；包括四题型、年龄 v1/v2/恢复出的 v3、同题重复实例草稿、接收者独立问卷和另存题、跟随最新与固定历史、共享已撤销但快照保留。正式回答经原 FillService.create/submit 生成，不直接伪造回答或填写会话。

初始手算：教师年龄 v1 回答 18、30，v2 回答 60，合并 count=3、sum=108、average=36；学生自己问卷年龄为 88，教师看不到此回答。恢复后的 v3 尚未用于发布问卷，因此不出现在统计来源。学生题库中的已撤销文本题显示不可用，但下一草稿保留原快照。

以下命令会删除这三个独立演示账号及它们创建的资料，仅在确认这些演示资料可以丢弃时使用：

```bash
npm run seed:stage2 --workspace @survey/api -- --clean --confirm-demo-data
```

重建用 `--reset --confirm-demo-data`，并先设置合法 SEED_USER_PASSWORD；密码在删除前校验。若发现非演示账号使用、复制、获授权或分类了演示题目，会拒绝全部清理。清理在同一事务内完成，默认不能全库删数据。重复清理返回 removed=false。此轮只在独立 `_test` 库验证过创建、重复运行、显式 reset、只读核对及两次清理；没有自动在开发库运行这些演示命令。

## 使用记录只读核对

全量检查会逐问卷打印数量、planHash 和异常标识，不打印回答、标题、用户名、密码或密钥：

```bash
npm run library:usage-audit --workspace @survey/api -- --all
```

定向检查（把示例替换为真实 24 位 ID）：

```bash
npm run library:usage-audit --workspace @survey/api -- --ownerId OWNER_ID --surveyId SURVEY_ID
```

返回 expectedCount、actualCount、missing、changed、extra、blockers、clean 和 planHash。快照引用的库版本缺失、未冻结、内容修订不符、定义或映射不一致时列为 blocker，不凭空重建题目。不存在问卷的孤立 usages 只报告，不自动清理。

## 有条件的定向修复

先阅读检查结果，确认问卷与 ownerId；再带上同次检查返回的完整 planHash：

```bash
npm run library:usage-audit --workspace @survey/api -- --ownerId OWNER_ID --surveyId SURVEY_ID --apply --planHash PLAN_HASH
```

只修复指定问卷的投影；不提供全库自动修复。哈希绑定真实快照修订、预期及现有投影和 blocker；发生变化会拒绝并要求重查。blocker 不为空也拒绝写入。

在 snapshot 事务内，修复写指定问卷的 updatedAt，与原所有选题、发布、复制、放弃草稿的父问卷写入竞争，再替换该问卷 usages。因而修复会更新问卷最近修改时间，可能影响列表排序；不改任何问卷版本定义、版本 revision、回答、题目冻结或共享。已 clean 的问卷不写 updatedAt。若修改在修复读取后提交，事务重试会重新计算校验值并拒绝过期计划。失败会回滚整次投影替换。修复成功后再只读检查一次。

## 测试与证据

`npm test` 的数据库用例固定连接本地 survey_stage1_test。新增统一清理辅助明确列出业务 12 集合与演示 manifest，共 13 个集合，并同时校验 NODE_ENV=test、URI、本地允许主机、数据库 `_test` 后缀和当前连接名称；不接受声明一个测试库却清理另一个连接。

本轮命令行演示只使用 survey_stage2_m6_cli_test。真实输出见 experiments/STAGE2_MILESTONE6_CLI_RESULTS.json；两库 13 个集合的只读清理后计数见 experiments/STAGE2_MILESTONE6_CLEANUP.json。演示凭据随机生成且未记录。
