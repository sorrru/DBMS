import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { validationError } from "../errors/api-error.js";
export interface AnswerPosition {
  submittedAt: string;
  responseId: string;
  sourceKey: string;
}
export class LibraryStatisticsCursor {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHmac("sha256", secret)
      .update("cross-survey-text:v1")
      .digest();
  }
  binding(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  encode(scope: string, position: AnswerPosition) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(scope));
    return [
      iv,
      Buffer.concat([cipher.update(JSON.stringify(position)), cipher.final()]),
      cipher.getAuthTag(),
    ]
      .map((b) => b.toString("base64url"))
      .join(".");
  }
  decode(scope: string, token: string): AnswerPosition {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw Error();
      const [iv, data, tag] = parts.map((p) => Buffer.from(p, "base64url"));
      if (iv!.length !== 12 || tag!.length !== 16) throw Error();
      const cipher = createDecipheriv("aes-256-gcm", this.key, iv!);
      cipher.setAAD(Buffer.from(scope));
      cipher.setAuthTag(tag!);
      const p = JSON.parse(
        Buffer.concat([cipher.update(data!), cipher.final()]).toString(),
      ) as AnswerPosition;
      if (
        Object.keys(p).sort().join() !== "responseId,sourceKey,submittedAt" ||
        !/^[a-f\d]{24}$/.test(p.responseId) ||
        typeof p.sourceKey !== "string" ||
        !/^[a-f\d]{24}:q_[\w-]+$/.test(p.sourceKey) ||
        typeof p.submittedAt !== "string" ||
        new Date(p.submittedAt).toISOString() !== p.submittedAt
      )
        throw Error();
      return p;
    } catch {
      throw validationError("cursor", "分页游标无效或查询条件已改变");
    }
  }
}
