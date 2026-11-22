import { query, recordEvent } from "@/lib/db";
import { START_KEYWORDS, STOP_KEYWORDS, validTwilioSignature } from "@/lib/integrations/twilio";
import { normalizePhone } from "@/lib/phone";
import { publicError, sha256 } from "@/lib/security";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200) {
  return new Response(EMPTY_TWIML, { status, headers: { "Content-Type": "text/xml" } });
}

/**
 * Inbound SMS webhook. Set it as the "A message comes in" URL on your Twilio
 * number or Messaging Service. Twilio itself sends the STOP confirmation
 * reply; this route records the opt-out so ClientFlow never texts that
 * number again, even from another sender.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    if (!validTwilioSignature(request, "/api/webhooks/twilio/inbound", params)) return twiml(401);

    const from = normalizePhone(params.From);
    const keyword = (params.Body ?? "").trim().toUpperCase();
    const optOutType = (params.OptOutType ?? "").toUpperCase();
    if (!from) return twiml();

    if (optOutType === "STOP" || STOP_KEYWORDS.includes(keyword)) {
      await query("INSERT INTO sms_suppressions (phone_hash) VALUES ($1) ON CONFLICT DO NOTHING", [sha256(from)]);
      const leads = await query<{ id: string }>(
        `UPDATE leads SET sms_consent = false, sms_opted_out_at = now(), updated_at = now()
         WHERE phone = $1 RETURNING id`,
        [from],
      );
      for (const lead of leads) await recordEvent(lead.id, "sms_opted_out", "twilio");
    } else if (optOutType === "START" || START_KEYWORDS.includes(keyword)) {
      // Re-subscribing lifts the block, but consent must still be given on a new enquiry.
      await query("DELETE FROM sms_suppressions WHERE phone_hash = $1", [sha256(from)]);
    }
    return twiml();
  } catch (err) {
    publicError(err);
    return twiml(500);
  }
}
