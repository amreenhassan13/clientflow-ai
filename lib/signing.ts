import { createHmac, timingSafeEqual } from "node:crypto";

/** WordPress requests older (or further in the future) than this are rejected. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 over "<unix timestamp>.<raw body>", hex encoded. Mirrors the PHP plugin. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifySignature(input: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowMs?: number;
}): boolean {
  const { secret, timestamp, signature, body } = input;
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const ageSeconds = Math.abs((input.nowMs ?? Date.now()) / 1000 - Number(timestamp));
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;
  return safeEqual(signPayload(secret, timestamp, body), signature.toLowerCase());
}
