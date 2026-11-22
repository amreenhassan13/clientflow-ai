import { getSession } from "@/lib/auth";
import { generateDemoLeads } from "@/lib/demo";
import { isDemo } from "@/lib/env";
import { listLeads } from "@/lib/leads";
import { json, publicError } from "@/lib/security";

export async function GET() {
  if (isDemo()) return json({ demo: true, leads: generateDemoLeads() });
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);
  try {
    const leads = await listLeads(1000);
    return json({ demo: false, leads: leads.map((l) => ({ ...l, estimated_value: Number(l.estimated_value) })) });
  } catch (err) {
    return publicError(err);
  }
}
