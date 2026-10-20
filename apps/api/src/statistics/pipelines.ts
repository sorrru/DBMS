import { Types, type PipelineStage } from "mongoose";

export type StatisticsPipelineName =
  "total" | "reached" | "answered" | "selections" | "numbers";

export function buildStatisticsPipelines(
  versionId: Types.ObjectId,
  selectionQuestionIds: string[],
  numberQuestionIds: string[],
): Record<StatisticsPipelineName, PipelineStage[]> {
  const match = (): PipelineStage => ({
    $match: { surveyVersionId: versionId },
  });
  return {
    total: [
      match(),
      { $count: "count" },
      { $project: { _id: { $literal: null }, count: 1 } },
    ],
    reached: [
      match(),
      { $project: { questionPath: 1 } },
      { $unwind: "$questionPath" },
      { $group: { _id: "$questionPath", count: { $sum: 1 } } },
    ],
    answered: [
      match(),
      { $project: { answers: 1 } },
      { $unwind: "$answers" },
      { $group: { _id: "$answers.questionId", count: { $sum: 1 } } },
    ],
    selections: [
      match(),
      { $project: { answers: 1 } },
      { $unwind: "$answers" },
      { $match: { "answers.questionId": { $in: selectionQuestionIds } } },
      {
        $project: {
          questionId: "$answers.questionId",
          values: {
            $cond: [
              { $isArray: "$answers.value" },
              "$answers.value",
              ["$answers.value"],
            ],
          },
        },
      },
      { $unwind: "$values" },
      {
        $group: {
          _id: { questionId: "$questionId", optionId: "$values" },
          count: { $sum: 1 },
        },
      },
    ],
    numbers: [
      match(),
      { $project: { answers: 1 } },
      { $unwind: "$answers" },
      { $match: { "answers.questionId": { $in: numberQuestionIds } } },
      {
        $group: {
          _id: "$answers.questionId",
          count: { $sum: 1 },
          average: { $avg: "$answers.value" },
          minimum: { $min: "$answers.value" },
          maximum: { $max: "$answers.value" },
        },
      },
    ],
  };
}

export function buildTextResponsePipeline(
  versionId: Types.ObjectId,
  questionId: string,
  limit: number,
  cursor?: { submittedAt: Date; id: Types.ObjectId },
): PipelineStage[] {
  const cursorRange = cursor
    ? {
        $or: [
          { submittedAt: { $lt: cursor.submittedAt } },
          { submittedAt: cursor.submittedAt, _id: { $lt: cursor.id } },
        ],
      }
    : {};
  return [
    {
      $match: {
        surveyVersionId: versionId,
        "answers.questionId": questionId,
        ...cursorRange,
      },
    },
    { $sort: { submittedAt: -1, _id: -1 } },
    { $limit: limit + 1 },
    {
      $project: {
        submittedAt: 1,
        respondentId: 1,
        value: {
          $let: {
            vars: {
              answer: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$answers",
                      as: "answer",
                      cond: { $eq: ["$$answer.questionId", questionId] },
                    },
                  },
                  0,
                ],
              },
            },
            in: "$$answer.value",
          },
        },
      },
    },
  ];
}
