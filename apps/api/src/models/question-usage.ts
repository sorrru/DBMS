import { Schema, model, type Types } from "mongoose";
export interface QuestionUsage {
  ownerId: Types.ObjectId;
  surveyId: Types.ObjectId;
  surveyVersionId: Types.ObjectId;
  questionId: string;
  libraryQuestionId: Types.ObjectId;
  questionVersionId: Types.ObjectId;
  status: "draft" | "published";
}
const schema = new Schema<QuestionUsage>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    surveyId: { type: Schema.Types.ObjectId, required: true },
    surveyVersionId: { type: Schema.Types.ObjectId, required: true },
    questionId: { type: String, required: true },
    libraryQuestionId: { type: Schema.Types.ObjectId, required: true },
    questionVersionId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ["draft", "published"], required: true },
  },
  { versionKey: false, collection: "question_usages" },
);
schema.index({ surveyVersionId: 1, questionId: 1 }, { unique: true });
schema.index({
  libraryQuestionId: 1,
  ownerId: 1,
  status: 1,
  surveyVersionId: 1,
  questionId: 1,
});
schema.index({ questionVersionId: 1, ownerId: 1, status: 1 });
export const QuestionUsageModel = model<QuestionUsage>("QuestionUsage", schema);
