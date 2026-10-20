import { Schema, model, type Types } from "mongoose";

export interface FillSession {
  surveyId: Types.ObjectId;
  surveyVersionId: Types.ObjectId;
  identityMode: "anonymous" | "identified";
  ownerKey: string;
  userId?: Types.ObjectId;
  sessionTokenHash: string;
  status: "active" | "expired" | "submitted";
  activeSlot: number | null;
  startedAt: Date;
  expiresAt: Date;
  purgeAt: Date;
  submittedAt: Date | null;
}

const fillSessionSchema = new Schema<FillSession>(
  {
    surveyId: { type: Schema.Types.ObjectId, required: true, ref: "Survey" },
    surveyVersionId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "SurveyVersion",
    },
    identityMode: {
      type: String,
      enum: ["anonymous", "identified"],
      required: true,
    },
    ownerKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    sessionTokenHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "expired", "submitted"],
      required: true,
    },
    activeSlot: { type: Number, default: null },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
  },
  { versionKey: false, collection: "fill_sessions" },
);

fillSessionSchema.index({ sessionTokenHash: 1 }, { unique: true });
fillSessionSchema.index(
  { surveyId: 1, ownerKey: 1, activeSlot: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
  },
);
fillSessionSchema.index({ surveyId: 1, ownerKey: 1, status: 1, expiresAt: 1 });
fillSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const FillSessionModel = model<FillSession>(
  "FillSession",
  fillSessionSchema,
);
