import { Schema, model, type Types } from "mongoose";

export interface SurveyVersion {
  surveyId: Types.ObjectId;
  versionNumber: number;
  status: "draft" | "published";
  revision: number;
  title: string;
  description: string;
  identityMode: "anonymous" | "identified";
  allowMultipleSubmissions: boolean;
  deadline: Date | null;
  sessionDurationMinutes: number;
  questions: unknown[];
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

const surveyVersionSchema = new Schema<SurveyVersion>(
  {
    surveyId: { type: Schema.Types.ObjectId, required: true, ref: "Survey" },
    versionNumber: { type: Number, required: true },
    status: { type: String, enum: ["draft", "published"], required: true },
    revision: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    identityMode: {
      type: String,
      enum: ["anonymous", "identified"],
      required: true,
    },
    allowMultipleSubmissions: { type: Boolean, required: true },
    deadline: { type: Date, default: null },
    sessionDurationMinutes: { type: Number, required: true },
    questions: { type: [Schema.Types.Mixed], required: true, default: [] },
    schemaVersion: { type: Number, required: true },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "survey_versions" },
);

surveyVersionSchema.index({ surveyId: 1, versionNumber: 1 }, { unique: true });
surveyVersionSchema.index(
  { surveyId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "draft" } },
);

export const SurveyVersionModel = model<SurveyVersion>(
  "SurveyVersion",
  surveyVersionSchema,
);
