import { Schema, model, type Types } from "mongoose";
export interface QuestionBank {
  ownerId: Types.ObjectId;
  name: string;
  revision: number;
  membershipRevision: number;
  createdAt: Date;
  updatedAt: Date;
}
const bank = new Schema<QuestionBank>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    revision: { type: Number, default: 1 },
    membershipRevision: { type: Number, default: 0 },
  },
  { collection: "question_banks", timestamps: true, versionKey: false },
);
bank.index({ ownerId: 1, _id: -1 });
export const QuestionBankModel = model<QuestionBank>("QuestionBank", bank);
export interface QuestionBankItem {
  bankId: Types.ObjectId;
  libraryQuestionId: Types.ObjectId;
  versionPolicy: "latest" | "pinned";
  questionVersionId: Types.ObjectId | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
const item = new Schema<QuestionBankItem>(
  {
    bankId: { type: Schema.Types.ObjectId, required: true },
    libraryQuestionId: { type: Schema.Types.ObjectId, required: true },
    versionPolicy: { type: String, enum: ["latest", "pinned"], required: true },
    questionVersionId: { type: Schema.Types.ObjectId, default: null },
    revision: { type: Number, default: 1 },
  },
  { collection: "question_bank_items", timestamps: true, versionKey: false },
);
item.index({ bankId: 1, libraryQuestionId: 1 }, { unique: true });
item.index({ bankId: 1, _id: -1 });
export const QuestionBankItemModel = model<QuestionBankItem>(
  "QuestionBankItem",
  item,
);
