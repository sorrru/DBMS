import { Schema, model, type Types } from "mongoose";
export interface QuestionShare {
  libraryQuestionId: Types.ObjectId;
  questionVersionId: Types.ObjectId;
  recipientId: Types.ObjectId;
  accessRevision: number;
  createdAt: Date;
}
const schema = new Schema<QuestionShare>(
  {
    libraryQuestionId: { type: Schema.Types.ObjectId, required: true },
    questionVersionId: { type: Schema.Types.ObjectId, required: true },
    recipientId: { type: Schema.Types.ObjectId, required: true },
    accessRevision: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "question_shares", versionKey: false },
);
schema.index({ questionVersionId: 1, recipientId: 1 }, { unique: true });
schema.index({ recipientId: 1, libraryQuestionId: 1 });
schema.index({ libraryQuestionId: 1, _id: -1 });
export const QuestionShareModel = model<QuestionShare>("QuestionShare", schema);
