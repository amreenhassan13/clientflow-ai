import { isDemo } from "@/lib/env";
import { processLeadSoon } from "@/lib/intake";
import { addLead } from "@/lib/leads";
import { handleRouteError, json, rateLimit } from "@/lib/security";
import { verifySignature } from "@/lib/signing";
import { leadSchema } from "@/lib/validation";

/**
 * Server-to-server intake from the WordPress plugin. The body is signed with
 * HMAC-SHA256 over "<timestamp>.<body>"; the idempotency_key inside the
 * signed body makes plugin retries (and replayed requests) return the
 * original lead instead of creating another one.
 */
export async function POST(request: Request) {
  try {
    if (isDemo()) return json({ error: "WordPress intake is disabled in demo mode." }, 403);

    const raw = await request.text();
    if (raw.length > 16_384) return json({ error: "Payload too large" }, 413);
    const valid = verifySignature({
      secret: process.env.WORDPRESS_WEBHOOK_SECRET,
      timestamp: request.headers.get("x-clientflow-timestamp"),
      signature: request.headers.get("x-clientflow-signature"),
      body: raw,
    });
    if (!valid) return json({ error: "Invalid signature" }, 401);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const parsed = leadSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid lead fields", fields: parsed.error.flatten().fieldErrors }, 400);
    }
    if (!parsed.data.idempotency_key) return json({ error: "idempotency_key is required" }, 400);
    if (!(await rateLimit(`wp:${parsed.data.email}`, 20, 3600))) {
      return json({ error: "Rate limit reached for this email" }, 429);
    }

    const { id, duplicate } = await addLead({ ...parsed.data, source: "wordpress" });
    if (!duplicate) processLeadSoon(id);
    return json({ ok: true, id, duplicate }, duplicate ? 200 : 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
