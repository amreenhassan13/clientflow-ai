// End-to-end smoke test against a running, non-demo deployment.
// It creates a few clearly labelled test leads ("Smoke Test ...").
//
// Usage:
//   BASE_URL=https://your-app.vercel.app ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   WORDPRESS_WEBHOOK_SECRET=... CRON_SECRET=... npm run test:smoke
import { createHmac, randomUUID } from "node:crypto";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const { ADMIN_EMAIL, ADMIN_PASSWORD, WORDPRESS_WEBHOOK_SECRET, CRON_SECRET } = process.env;
const ORIGIN = new URL(BASE).origin;
let failures = 0;
let cookie = "";

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function call(path, { method = "GET", body, headers = {}, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
}

function signed(body) {
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", WORDPRESS_WEBHOOK_SECRET).update(`${ts}.${raw}`).digest("hex");
  return { raw, headers: { "Content-Type": "application/json", "X-Clientflow-Timestamp": ts, "X-Clientflow-Signature": sig } };
}

const session = await call("/api/auth/session");
if (session.json?.demo) {
  console.log("Deployment is in demo mode; only read-only checks apply.");
  check("demo analytics", (await call("/api/analytics?days=30")).status === 200);
  check("demo leads", (await call("/api/leads")).json?.leads?.length > 0);
  process.exit(failures ? 1 : 0);
}

// Public intake
const key = randomUUID();
const lead = { full_name: "Smoke Test Public", email: `smoke+${Date.now()}@example.com`, phone: "0400 000 000", service: "Deep cleaning", sms_consent: true, idempotency_key: key };
const created = await call("/api/public/lead", { method: "POST", body: lead, headers: { Origin: ORIGIN } });
check("public lead created", created.status === 201, `status ${created.status}`);
const again = await call("/api/public/lead", { method: "POST", body: lead, headers: { Origin: ORIGIN } });
check("double submit returns the same lead", again.status === 200 && again.json?.id === created.json?.id);
check("cross-origin submit rejected", (await call("/api/public/lead", { method: "POST", body: lead, headers: { Origin: "https://evil.example" } })).status === 403);
check("invalid fields rejected", (await call("/api/public/lead", { method: "POST", body: { full_name: "X", email: "bad", service: "Pizza" }, headers: { Origin: ORIGIN } })).status === 400);

// WordPress intake
if (WORDPRESS_WEBHOOK_SECRET) {
  const wp = signed({ full_name: "Smoke Test WordPress", email: `smoke-wp+${Date.now()}@example.com`, service: "Other", sms_consent: false, idempotency_key: randomUUID() });
  const first = await call("/api/webhooks/wordpress", { method: "POST", raw: wp.raw, headers: wp.headers });
  check("signed WordPress lead created", first.status === 201, `status ${first.status}`);
  const replay = await call("/api/webhooks/wordpress", { method: "POST", raw: wp.raw, headers: wp.headers });
  check("replayed WordPress request is idempotent", replay.status === 200 && replay.json?.id === first.json?.id);
  check("bad signature rejected", (await call("/api/webhooks/wordpress", { method: "POST", raw: wp.raw, headers: { ...wp.headers, "X-Clientflow-Signature": "0".repeat(64) } })).status === 401);
} else {
  console.log("SKIP  WordPress checks (WORDPRESS_WEBHOOK_SECRET not set)");
}

// Auth and admin APIs
check("leads API needs a session", (await call("/api/leads")).status === 401);
check("dashboard page redirects to login", [302, 307].includes((await call("/")).status));
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  check("wrong password rejected", (await call("/api/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: "definitely-wrong" }, headers: { Origin: ORIGIN } })).status === 401);
  const login = await call("/api/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, headers: { Origin: ORIGIN } });
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("admin login", login.status === 200 && cookie.startsWith("clientflow_session="));
  const analytics = await call("/api/analytics?days=7");
  check("analytics loads", analytics.status === 200 && typeof analytics.json?.kpis?.leads === "number");
  const id = created.json?.id;
  if (id) {
    const valued = await call(`/api/leads/${id}`, { method: "PATCH", body: { estimated_value: 450 }, headers: { Origin: ORIGIN } });
    check("deal value saved", valued.status === 200 && valued.json?.estimated_value === 450);
    const won = await call(`/api/leads/${id}`, { method: "PATCH", body: { status: "won" }, headers: { Origin: ORIGIN } });
    check("lead marked won and survey scheduled", won.status === 200 && won.json?.surveyScheduled === true);
    const after = await call("/api/analytics?days=7");
    check("won revenue includes the deal", after.json?.kpis?.wonValue >= 450);
  }
  check("health endpoint", (await call("/api/health")).json?.database?.ok === true);
  check("CSV export", (await call("/api/leads/export")).status === 200);
} else {
  console.log("SKIP  admin checks (ADMIN_EMAIL / ADMIN_PASSWORD not set)");
}

// Webhook and cron protection
check("unsigned Twilio callback rejected", (await call("/api/webhooks/twilio", { method: "POST", raw: "MessageSid=SM1&MessageStatus=delivered", headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status === 401);
check("cron needs its secret", (await call("/api/cron/process")).status === 401);
if (CRON_SECRET) {
  const cron = await call("/api/cron/process", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  check("cron run", cron.status === 200, JSON.stringify(cron.json));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
