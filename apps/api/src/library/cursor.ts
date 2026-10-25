import {
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { validationError } from "../errors/api-error.js";
export class LibraryCursor {
  private key: Buffer;
  private encryptionKey: Buffer;
  constructor(secret: string) {
    this.encryptionKey = createHmac("sha256", secret)
      .update("library-other-usage-encryption:v1")
      .digest();
    this.key = createHmac("sha256", secret)
      .update("library-cursor:v1")
      .digest();
  }
  encode(ownerId: string, scope: string, after: string | number): string {
    const json = JSON.stringify({ ownerId, scope, after });
    if (scope.startsWith("others:")) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
      const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
      return [iv, data, cipher.getAuthTag()]
        .map((b) => b.toString("base64url"))
        .join(".");
    }
    const payload = Buffer.from(json).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }
  decode(cursor: string, ownerId: string, scope: string): string | number {
    try {
      if (cursor.length > 1500) throw Error();
      const parts = cursor.split(".");
      let json: string;
      if (scope.startsWith("others:")) {
        if (parts.length !== 3) throw Error();
        const [iv, data, tag] = parts.map((p) => Buffer.from(p, "base64url"));
        if (iv!.length !== 12 || tag!.length !== 16) throw Error();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          this.encryptionKey,
          iv!,
        );
        decipher.setAuthTag(tag!);
        json = Buffer.concat([
          decipher.update(data!),
          decipher.final(),
        ]).toString("utf8");
      } else {
        if (parts.length !== 2) throw Error();
        const [payload, signature] = parts as [string, string];
        const expected = Buffer.from(this.sign(payload), "base64url"),
          actual = Buffer.from(signature, "base64url");
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw Error();
        json = Buffer.from(payload, "base64url").toString();
      }
      const v = JSON.parse(json) as Record<string, unknown>;
      if (
        !v ||
        Object.keys(v).sort().join(",") !== "after,ownerId,scope" ||
        v.ownerId !== ownerId ||
        v.scope !== scope
      )
        throw Error();
      if (scope.startsWith("others:")) {
        if (
          typeof v.after !== "string" ||
          !/^[a-f\d]{24}:[a-f\d]{24}:(draft|published)$/.test(v.after)
        )
          throw Error();
      } else if (
        scope === "banks" ||
        scope.startsWith("bankItems:") ||
        scope === "questions" ||
        scope === "sharedQuestions" ||
        scope.startsWith("shares:") ||
        scope.startsWith("usages:")
      ) {
        if (typeof v.after !== "string" || !/^[a-f\d]{24}$/.test(v.after))
          throw Error();
      } else if (!Number.isSafeInteger(v.after) || (v.after as number) < 1)
        throw Error();
      return v.after as string | number;
    } catch {
      throw validationError("cursor", "分页游标无效");
    }
  }
  private sign(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("base64url");
  }
}
