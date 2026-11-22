import { getSession, sameOrigin } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { updateLead } from "@/lib/leads";
import { handleRouteError, json, readJson } from "@/lib/security";
import { leadUpdateSchema } from "@/lib/validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isDemo()) return json({ error: "Demo mode is read-only. Changes are not saved." }, 403);
  if (!sameOrigin(request) || !(await getSession())) return json({ error: "Your session has expired. Sign in again." }, 401);
  try {
    const { id } = await params;
    if (!UUID.test(id)) return json({ error: "Invalid lead id" }, 400);
    const parsed = leadUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid update" }, 400);
    const result = await updateLead(id, parsed.data);
    if (!result) return json({ error: "Lead not found" }, 404);
    return json({ ok: true, ...result, estimated_value: Number(result.estimated_value) });
  } catch (err) {
    return handleRouteError(err);
  }
}
