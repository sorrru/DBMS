import type { HydratedDocument } from "mongoose";
import { ApiError } from "../errors/api-error.js";
import { UserModel, type User } from "../models/user.js";
import type { PasswordService } from "../security/password.js";
import type { Credentials } from "./validation.js";

export interface PublicUser {
  id: string;
  username: string;
  registeredAt: string;
}

export function publicUser(user: HydratedDocument<User>): PublicUser {
  return {
    id: user._id.toString(),
    username: user.username,
    registeredAt: user.registeredAt.toISOString(),
  };
}

function isUsernameDuplicate(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
  };
  return (
    candidate.code === 11000 && candidate.keyPattern?.usernameNormalized === 1
  );
}

export class AuthService {
  constructor(private readonly passwords: PasswordService) {}

  async register(credentials: Credentials): Promise<HydratedDocument<User>> {
    const passwordHash = await this.passwords.hash(credentials.password);
    try {
      return await UserModel.create({
        username: credentials.username,
        usernameNormalized: credentials.usernameNormalized,
        passwordHash,
        registeredAt: new Date(),
      });
    } catch (error) {
      if (isUsernameDuplicate(error))
        throw new ApiError(409, "USERNAME_TAKEN", "用户名已被使用");
      throw error;
    }
  }

  async login(credentials: Credentials): Promise<HydratedDocument<User>> {
    const user = await UserModel.findOne({
      usernameNormalized: credentials.usernameNormalized,
    }).exec();
    const valid = await this.passwords.verify(
      credentials.password,
      user?.passwordHash ?? this.passwords.dummyHash,
    );
    if (!user || !valid)
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    return user;
  }
}
