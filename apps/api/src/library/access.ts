import { Types, type ClientSession, type PipelineStage } from "mongoose";
import { ApiError } from "../errors/api-error.js";
import {
  LibraryQuestionModel,
  LibraryVersionModel,
} from "../models/library-question.js";
import { QuestionShareModel } from "../models/question-share.js";
export const libraryMissing = () =>
  new ApiError(404, "LIBRARY_QUESTION_NOT_FOUND", "题目或版本不存在");
export async function libraryAccess(
  userId: Types.ObjectId,
  id: string,
  session?: ClientSession,
) {
  const identity = await LibraryQuestionModel.findById(id)
    .session(session ?? null)
    .lean();
  if (!identity) throw libraryMissing();
  const isOwner = identity.ownerId.equals(userId);
  if (
    !isOwner &&
    !(await QuestionShareModel.exists({
      libraryQuestionId: id,
      recipientId: userId,
    }).session(session ?? null))
  )
    throw libraryMissing();
  return { identity, isOwner };
}
export function visibleVersionsPipeline(
  userId: Types.ObjectId,
  id: string,
): PipelineStage[] {
  return [
    { $match: { libraryQuestionId: new Types.ObjectId(id) } },
    {
      $lookup: {
        from: "question_shares",
        let: { v: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$questionVersionId", "$$v"] },
                  { $eq: ["$recipientId", userId] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "grant",
      },
    },
    { $match: { "grant.0": { $exists: true } } },
    { $unset: "grant" },
  ];
}
/** For new adoption/copy, contend with deletion of this exact authorization in the same transaction. */
export async function readAccessibleLibraryVersion(
  userId: Types.ObjectId,
  id: string,
  versionId: string,
  session: ClientSession,
) {
  const identity = await LibraryQuestionModel.findById(id)
    .session(session)
    .lean();
  if (!identity) throw libraryMissing();
  if (!identity.ownerId.equals(userId)) {
    const grant = await QuestionShareModel.findOneAndUpdate(
      {
        libraryQuestionId: id,
        questionVersionId: versionId,
        recipientId: userId,
      },
      { $inc: { accessRevision: 1 } },
      { session },
    );
    if (!grant) throw libraryMissing();
  }
  const version = await LibraryVersionModel.findOne({
    _id: versionId,
    libraryQuestionId: id,
  })
    .session(session)
    .lean();
  if (!version) throw libraryMissing();
  return version;
}
