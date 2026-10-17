import { Schema, model } from "mongoose";

export interface User {
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  registeredAt: Date;
}

const userSchema = new Schema<User>(
  {
    username: { type: String, required: true },
    usernameNormalized: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    registeredAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false },
);

export const UserModel = model<User>("User", userSchema);
