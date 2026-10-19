import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidObjectId } from "mongoose";
import { validationError } from "../errors/api-error.js";

export interface SurveyListCursor {
  updatedAt: Date;
  id: string;
}

export interface VersionListCursor {
  surveyId: string;
  versionNumber: number;
}

export class SurveyCursorService {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = createHmac("sha256", secret)
      .update("survey-cursor-signing-key:v2")
      .digest();
  }
  encode(cursor: SurveyListCursor): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 2,
        kind: "surveys",
        updatedAt: cursor.updatedAt.toISOString(),
        id: cursor.id,
      }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }
  decode(cursor: string): SurveyListCursor {
    const value = this.decodePayload(cursor);
    try {
      if (
        Object.keys(value).sort().join(",") !== "id,kind,updatedAt,v" ||
        value.v !== 2 ||
        value.kind !== "surveys" ||
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
  encodeVersion(cursor: VersionListCursor): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 2,
        kind: "versions",
        surveyId: cursor.surveyId,
        versionNumber: cursor.versionNumber,
      }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }
  decodeVersion(cursor: string, surveyId: string): VersionListCursor {
    const value = this.decodePayload(cursor);
    if (
      Object.keys(value).sort().join(",") !== "kind,surveyId,v,versionNumber" ||
      value.v !== 2 ||
      value.kind !== "versions" ||
      value.surveyId !== surveyId ||
      !Number.isInteger(value.versionNumber) ||
      (value.versionNumber as number) < 1
    )
      throw validationError("cursor", "分页游标无效");
    return {
      surveyId,
      versionNumber: value.versionNumber as number,
    };
  }
  private decodePayload(cursor: string): Record<string, unknown> {
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
      ) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw validationError("cursor", "分页游标无效");
    }
  }
  private sign(payload: string): string {
    return createHmac("sha256", this.key).update(payload).digest("base64url");
  }
}
