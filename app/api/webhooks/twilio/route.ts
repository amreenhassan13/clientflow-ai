import { query, recordEvent } from "@/lib/db";
import { SMS_STATUS_RANK, validTwilioSignature } from "@/lib/integrations/twilio";
import { json, publicError } from "@/lib/security";

/** Twilio message status callbacks (set as statusCallback on every send). */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    if (!validTwilioSignature(request, "/api/webhooks/twilio", params)) {
      return json({ error: "Invalid Twilio signature" }, 401);
    }

    const sid = params.MessageSid ?? "";
    const status = params.MessageStatus ?? "";
    if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid) || !(status in SMS_STATUS_RANK)) {
      return json({ error: "Invalid callback" }, 400);
    }

    // Callbacks can arrive out of order; never move a message backwards.
    const [row] = await query<{ lead_id: string | null; purpose: string; status: string; previous: string }>(
      `WITH prev AS (SELECT status FROM sms_messages WHERE sid = $1 FOR UPDATE)
       UPDATE sms_messages SET
         status = CASE WHEN $3::int >= coalesce(($4::jsonb ->> prev.status)::int, 0) THEN $2 ELSE sms_messages.status END,
         error_code = coalesce($5, sms_messages.error_code),
         updated_at = now()
       FROM prev
       WHERE sms_messages.sid = $1
       RETURNING sms_messages.lead_id, sms_messages.purpose, sms_messages.status, prev.status AS previous`,
      [sid, status, SMS_STATUS_RANK[status], JSON.stringify(SMS_STATUS_RANK), params.ErrorCode || null],
    );

    if (row?.lead_id && row.status !== row.previous) {
      if (row.purpose === "welcome") {
        await query("UPDATE leads SET integration_sms = $2, updated_at = now() WHERE id = $1", [row.lead_id, row.status]);
      }
      await recordEvent(row.lead_id, `sms_${row.purpose}_${row.status}`, "twilio");
    }
    return json({ ok: true });
  } catch (err) {
    return publicError(err);
  }
}
