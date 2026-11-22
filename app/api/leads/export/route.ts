import { getSession } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { generateDemoLeads } from "@/lib/demo";
import { isDemo } from "@/lib/env";
import { allLeadsForExport } from "@/lib/leads";
import { publicError } from "@/lib/security";

const HEADERS = [
  "id", "created_at", "full_name", "email", "phone", "service", "source", "status",
  "estimated_value", "won_at", "sms_consent", "hubspot", "sms", "notes",
];

export async function GET() {
  if (!isDemo() && !(await getSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const leads = isDemo() ? generateDemoLeads() : await allLeadsForExport();
    const csv = toCsv(
      HEADERS,
      leads.map((l) => [
        l.id, l.created_at, l.full_name, l.email, l.phone, l.service, l.source, l.status,
        l.estimated_value, l.won_at, l.sms_consent, l.integration_hubspot, l.integration_sms, l.notes,
      ]),
    );
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clientflow-leads-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return publicError(err);
  }
}
