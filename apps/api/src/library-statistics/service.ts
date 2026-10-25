import mongoose, {
  Types,
  type ClientSession,
  type PipelineStage,
} from "mongoose";
import type { LibraryDefinition } from "@survey/survey-logic";
import { ApiError, validationError } from "../errors/api-error.js";
import { libraryAccess } from "../library/access.js";
import { QuestionUsageModel } from "../models/question-usage.js";
import { SurveyModel } from "../models/survey.js";
import { SurveyVersionModel } from "../models/survey-version.js";
import { SurveyResponseModel } from "../models/response.js";
import { LibraryStatisticsCursor, type AnswerPosition } from "./cursor.js";
import {
  summaryPipeline,
  textPipeline,
  sourceKey,
  type StatisticsSource,
} from "./pipelines.js";
import type { LibraryStatisticsQuery } from "./validation.js";
const descending = (a: string, b: string) => (a === b ? 0 : a > b ? -1 : 1);
const unavailable = () =>
  new ApiError(503, "STATISTICS_UNAVAILABLE", "统计数据暂时不可用，请稍后重试");
function chunks<T>(items: T[], size = 50): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    result.push(items.slice(i, i + size));
  return result;
}
interface Facets {
  common: {
    _id: string;
    opportunityCount: number;
    reachedCount: number;
    answeredCount: number;
  }[];
  numbers?: {
    _id: string;
    count: number;
    sum: number;
    minimum: number;
    maximum: number;
  }[];
  buckets?: { _id: { group: string; bucket: number }; count: number }[];
  selections?: { _id: { group: string; optionId: string }; count: number }[];
}
export interface LibraryStatisticsGroup {
  groupId: string;
  questionVersionIds: string[];
  opportunityCount: number;
  reachedCount: number;
  answeredCount: number;
  notReachedCount: number;
  unansweredReachedCount: number;
  reachRate: number;
  answerRate: number;
  sourceCount: number;
  surveyCount: number;
  options: {
    optionId: string;
    labels: string[];
    count: number;
    percentageOfAnswered: number;
  }[];
  number: {
    count: number;
    sum: number;
    average: number | null;
    minimum: number | null;
    maximum: number | null;
    buckets: { lower: number | null; upper: number | null; count: number }[];
  } | null;
}
export class LibraryStatisticsService {
  private cursors: LibraryStatisticsCursor;
  constructor(
    secret: string,
    private maxTimeMs: number,
    private hooks: { afterBatch?: () => void | Promise<void> } = {},
  ) {
    this.cursors = new LibraryStatisticsCursor(secret);
  }
  private async sources(
    user: Types.ObjectId,
    libraryQuestionId: string,
    session: ClientSession,
  ) {
    const usages = await QuestionUsageModel.find({
      ownerId: user,
      libraryQuestionId,
      status: "published",
    })
      .hint({
        libraryQuestionId: 1,
        ownerId: 1,
        status: 1,
        surveyVersionId: 1,
        questionId: 1,
      })
      .setOptions({ maxTimeMS: this.maxTimeMs })
      .limit(1001)
      .session(session)
      .lean();
    if (usages.length > 1000)
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        "该题目引用超过单次统计上限 1000，请缩小数据规模",
      );
    const surveys = await SurveyModel.find({
      ownerId: user,
      _id: { $in: [...new Set(usages.map((u) => u.surveyId.toString()))] },
    })
      .select({ _id: 1 })
      .session(session)
      .lean();
    const owned = new Set(surveys.map((s) => s._id.toString())),
      sources: StatisticsSource[] = [];
    for (const batch of chunks([
      ...new Set(
        usages
          .filter((u) => owned.has(u.surveyId.toString()))
          .map((u) => u.surveyVersionId.toString()),
      ),
    ])) {
      const versions = await SurveyVersionModel.find({
        _id: { $in: batch },
        surveyId: { $in: surveys.map((s) => s._id) },
        status: "published",
      })
        .session(session)
        .lean();
      for (const version of versions)
        for (const q of version.questions) {
          if (q.source?.libraryQuestionId !== libraryQuestionId) continue;
          const projected = usages.some(
            (u) =>
              u.surveyVersionId.equals(version._id) &&
              u.surveyId.equals(version.surveyId) &&
              u.questionId === q.questionId &&
              u.questionVersionId.toString() === q.source!.questionVersionId,
          );
          if (!projected) continue;
          const map = new Map(
            q.source.optionSources.map((o) => [o.optionId, o.sourceOptionId]),
          );
          if (q.options.some((o) => !map.has(o.optionId))) throw unavailable();
          sources.push({
            surveyId: version.surveyId.toString(),
            surveyVersionId: version._id.toString(),
            questionId: q.questionId,
            questionVersionId: q.source.questionVersionId,
            versionNumber: q.source.versionNumber,
            definition: {
              type: q.type,
              title: q.title,
              required: q.required,
              validation: q.validation,
              options: q.options.map((o) => ({
                ...o,
                optionId: map.get(o.optionId)!,
              })),
            },
            optionSources: q.source.optionSources,
          });
        }
    }
    if (!sources.length) await libraryAccess(user, libraryQuestionId, session);
    return sources.sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  }
  private profiles(sources: StatisticsSource[]) {
    const profiles = new Map<
      string,
      {
        questionVersionId: string;
        versionNumber: number;
        definition: LibraryDefinition;
        sourceCount: number;
        surveyCount: number;
      }
    >();
    for (const s of sources) {
      const old = profiles.get(s.questionVersionId);
      if (old) {
        if (JSON.stringify(old.definition) !== JSON.stringify(s.definition))
          throw unavailable();
        old.sourceCount++;
      } else
        profiles.set(s.questionVersionId, {
          questionVersionId: s.questionVersionId,
          versionNumber: s.versionNumber,
          definition: s.definition,
          sourceCount: 1,
          surveyCount: 0,
        });
    }
    for (const p of profiles.values())
      p.surveyCount = new Set(
        sources
          .filter((s) => s.questionVersionId === p.questionVersionId)
          .map((s) => s.surveyId),
      ).size;
    return [...profiles.values()].sort(
      (a, b) => b.versionNumber - a.versionNumber,
    );
  }
  private async read<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await mongoose.connection.transaction(work, {
        readConcern: { level: "snapshot" },
        maxCommitTimeMS: this.maxTimeMs,
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (
        (e as { code?: number }).code === 50 ||
        (e as { hasErrorLabel?: (s: string) => boolean }).hasErrorLabel?.(
          "TransientTransactionError",
        )
      )
        throw unavailable();
      throw e;
    }
  }
  async catalog(user: Types.ObjectId, id: string) {
    return this.read(async (session) => {
      const sources = await this.sources(user, id, session);
      return {
        libraryQuestionId: id,
        versions: this.profiles(sources),
        sourceCount: sources.length,
        scope: "own-published-surveys" as const,
      };
    });
  }
  private aggregate<T>(pipeline: PipelineStage[], session: ClientSession) {
    return SurveyResponseModel.aggregate<T>(pipeline)
      .session(session)
      .hint({ surveyVersionId: 1, submittedAt: -1, _id: -1 })
      .option({ maxTimeMS: this.maxTimeMs })
      .exec();
  }
  async query(user: Types.ObjectId, id: string, input: LibraryStatisticsQuery) {
    return this.read(async (session) => {
      const all = await this.sources(user, id, session),
        profiles = this.profiles(all);
      if (
        input.questionVersionIds.some(
          (v) => !profiles.some((p) => p.questionVersionId === v),
        )
      )
        throw validationError(
          "questionVersionIds",
          "只能选择自己已发布问卷实际使用的题目版本",
        );
      const sources = all.filter((s) =>
        input.questionVersionIds.includes(s.questionVersionId),
      );
      const selected = profiles.filter((p) =>
          input.questionVersionIds.includes(p.questionVersionId),
        ),
        type = selected[0]!.definition.type;
      if (selected.some((p) => p.definition.type !== type))
        throw validationError("questionVersionIds", "题型不同不能合并统计");
      if (input.merge && selected.length > 1 && !input.confirmMerge)
        throw validationError("confirmMerge");
      const groups: LibraryStatisticsGroup[] = (
        input.merge ? ["merged"] : input.questionVersionIds
      ).map((groupId) => {
        const members = sources.filter(
            (s) => input.merge || s.questionVersionId === groupId,
          ),
          options = new Map<string, Set<string>>();
        for (const s of members)
          for (const o of s.definition.options) {
            if (!options.has(o.optionId)) options.set(o.optionId, new Set());
            options.get(o.optionId)!.add(o.text);
          }
        return {
          groupId,
          questionVersionIds: [
            ...new Set(members.map((s) => s.questionVersionId)),
          ],
          opportunityCount: 0,
          reachedCount: 0,
          answeredCount: 0,
          notReachedCount: 0,
          unansweredReachedCount: 0,
          reachRate: 0,
          answerRate: 0,
          sourceCount: members.length,
          surveyCount: new Set(members.map((s) => s.surveyId)).size,
          options: [...options].map(([optionId, labels]) => ({
            optionId,
            labels: [...labels],
            count: 0,
            percentageOfAnswered: 0,
          })),
          number:
            type === "number"
              ? {
                  count: 0,
                  sum: 0,
                  average: null,
                  minimum: null,
                  maximum: null,
                  buckets: Array.from(
                    { length: input.boundaries.length + 1 },
                    (_, i) => ({
                      lower: input.boundaries[i - 1] ?? null,
                      upper: input.boundaries[i] ?? null,
                      count: 0,
                    }),
                  ),
                }
              : null,
        };
      });
      const groupMap = new Map(groups.map((g) => [g.groupId, g]));
      for (const batch of chunks(sources)) {
        const result = (
          await this.aggregate<Facets>(
            summaryPipeline(batch, input.merge, type, input.boundaries),
            session,
          )
        )[0]!;
        for (const r of result.common) {
          const g = groupMap.get(r._id)!;
          g.opportunityCount += r.opportunityCount;
          g.reachedCount += r.reachedCount;
          g.answeredCount += r.answeredCount;
        }
        for (const r of result.numbers ?? []) {
          const n = groupMap.get(r._id)!.number!;
          n.count += r.count;
          n.sum += r.sum;
          n.minimum =
            n.minimum === null ? r.minimum : Math.min(n.minimum, r.minimum);
          n.maximum =
            n.maximum === null ? r.maximum : Math.max(n.maximum, r.maximum);
        }
        for (const r of result.buckets ?? [])
          groupMap.get(r._id.group)!.number!.buckets[r._id.bucket]!.count +=
            r.count;
        for (const r of result.selections ?? []) {
          const option = groupMap
            .get(r._id.group)!
            .options.find((o) => o.optionId === r._id.optionId);
          if (!option) throw unavailable();
          option.count += r.count;
        }
        await this.hooks.afterBatch?.();
      }
      for (const g of groups) {
        g.notReachedCount = g.opportunityCount - g.reachedCount;
        g.unansweredReachedCount = g.reachedCount - g.answeredCount;
        g.reachRate = g.opportunityCount
          ? g.reachedCount / g.opportunityCount
          : 0;
        g.answerRate = g.reachedCount ? g.answeredCount / g.reachedCount : 0;
        for (const o of g.options)
          o.percentageOfAnswered = g.answeredCount
            ? o.count / g.answeredCount
            : 0;
        if (g.number) {
          g.number.average = g.number.count
            ? g.number.sum / g.number.count
            : null;
          if (
            !Number.isFinite(g.number.sum) ||
            g.number.count !== g.answeredCount ||
            g.number.buckets.reduce((sum, b) => sum + b.count, 0) !==
              g.number.count
          )
            throw unavailable();
        }
        if (
          g.answeredCount > g.reachedCount ||
          g.reachedCount > g.opportunityCount ||
          (type === "single" &&
            g.options.reduce((n, o) => n + o.count, 0) !== g.answeredCount) ||
          g.options.some((o) => o.count > g.answeredCount)
        )
          throw unavailable();
      }
      let text: {
        items: {
          value: string;
          submittedDate: string;
          questionVersionId: string;
        }[];
        nextCursor: string | null;
      } | null = null;
      if (type === "text") {
        const scope = this.cursors.binding({
          user: user.toString(),
          id,
          ids: [...input.questionVersionIds].sort(),
          merge: input.merge,
          boundaries: input.boundaries,
          limit: input.limit,
          sources: sources.map(sourceKey),
        });
        const after = input.cursor
          ? this.cursors.decode(scope, input.cursor)
          : undefined;
        type TextRow = {
          _id: Types.ObjectId;
          submittedAt: Date;
          sourceKey: string;
          questionVersionId: string;
          value: string;
        };
        const candidates: TextRow[] = [];
        for (const batch of chunks(sources))
          candidates.push(
            ...(await this.aggregate<TextRow>(
              textPipeline(batch, input.limit, after),
              session,
            )),
          );
        candidates.sort(
          (a, b) =>
            b.submittedAt.getTime() - a.submittedAt.getTime() ||
            descending(a._id.toString(), b._id.toString()) ||
            descending(a.sourceKey, b.sourceKey),
        );
        const page = candidates.slice(0, input.limit),
          last = page.at(-1);
        const position: AnswerPosition | undefined = last
          ? {
              submittedAt: last.submittedAt.toISOString(),
              responseId: last._id.toString(),
              sourceKey: last.sourceKey,
            }
          : undefined;
        text = {
          items: page.map((r) => ({
            value: r.value,
            submittedDate: r.submittedAt.toISOString().slice(0, 10),
            questionVersionId: r.questionVersionId,
          })),
          nextCursor:
            candidates.length > input.limit && position
              ? this.cursors.encode(scope, position)
              : null,
        };
      } else if (input.cursor)
        throw validationError("cursor", "只有文本回答支持分页");
      return {
        libraryQuestionId: id,
        scope: "own-published-surveys" as const,
        countingUnit: "question-instance" as const,
        merged: input.merge,
        versions: selected,
        groups,
        text,
        generatedAt: new Date().toISOString(),
      };
    });
  }
}
