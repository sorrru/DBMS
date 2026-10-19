import { Schema, model, type Types } from "mongoose";
import type {
  JumpRule,
  QuestionOption,
  SurveyQuestion,
} from "../surveys/questions.js";

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
  questions: SurveyQuestion[];
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

const optionSchema = new Schema<QuestionOption>(
  {
    optionId: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false, versionKey: false, minimize: false },
);

const jumpRuleSchema = new Schema<JumpRule>(
  {
    ruleId: { type: String, required: true },
    operator: {
      type: String,
      enum: [
        "equals",
        "contains",
        "containsAll",
        "containsAny",
        "gt",
        "gte",
        "lt",
        "lte",
      ],
      required: true,
    },
    value: { type: Schema.Types.Mixed, required: true },
    targetQuestionId: { type: String, required: true },
  },
  { _id: false, versionKey: false, minimize: false },
);

const questionSchema = new Schema<SurveyQuestion>(
  {
    questionId: { type: String, required: true },
    type: {
      type: String,
      enum: ["single", "multiple", "text", "number"],
      required: true,
    },
    title: { type: String, required: true },
    required: { type: Boolean, required: true },
    validation: { type: Schema.Types.Mixed, required: true },
    options: { type: [optionSchema], required: true, default: [] },
    jumpRules: { type: [jumpRuleSchema], required: true, default: [] },
  },
  { _id: false, versionKey: false, minimize: false },
);

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
    questions: { type: [questionSchema], required: true, default: [] },
    schemaVersion: { type: Number, required: true },
    publishedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: false,
    collection: "survey_versions",
  },
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
