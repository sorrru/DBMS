import { Schema, model, type Types } from "mongoose";
import type {
  LibraryDefinition,
  LibraryFreezeReason,
  QuestionType,
} from "@survey/survey-logic";
export interface LibraryQuestion {
  ownerId: Types.ObjectId;
  type: QuestionType;
  latestVersionId: Types.ObjectId;
  nextVersionNumber: number;
  revision: number;
  copiedFrom: {
    libraryQuestionId: Types.ObjectId;
    questionVersionId: Types.ObjectId;
    contentRevision: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface LibraryVersion {
  libraryQuestionId: Types.ObjectId;
  versionNumber: number;
  contentRevision: number;
  frozenAt: Date | null;
  freezeReasons: LibraryFreezeReason[];
  parentVersionId: Types.ObjectId | null;
  restoredFromVersionId: Types.ObjectId | null;
  definition: LibraryDefinition;
  createdAt: Date;
  updatedAt: Date;
}
const option = new Schema(
  {
    optionId: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false },
);
const definition = new Schema<LibraryDefinition>(
  {
    type: {
      type: String,
      enum: ["single", "multiple", "text", "number"],
      required: true,
    },
    title: { type: String, required: true },
    required: { type: Boolean, required: true },
    validation: { type: Schema.Types.Mixed, required: true },
    options: { type: [option], required: true },
  },
  { _id: false, minimize: false },
);
const copiedFrom = new Schema(
  {
    libraryQuestionId: { type: Schema.Types.ObjectId, required: true },
    questionVersionId: { type: Schema.Types.ObjectId, required: true },
    contentRevision: { type: Number, required: true },
  },
  { _id: false },
);
const identity = new Schema<LibraryQuestion>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    type: {
      type: String,
      enum: ["single", "multiple", "text", "number"],
      required: true,
    },
    latestVersionId: { type: Schema.Types.ObjectId, required: true },
    nextVersionNumber: { type: Number, required: true },
    revision: { type: Number, required: true },
    copiedFrom: { type: copiedFrom, default: null },
  },
  { timestamps: true, versionKey: false, collection: "questions" },
);
identity.index({ ownerId: 1, _id: -1 });
const version = new Schema<LibraryVersion>(
  {
    libraryQuestionId: { type: Schema.Types.ObjectId, required: true },
    versionNumber: { type: Number, required: true },
    contentRevision: { type: Number, required: true },
    frozenAt: { type: Date, default: null },
    freezeReasons: {
      type: [String],
      enum: ["adopted", "copied", "derived", "restored"],
      default: [],
    },
    parentVersionId: { type: Schema.Types.ObjectId, default: null },
    restoredFromVersionId: { type: Schema.Types.ObjectId, default: null },
    definition: { type: definition, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: false,
    collection: "question_versions",
  },
);
version.index({ libraryQuestionId: 1, versionNumber: -1 }, { unique: true });
// A bounded-per-option registry avoids an ever-growing array on the identity.
const optionKey = new Schema<{
  _id: string;
  libraryQuestionId: Types.ObjectId;
}>(
  {
    _id: { type: String, required: true },
    libraryQuestionId: { type: Schema.Types.ObjectId, required: true },
  },
  { versionKey: false, collection: "library_option_keys" },
);
export const LibraryQuestionModel = model<LibraryQuestion>(
  "LibraryQuestion",
  identity,
);
export const LibraryVersionModel = model<LibraryVersion>(
  "LibraryVersion",
  version,
);
export const LibraryOptionKeyModel = model("LibraryOptionKey", optionKey);
