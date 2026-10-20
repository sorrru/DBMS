import { Schema, model, type Types } from "mongoose";

export type StoredAnswerValue = string | string[] | number;

export interface StoredAnswer {
  questionId: string;
  value: StoredAnswerValue;
}

export interface SurveyResponse {
  surveyId: Types.ObjectId;
  surveyVersionId: Types.ObjectId;
  fillSessionId: Types.ObjectId;
  ownerKey: string;
  dedupKey?: string;
  respondentId?: Types.ObjectId;
  questionPath: string[];
  ignoredQuestionIds: string[];
  answers: StoredAnswer[];
  submittedAt: Date;
}

const storedAnswerSchema = new Schema<StoredAnswer>(
  {
    questionId: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false, versionKey: false, minimize: false },
);

const responseSchema = new Schema<SurveyResponse>(
  {
    surveyId: { type: Schema.Types.ObjectId, required: true, ref: "Survey" },
    surveyVersionId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "SurveyVersion",
    },
    fillSessionId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "FillSession",
    },
    ownerKey: { type: String, required: true },
    dedupKey: { type: String },
    respondentId: { type: Schema.Types.ObjectId, ref: "User" },
    questionPath: { type: [String], required: true },
    ignoredQuestionIds: { type: [String], required: true, default: [] },
    answers: { type: [storedAnswerSchema], required: true, default: [] },
    submittedAt: { type: Date, required: true },
  },
  { versionKey: false, collection: "responses" },
);

responseSchema.index({ fillSessionId: 1 }, { unique: true });
responseSchema.index(
  { surveyVersionId: 1, dedupKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupKey: { $type: "string" } },
  },
);
responseSchema.index({ surveyVersionId: 1, submittedAt: -1, _id: -1 });

export const SurveyResponseModel = model<SurveyResponse>(
  "SurveyResponse",
  responseSchema,
);
