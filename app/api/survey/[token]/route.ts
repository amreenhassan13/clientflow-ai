import { sameOrigin } from "@/lib/auth";
import { query, recordEvent } from "@/lib/db";
import { isDemo } from "@/lib/env";
import { clientIp, handleRouteError, json, rateLimit, readJson, sha256 } from "@/lib/security";
import { surveySchema } from "@/lib/validation";

const TOKEN = /^[a-f0-9]{64}$/;
const DEMO_TOKEN = "demo";

type Params = { params: Promise<{ token: string }> };

/** Lets the survey page show "expired or used" before the customer fills it in. */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  if (isDemo()) return json({ valid: token === DEMO_TOKEN, demo: true });
  if (!TOKEN.test(token)) return json({ valid: false }, 404);
  try {
    if (!(await rateLimit(`survey-view:${clientIp(request)}`, 60, 3600))) return json({ valid: false }, 429);
    const rows = await query(
      `SELECT 1 FROM surveys
       WHERE token_hash = $1 AND submitted_at IS NULL AND created_at > now() - interval '30 days'`,
      [sha256(token)],
    );
    return json({ valid: rows.length > 0 }, rows.length ? 200 : 404);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  if (isDemo()) return json({ error: "Demo mode does not save survey answers." }, 403);
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!TOKEN.test(token)) return json({ error: "This survey link is not valid." }, 404);
  try {
    if (!(await rateLimit(`survey:${clientIp(request)}`, 20, 3600))) {
      return json({ error: "Too many attempts. Please try later." }, 429);
    }
    const parsed = surveySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: "Choose a rating from 1 to 5 stars." }, 400);
    const rows = await query<{ lead_id: string }>(
      `UPDATE surveys SET rating = $2, feedback = $3, submitted_at = now()
       WHERE token_hash = $1 AND submitted_at IS NULL AND created_at > now() - interval '30 days'
       RETURNING lead_id`,
      [sha256(token), parsed.data.rating, parsed.data.feedback],
    );
    if (!rows.length) return json({ error: "This survey link has expired or was already used." }, 404);
    await recordEvent(rows[0].lead_id, "survey_completed", "survey", { rating: parsed.data.rating });
    return json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
