import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidObjectId } from "mongoose";
import { validationError } from "../errors/api-error.js";

export interface SurveyCursor {
  updatedAt: Date;
  id: string;
}

export class SurveyCursorService {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = createHmac("sha256", secret)
      .update("survey-list-cursor-key:v1")
      .digest();
  }
  encode(cursor: SurveyCursor): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        updatedAt: cursor.updatedAt.toISOString(),
        id: cursor.id,
      }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }
  decode(cursor: string): SurveyCursor {
    try {
      const parts = cursor.split(".");
      if (parts.length !== 2) throw new Error();
      const [payload, signature] = parts as [string, string];
      const expected = Buffer.from(this.sign(payload), "base64url");
      const actual = Buffer.from(signature, "base64url");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const value = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (
        value.v !== 1 ||
        typeof value.updatedAt !== "string" ||
        typeof value.id !== "string" ||
        !isValidObjectId(value.id)
      )
        throw new Error();
      const updatedAt = new Date(value.updatedAt);
      if (
        Number.isNaN(updatedAt.getTime()) ||
        updatedAt.toISOString() !== value.updatedAt
      )
        throw new Error();
      return { updatedAt, id: value.id };
    } catch {
      throw validationError("cursor", "分页游标无效");
    }
  }
  private sign(payload: string): string {
    return createHmac("sha256", this.key).update(payload).digest("base64url");
  }
}
