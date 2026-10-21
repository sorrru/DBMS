# 里程碑 9：统计聚合与文本分页执行计划

## 实验目标与数据

本实验验证生产统计服务实际使用的五条聚合管道和文本分页管道。生成脚本为 `apps/api/src/scripts/statistics-benchmark.ts`，它直接导入生产代码中的管道构造器，避免实验管道与实现偏离。

- MongoDB：8.0.34，Docker 单节点副本集；
- 主机：Apple M2 八核、16 GB 内存的 MacBook Air；
- Docker Desktop：8 CPU、8,319,770,624 字节内存；
- 回答数：50,000；
- 固定随机种子：20,261,020；
- 数据库：专用本地 `survey_statistics_benchmark`；
- 题型：单选、多选、数字、文本各一题；
- 文本题到达概率：约 70%；
- 索引：`{ surveyVersionId: 1, submittedAt: -1, _id: -1 }`。

脚本拒绝生产环境、`mongodb+srv`、非本地主机和不以 `_benchmark` 结尾的数据库名。运行命令：

```bash
STATISTICS_BENCHMARK_URI='mongodb://127.0.0.1:27017/survey_statistics_benchmark?replicaSet=rs0&directConnection=true' \
STATISTICS_BENCHMARK_COUNT=50000 \
STATISTICS_BENCHMARK_SEED=20261020 \
npm run statistics:benchmark --workspace @survey/api
```

三次测量完成后清理专用基准数据：

```bash
STATISTICS_BENCHMARK_URI='mongodb://127.0.0.1:27017/survey_statistics_benchmark?replicaSet=rs0&directConnection=true' \
npm run statistics:benchmark:clean --workspace @survey/api
```

## 小型手算数据

集成测试另外使用三份固定回答：三人都到达单选题；两人选 A、一人选 B；两人到达并回答文本题；多人选择 X 两次、Y 一次；数字答案为 1 和 3。预期总提交数为 3，单选 A/B 为 2/1，文本到达和回答均为 2、未到达为 1，数字 count=2、average=2、minimum=1、maximum=3。测试逐项断言这些值，并覆盖数字无数据时三个结果为 null。

## 管道步骤

五条统计管道都先按 `surveyVersionId` 匹配，并尽早只投影后续需要的 `questionPath` 或 `answers`：

1. 总数：匹配后 `$count`；
2. 到达数：投影路径、展开路径、按题目分组；
3. 回答数：投影答案、展开答案、按题目分组；
4. 选择数：展开答案、只保留选择题、把单选标量包装成单元素数组、展开选项、按题目和选项分组；
5. 数字摘要：展开答案、只保留数字题，再计算 count、average、minimum、maximum。

生产请求在同一 `readConcern: snapshot` 事务内依次运行它们，并给每条管道传相同 session 和 `maxTimeMS`。`explain("executionStats")` 不能在事务里使用，因此本实验在事务外用相同版本、题目参数和同一批生产管道单独执行。

文本分页的首个 `$match` 同时包含版本、文本题存在性和可选游标范围；随后沿时间索引倒序、取 `limit + 1`，最后才用 `$filter` 与 `$arrayElemAt` 提取目标答案，不先展开整份答案数组。

## 关键结果

原始记录只有一次执行结果。为避免把单次抖动写成固定性能，2026-10-21 使用相同脚本、参数和固定种子重新独立运行三次。每次脚本都先删除自身旧数据并重新插入 50,000 份回答。下表的时间单位为 `executionTimeMillis`。

| 管道       | winningPlan / 索引                                       | keys examined | docs examined | 第 1 次 | 第 2 次 | 第 3 次 | 中位数 | 范围       |
| ---------- | -------------------------------------------------------- | ------------: | ------------: | ------: | ------: | ------: | -----: | ---------- |
| 总提交数   | `COUNT_SCAN` / `surveyVersionId_1_submittedAt_-1__id_-1` |        50,000 |             0 |      13 |      17 |      13 |     13 | 13–17 ms   |
| 到达数     | `IXSCAN → FETCH → PROJECTION` / 同一索引                 |        50,000 |        50,000 |     138 |     179 |     142 |    142 | 138–179 ms |
| 回答数     | `IXSCAN → FETCH → PROJECTION` / 同一索引                 |        50,000 |        50,000 |     200 |     252 |     202 |    202 | 200–252 ms |
| 选择题     | `IXSCAN → FETCH → PROJECTION` / 同一索引                 |        50,000 |        50,000 |     365 |     403 |     398 |    398 | 365–403 ms |
| 数字题     | `IXSCAN → FETCH → PROJECTION` / 同一索引                 |        50,000 |        50,000 |     227 |     237 |     281 |    237 | 227–281 ms |
| 文本第一页 | `IXSCAN → FETCH → LIMIT` / 同一索引                      |            33 |            33 |       0 |       0 |       0 |      0 | 0–0 ms     |

统计汇总必须读取该版本的全部正式回答内容，所以除总数的 `COUNT_SCAN` 外，路径和答案聚合检查 50,000 个键并读取 50,000 份文档是预期行为；索引的作用是先精确隔离版本，而不是消除版本内的全量聚合。选择题还会把 100,000 个选择题答案展开成 125,010 个选项值，因此是本次最重的管道。

文本第一页需要返回 21 个内部结果（页面 20 条加一条判断后续），扫描了 33 个键和文档。这证明排序没有阻塞阶段，并且在低回答率下，索引仍需跳过没有该文本答案的回答；回答率越低，`totalDocsExamined` 相对页面大小越高。

没有采用单个 `$facet`：MongoDB 官方说明每个 facet 阶段的中间结果上限为 100 MB，不能通过 `allowDiskUse` 落盘，最终结果仍受 16 MiB BSON 文档限制。[`$facet` 官方文档](https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/) 同时，聚合在事务内不能包含 `$out`、`$merge` 或 explain，因此执行计划必须像本实验一样在事务外取得。[aggregate 命令文档](https://www.mongodb.com/docs/manual/reference/command/aggregate/)

## 一致性与隐私验证

快照测试在第一条管道完成后从事务外插入第四份回答；当前结果仍保持 submissionCount=3，并满足 `answeredCount ≤ reachedCount ≤ submissionCount`，数据库中下一次请求可看到 4 份。匿名文本接口只返回正文和 UTC 日期；加密游标无法解码为 JSON，也不含精确时间或 ObjectId 明文。匿名页仍会暴露页内相对顺序，小样本的文本内容与数值极值也可能被现实信息重新识别，这是已记录的设计边界。
