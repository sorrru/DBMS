import { createHmac, timingSafeEqual } from "node:crypto";

const issuer = "survey-stage1-api";
const audience = "survey-stage1-web";
export const sessionLifetimeSeconds = 2 * 60 * 60;
const encode = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

export class TokenService {
  constructor(private readonly secret: string) {}
  sign(userId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encode(
      JSON.stringify({
        sub: userId,
        iat: nowSeconds,
        exp: nowSeconds + sessionLifetimeSeconds,
        iss: issuer,
        aud: audience,
      }),
    );
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${this.signature(unsigned)}`;
  }
  verify(
    token: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): string | undefined {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return undefined;
      const [headerText, payloadText, signatureText] = parts as [
        string,
        string,
        string,
      ];
      const header = JSON.parse(
        Buffer.from(headerText, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (header.alg !== "HS256" || header.typ !== "JWT") return undefined;
      const actual = Buffer.from(signatureText, "base64url");
      const expected = Buffer.from(
        this.signature(`${headerText}.${payloadText}`),
        "base64url",
      );
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return undefined;
      const payload = JSON.parse(
        Buffer.from(payloadText, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      if (
        typeof payload.sub !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        payload.iss !== issuer ||
        payload.aud !== audience ||
        payload.iat > nowSeconds ||
        payload.exp <= nowSeconds
      )
        return undefined;
      return payload.sub;
    } catch {
      return undefined;
    }
  }
  private signature(unsigned: string): string {
    return createHmac("sha256", this.secret)
      .update(unsigned)
      .digest("base64url");
  }
}
