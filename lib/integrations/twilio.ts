import "server-only";
import twilio from "twilio";
import { appUrl } from "../env";
import { PermanentError, RetryableError } from "../errors";

export const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"];
export const START_KEYWORDS = ["START", "UNSTOP", "YES"];

/** Delivery states Twilio reports, in lifecycle order. Terminal states never regress. */
export const SMS_STATUS_RANK: Record<string, number> = {
  accepted: 1,
  scheduled: 1,
  queued: 2,
  sending: 3,
  sent: 4,
  delivered: 5,
  undelivered: 5,
  failed: 5,
  canceled: 5,
};

export function smsEnabled(): boolean {
  return process.env.SMS_ENABLED === "true";
}

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM) &&
      appUrl(),
  );
}

let client: ReturnType<typeof twilio> | undefined;
function getClient() {
  client ??= twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

// Twilio error codes that retrying will not fix.
// 21211 invalid number, 21408 region not enabled, 21610 recipient replied STOP,
// 21612 unreachable via this sender, 21614 not a mobile number.
const PERMANENT_CODES = new Set([21211, 21408, 21610, 21612, 21614]);

export async function sendSms(to: string, body: string): Promise<{ sid: string; status: string }> {
  const base = appUrl();
  if (!base) throw new PermanentError("APP_URL is required for Twilio status callbacks");
  const sender = process.env.TWILIO_MESSAGING_SERVICE_SID
    ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
    : { from: process.env.TWILIO_FROM };
  try {
    const message = await getClient().messages.create({
      to,
      body,
      ...sender,
      statusCallback: `${base}/api/webhooks/twilio`,
    });
    return { sid: message.sid, status: message.status };
  } catch (err) {
    const e = err as { status?: number; code?: number; message?: string };
    const description = `Twilio error ${e.code ?? e.status ?? ""}: ${e.message ?? "unknown"}`;
    if (e.code && PERMANENT_CODES.has(e.code)) throw new PermanentError(description);
    if (e.status === 401 || e.status === 403) throw new PermanentError(description);
    throw new RetryableError(description);
  }
}

export function validTwilioSignature(request: Request, path: string, params: Record<string, string>): boolean {
  const base = appUrl();
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!base || !token) return false;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  return twilio.validateRequest(token, signature, `${base}${path}`, params);
}
