import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { isValidObjectId } from "mongoose";
import { validationError } from "../errors/api-error.js";

interface TextCursorPayload {
  v: 1;
  kind: "text-responses";
  surveyId: string;
  versionId: string;
  questionId: string;
  submittedAt: string;
  id: string;
}

interface SubmissionCursorPayload {
  v: 1;
  kind: "identified-submissions";
  surveyId: string;
  versionId: string;
  submittedAt: string;
  id: string;
}

const aad = Buffer.from("statistics-text-cursor:v1", "utf8");
const questionIdPattern = /^q_[A-Za-z0-9_-]+$/;

export class StatisticsCursorService {
  private readonly key: Buffer;

  constructor(jwtSecret: string) {
    this.key = createHmac("sha256", jwtSecret)
      .update("statistics-text-cursor-key:v1")
      .digest();
  }

  encode(payload: Omit<TextCursorPayload, "v" | "kind">): string {
    return this.encrypt({ v: 1, kind: "text-responses", ...payload });
  }

  encodeSubmissions(
    payload: Omit<SubmissionCursorPayload, "v" | "kind">,
  ): string {
    return this.encrypt({ v: 1, kind: "identified-submissions", ...payload });
  }

  private encrypt(
    payload: TextCursorPayload | SubmissionCursorPayload,
  ): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  decode(
    token: string,
    expected: Pick<TextCursorPayload, "surveyId" | "versionId" | "questionId">,
  ): TextCursorPayload {
    try {
      const value = this.decrypt(token) as Partial<TextCursorPayload>;
      if (
        value.v !== 1 ||
        value.kind !== "text-responses" ||
        value.surveyId !== expected.surveyId ||
        value.versionId !== expected.versionId ||
        value.questionId !== expected.questionId ||
        !isValidObjectId(value.surveyId) ||
        !isValidObjectId(value.versionId) ||
        !isValidObjectId(value.id) ||
        !questionIdPattern.test(value.questionId) ||
        typeof value.submittedAt !== "string" ||
        !Number.isFinite(Date.parse(value.submittedAt))
      )
        throw new Error("payload");
      return value as TextCursorPayload;
    } catch {
      throw validationError("cursor", "分页游标无效或不属于当前查询");
    }
  }

  decodeSubmissions(
    token: string,
    expected: Pick<SubmissionCursorPayload, "surveyId" | "versionId">,
  ): SubmissionCursorPayload {
    try {
      const value = this.decrypt(token) as Partial<SubmissionCursorPayload>;
      if (
        value.v !== 1 ||
        value.kind !== "identified-submissions" ||
        value.surveyId !== expected.surveyId ||
        value.versionId !== expected.versionId ||
        !isValidObjectId(value.surveyId) ||
        !isValidObjectId(value.versionId) ||
        !isValidObjectId(value.id) ||
        typeof value.submittedAt !== "string" ||
        !Number.isFinite(Date.parse(value.submittedAt))
      )
        throw new Error("payload");
      return value as SubmissionCursorPayload;
    } catch {
      throw validationError("cursor", "分页游标无效或不属于当前查询");
    }
  }

  private decrypt(token: string): unknown {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("format");
    const iv = Buffer.from(parts[1]!, "base64url");
    const encrypted = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0)
      throw new Error("length");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        "utf8",
      ),
    );
  }
}
