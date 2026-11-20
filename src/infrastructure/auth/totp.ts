import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Kassenbuch";

export function generateTotpSecret(): string {
  // 20 bytes → Base32 ohne Padding
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secretBase32: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

export async function totpQrDataUrl(email: string, secretBase32: string): Promise<string> {
  return QRCode.toDataURL(totpUri(email, secretBase32), { margin: 1, width: 220 });
}

export function verifyTotp(secretBase32: string, token: string, window = 1): boolean {
  const code = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, window });
  return delta !== null;
}

export const TOTP_CHALLENGE_COOKIE = "kmu_totp_challenge";

/** Kurzlebige TOTP-Challenge nach Passwort-Login (Cookie, HMAC-signiert) */
const CHALLENGE_TTL_MS = 5 * 60_000;

function challengeSecret(): string {
  return process.env.TOTP_CHALLENGE_SECRET
    || process.env.APP_URL
    || process.env.DATABASE_URL
    || "dev-totp-challenge";
}

export function createTotpChallenge(userId: string): string {
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", challengeSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function parseTotpChallenge(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", challengeSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, expStr] = payload.split(".");
  if (!userId || !expStr) return null;
  if (Date.now() > Number(expStr)) return null;
  return userId;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
