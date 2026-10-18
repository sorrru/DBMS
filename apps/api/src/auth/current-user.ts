import type { Request } from "express";
import { isValidObjectId, type HydratedDocument } from "mongoose";
import { ApiError } from "../errors/api-error.js";
import { readSessionCookie } from "../http/cookies.js";
import { UserModel, type User } from "../models/user.js";
import type { TokenService } from "../security/token.js";

export async function requireCurrentUser(
  request: Request,
  tokens: TokenService,
): Promise<HydratedDocument<User>> {
  const token = readSessionCookie(request);
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "请先登录");
  const userId = tokens.verify(token);
  if (!userId || !isValidObjectId(userId))
    throw new ApiError(401, "AUTH_INVALID", "登录状态无效或已过期");
  const user = await UserModel.findById(userId).exec();
  if (!user) throw new ApiError(401, "AUTH_INVALID", "登录状态无效或已过期");
  return user;
}
