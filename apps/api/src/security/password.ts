import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
export interface ScryptProfile {
  N: number;
  r: number;
  p: number;
  maxmem: number;
  saltBytes: number;
  keyBytes: number;
}
export const productionScryptProfile: Readonly<ScryptProfile> = Object.freeze({
  N: 32_768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
  saltBytes: 16,
  keyBytes: 64,
});
export const productionDummyHash =
  "scrypt$32768$8$3$b2ZmbGluZS1kdW1teS12MQ$rIe2_MjxjDByw8twbLC5mt_jm0Dyj-ai0ZAiwqInBWeHoL8aUC6y7gNnXUBFiAyHEsA_i4D-geCAbmfOJvSong";
const exactBase64Url = /^[A-Za-z0-9_-]+$/;

function derive(
  password: string,
  salt: Buffer,
  profile: Readonly<ScryptProfile>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, profile.keyBytes, profile, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export class PasswordService {
  constructor(
    private readonly profile: Readonly<ScryptProfile> = productionScryptProfile,
    readonly dummyHash = productionDummyHash,
  ) {}
  normalize(password: string): string {
    return password.normalize("NFKC");
  }
  async hash(password: string): Promise<string> {
    const salt = randomBytes(this.profile.saltBytes);
    const key = await derive(this.normalize(password), salt, this.profile);
    return [
      "scrypt",
      this.profile.N,
      this.profile.r,
      this.profile.p,
      salt.toString("base64url"),
      key.toString("base64url"),
    ].join("$");
  }
  async verify(password: string, record: string): Promise<boolean> {
    try {
      const [algorithm, nText, rText, pText, saltText, keyText, extra] =
        record.split("$");
      const [N, r, p] = [Number(nText), Number(rText), Number(pText)];
      if (
        extra !== undefined ||
        algorithm !== "scrypt" ||
        N !== this.profile.N ||
        r !== this.profile.r ||
        p !== this.profile.p ||
        !saltText ||
        !keyText ||
        !exactBase64Url.test(saltText) ||
        !exactBase64Url.test(keyText)
      )
        return false;
      const salt = Buffer.from(saltText, "base64url");
      const expected = Buffer.from(keyText, "base64url");
      if (
        salt.length !== this.profile.saltBytes ||
        expected.length !== this.profile.keyBytes
      )
        return false;
      const actual = await derive(this.normalize(password), salt, this.profile);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
