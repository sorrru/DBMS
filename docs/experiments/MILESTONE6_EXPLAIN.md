# 里程碑 6：版本历史查询执行计划

记录日期：2026-10-19

## 查询形态

对种子账号的一份包含 v1 与 v2 的问卷运行：

```javascript
db.survey_versions.explain("executionStats").aggregate([
  { $match: { surveyId } },
  { $sort: { versionNumber: -1 } },
  { $limit: 21 },
  {
    $project: {
      versionNumber: 1,
      questionCount: { $size: "$questions" },
    },
  },
]);
```

真实 ObjectId 已从记录中移除。运行环境为 MongoDB 8.0.34 单节点副本集。

## 关键结果

| 项目             | 结果                                |
| ---------------- | ----------------------------------- |
| 扫描阶段         | `IXSCAN`                            |
| 索引             | `surveyId_1_versionNumber_1`        |
| 键模式           | `{ surveyId: 1, versionNumber: 1 }` |
| 扫描方向         | `backward`                          |
| 返回文档         | 2                                   |
| 扫描索引键       | 2                                   |
| 扫描文档         | 2                                   |
| 是否存在阻塞排序 | 否                                  |

`$match`、倒序 `$sort` 和 `$limit` 被合并到游标计划中，MongoDB 对升序复合索引执行反向扫描，因此不需要额外的内存排序阶段。`$project` 在数据库端通过 `$size` 计算题目数，API 不会读取最坏约 4 MiB 的完整题目数组后再计数。

本次种子数据只有两个版本，所以 `totalKeysExamined` 与 `totalDocsExamined` 都等于返回数。该证据证明查询形态能使用目标索引；更大数据量的扫描比例在里程碑 9 的统计实验中继续补充。
