import "server-only";
import { PermanentError, RetryableError } from "../errors";
import { isE164 } from "../phone";

export function hubspotConfigured(): boolean {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
}

type HubSpotLead = {
  email: string;
  full_name: string;
  phone: string | null;
  service: string;
  source: string;
};

function contactsBase(): string {
  const version = process.env.HUBSPOT_API_VERSION || "2026-09";
  if (!/^\d{4}-\d{2}$/.test(version)) throw new PermanentError("HUBSPOT_API_VERSION must look like 2026-09");
  // HUBSPOT_API_BASE exists only for local testing against a mock server.
  const host = (process.env.HUBSPOT_API_BASE || "https://api.hubapi.com").replace(/\/+$/, "");
  return `${host}/crm/objects/${version}/contacts`;
}

async function hubspotFetch(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    throw new RetryableError(`HubSpot request failed: ${(err as Error).message}`);
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after")) || 60;
    throw new RetryableError("HubSpot rate limit reached", retryAfter);
  }
  if (response.status >= 500) throw new RetryableError(`HubSpot server error (${response.status})`);
  if (response.status === 401 || response.status === 403) {
    throw new PermanentError(`HubSpot rejected the token or scopes (${response.status})`);
  }
  return response;
}

function contactProperties(lead: HubSpotLead): Record<string, string> {
  const [firstname, ...rest] = lead.full_name.trim().split(/\s+/);
  const properties: Record<string, string> = { email: lead.email, firstname, lastname: rest.join(" ") };
  if (isE164(lead.phone)) properties.phone = lead.phone;
  // Optional custom properties. Create them in HubSpot first, then set their internal names here.
  if (process.env.HUBSPOT_PROPERTY_SERVICE) properties[process.env.HUBSPOT_PROPERTY_SERVICE] = lead.service;
  if (process.env.HUBSPOT_PROPERTY_SOURCE) properties[process.env.HUBSPOT_PROPERTY_SOURCE] = lead.source;
  return properties;
}

/** Finds the contact by email and updates it, or creates it. Safe to retry. */
export async function upsertHubSpotContact(lead: HubSpotLead): Promise<string> {
  const base = contactsBase();
  const properties = contactProperties(lead);

  const search = await hubspotFetch(`${base}/search`, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }],
      properties: ["email"],
      limit: 1,
    }),
  });
  if (!search.ok) throw new PermanentError(`HubSpot search failed (${search.status}): ${await search.text()}`);
  const found = (await search.json()) as { results?: { id: string }[] };
  let contactId = found.results?.[0]?.id;

  if (!contactId) {
    const created = await hubspotFetch(base, { method: "POST", body: JSON.stringify({ properties }) });
    if (created.ok) return ((await created.json()) as { id: string }).id;
    const body = await created.text();
    // Another request may have created the contact after our search.
    const existing = created.status === 409 ? body.match(/Existing ID:\s*(\d+)/i)?.[1] : undefined;
    if (!existing) throw new PermanentError(`HubSpot create failed (${created.status}): ${body.slice(0, 300)}`);
    contactId = existing;
  }

  const updated = await hubspotFetch(`${base}/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  if (!updated.ok) {
    throw new PermanentError(`HubSpot update failed (${updated.status}): ${(await updated.text()).slice(0, 300)}`);
  }
  return contactId;
}
