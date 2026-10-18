import { Schema, model, type Types } from "mongoose";

export interface Survey {
  ownerId: Types.ObjectId;
  publicId: string;
  internalName: string;
  manualStatus: "open" | "closed";
  currentVersionId: Types.ObjectId | null;
  draftVersionId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const surveySchema = new Schema<Survey>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    publicId: { type: String, required: true },
    internalName: { type: String, required: true },
    manualStatus: { type: String, enum: ["open", "closed"], required: true },
    currentVersionId: {
      type: Schema.Types.ObjectId,
      ref: "SurveyVersion",
      default: null,
    },
    draftVersionId: {
      type: Schema.Types.ObjectId,
      ref: "SurveyVersion",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

surveySchema.index({ publicId: 1 }, { unique: true });
surveySchema.index({ ownerId: 1, updatedAt: -1, _id: -1 });

export const SurveyModel = model<Survey>("Survey", surveySchema);
