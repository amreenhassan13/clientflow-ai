import { sameOrigin } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { processLeadSoon } from "@/lib/intake";
import { addLead } from "@/lib/leads";
import { clientIp, handleRouteError, json, rateLimit, readJson } from "@/lib/security";
import { leadSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    if (isDemo()) {
      return json({ error: "Demo mode does not accept real customer details." }, 403);
    }
    if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
    if (!(await rateLimit(`lead:${clientIp(request)}`, 10, 3600))) {
      return json({ error: "Too many requests. Please try again later." }, 429);
    }

    const parsed = leadSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return json({ error: "Please check the highlighted fields.", fields: parsed.error.flatten().fieldErrors }, 400);
    }
    // Honeypot filled in: pretend success so bots learn nothing.
    if (parsed.data.website) return json({ ok: true }, 201);

    const { id, duplicate } = await addLead(parsed.data);
    if (!duplicate) processLeadSoon(id);
    return json({ ok: true, id, duplicate }, duplicate ? 200 : 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
