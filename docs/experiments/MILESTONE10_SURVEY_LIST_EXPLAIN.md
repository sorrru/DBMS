# 里程碑 10：问卷列表分页执行计划

## 实验目标与数据

本实验验证创建者问卷列表的首屏和游标翻页查询，是否由 MongoDB 优化器自行选择 `{ ownerId: 1, updatedAt: -1, _id: -1 }` 复合索引，并避免阻塞排序。生成脚本为 `apps/api/src/scripts/survey-list-benchmark.ts`。

- MongoDB：8.0.34，Docker 单节点副本集；
- 问卷数：10,000；
- 数据库：专用本地 `survey_list_benchmark`；
- 每 5 份问卷使用相同 `updatedAt`，用于覆盖 `_id` 次级排序；
- 页面内部取 21 条，即向用户返回 20 条并多取一条判断下一页；
- 游标位于数据中点；
- 查询没有使用 `hint`，执行计划由优化器自行选择。

脚本拒绝生产环境、`mongodb+srv`、非本地主机和不以 `_benchmark` 结尾的数据库名。运行命令：

```bash
SURVEY_LIST_BENCHMARK_URI='mongodb://127.0.0.1:27017/survey_list_benchmark?replicaSet=rs0&directConnection=true' \
SURVEY_LIST_BENCHMARK_COUNT=10000 \
npm run survey-list:benchmark --workspace @survey/api
```

实验结束后运行 `survey-list:benchmark:clean`，实际清理成功。

## 查询形态

首屏按所有者匹配，再以 `updatedAt`、`_id` 倒序并限制 21 条。游标页沿用生产服务的严格字典序范围：

```text
ownerId = 当前用户
AND (
  updatedAt < cursor.updatedAt
  OR (updatedAt = cursor.updatedAt AND _id < cursor.id)
)
ORDER BY updatedAt DESC, _id DESC
LIMIT 21
```

## 实测结果

| 查询   | winningPlan                               | 索引                             | keys examined | docs examined | returned | execution ms |
| ------ | ----------------------------------------- | -------------------------------- | ------------: | ------------: | -------: | -----------: |
| 首屏   | `IXSCAN → FETCH → LIMIT`                  | `ownerId_1_updatedAt_-1__id_-1`  |            21 |            21 |       21 |            0 |
| 游标页 | `2 × IXSCAN → SORT_MERGE → FETCH → LIMIT` | 两个分支均使用同一三字段复合索引 |            21 |            21 |       21 |            0 |

首屏直接沿复合索引顺序读取。游标页的 `$or` 被拆成两个互斥索引范围，再由 `SORT_MERGE` 合并两个已经有序的索引流；它不是需要缓存全部候选记录的阻塞 `SORT`。执行计划中带阻塞 `SORT` 的候选方案被拒绝，最终计划只检查并读取页面需要的 21 条记录。

因此，`ownerId` 隔离、`updatedAt` 主排序和 `_id` 稳定次级排序都由同一个索引覆盖；即使多条记录具有相同更新时间，游标也能保持严格顺序。

## 索引证据总览

| 里程碑 | 查询                                | 证据文档                           |
| ------ | ----------------------------------- | ---------------------------------- |
| 6      | 版本历史按 `versionNumber` 反向扫描 | `MILESTONE6_EXPLAIN.md`            |
| 9      | 按版本统计聚合与文本回答时间分页    | `MILESTONE9_STATISTICS_EXPLAIN.md` |
| 10     | 创建者问卷列表首屏与复合游标分页    | 本文                               |
