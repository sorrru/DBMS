import { Schema, model, type Types } from "mongoose";
interface Stage2Demo {
  _id: string;
  userIds: Types.ObjectId[];
  state: "building" | "ready";
}
const schema = new Schema<Stage2Demo>(
  {
    _id: String,
    userIds: [{ type: Schema.Types.ObjectId, required: true }],
    state: { type: String, enum: ["building", "ready"], required: true },
  },
  { collection: "stage2_demo_manifest", versionKey: false },
);
export const Stage2DemoModel = model<Stage2Demo>("Stage2Demo", schema);
