import { Types, type PipelineStage } from "mongoose";
import type { LibraryDefinition } from "@survey/survey-logic";
import type { AnswerPosition } from "./cursor.js";
export interface StatisticsSource {
  surveyId: string;
  surveyVersionId: string;
  questionId: string;
  questionVersionId: string;
  versionNumber: number;
  definition: LibraryDefinition;
  optionSources: { optionId: string; sourceOptionId: string }[];
}
export const sourceKey = (s: StatisticsSource) =>
  `${s.surveyVersionId}:${s.questionId}`;
/** Sources were authorized and mapped before touching responses. No response lookup. */
export function sourceRows(
  sources: StatisticsSource[],
  merge: boolean,
): PipelineStage[] {
  const versions = [...new Set(sources.map((s) => s.surveyVersionId))];
  return [
    {
      $match: {
        surveyVersionId: { $in: versions.map((id) => new Types.ObjectId(id)) },
      },
    },
    {
      $project: {
        _id: 1,
        submittedAt: 1,
        rows: {
          $filter: {
            input: sources.map((s) => ({
              matches: {
                $eq: [
                  "$surveyVersionId",
                  new Types.ObjectId(s.surveyVersionId),
                ],
              },
              sourceKey: { $literal: sourceKey(s) },
              group: { $literal: merge ? "merged" : s.questionVersionId },
              questionVersionId: { $literal: s.questionVersionId },
              reached: { $in: [s.questionId, "$questionPath"] },
              answer: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$answers",
                      as: "a",
                      cond: { $eq: ["$$a.questionId", s.questionId] },
                    },
                  },
                  0,
                ],
              },
              options: { $literal: s.optionSources },
            })),
            as: "row",
            cond: "$$row.matches",
          },
        },
      },
    },
    { $unwind: "$rows" },
    {
      $set: {
        "rows.answered": { $ne: [{ $type: "$rows.answer.value" }, "missing"] },
      },
    },
  ];
}
export function summaryPipeline(
  sources: StatisticsSource[],
  merge: boolean,
  type: string,
  boundaries: number[],
): PipelineStage[] {
  const facets: Record<string, PipelineStage.FacetPipelineStage[]> = {
    common: [
      {
        $group: {
          _id: "$rows.group",
          opportunityCount: { $sum: 1 },
          reachedCount: { $sum: { $cond: ["$rows.reached", 1, 0] } },
          answeredCount: { $sum: { $cond: ["$rows.answered", 1, 0] } },
        },
      },
    ],
  };
  if (type === "number") {
    facets.numbers = [
      { $match: { "rows.answered": true } },
      {
        $group: {
          _id: "$rows.group",
          count: { $sum: 1 },
          sum: { $sum: "$rows.answer.value" },
          minimum: { $min: "$rows.answer.value" },
          maximum: { $max: "$rows.answer.value" },
        },
      },
    ];
    facets.buckets = [
      { $match: { "rows.answered": true } },
      {
        $group: {
          _id: {
            group: "$rows.group",
            bucket: {
              $switch: {
                branches: boundaries.map((bound, index) => ({
                  case: { $lt: ["$rows.answer.value", bound] },
                  then: index,
                })),
                default: boundaries.length,
              },
            },
          },
          count: { $sum: 1 },
        },
      },
    ];
  }
  if (type === "single" || type === "multiple")
    facets.selections = [
      { $match: { "rows.answered": true } },
      {
        $set: {
          values: {
            $cond: [
              { $isArray: "$rows.answer.value" },
              "$rows.answer.value",
              ["$rows.answer.value"],
            ],
          },
        },
      },
      { $unwind: "$values" },
      {
        $set: {
          mapped: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$rows.options",
                  as: "o",
                  cond: { $eq: ["$$o.optionId", "$values"] },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: { group: "$rows.group", optionId: "$mapped.sourceOptionId" },
          count: { $sum: 1 },
        },
      },
    ];
  return [...sourceRows(sources, merge), { $facet: facets }];
}
export function textPipeline(
  sources: StatisticsSource[],
  limit: number,
  after?: AnswerPosition,
): PipelineStage[] {
  return [
    ...sourceRows(sources, false),
    {
      $match: {
        "rows.answered": true,
        ...(after
          ? {
              $or: [
                { submittedAt: { $lt: new Date(after.submittedAt) } },
                {
                  submittedAt: new Date(after.submittedAt),
                  _id: { $lt: new Types.ObjectId(after.responseId) },
                },
                {
                  submittedAt: new Date(after.submittedAt),
                  _id: new Types.ObjectId(after.responseId),
                  "rows.sourceKey": { $lt: after.sourceKey },
                },
              ],
            }
          : {}),
      },
    },
    { $sort: { submittedAt: -1, _id: -1, "rows.sourceKey": -1 } },
    { $limit: limit + 1 },
    {
      $project: {
        _id: 1,
        submittedAt: 1,
        sourceKey: "$rows.sourceKey",
        questionVersionId: "$rows.questionVersionId",
        value: "$rows.answer.value",
      },
    },
  ];
}
