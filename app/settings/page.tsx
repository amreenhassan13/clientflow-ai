"use client";
import { useCallback, useEffect, useState } from "react";
import { Database, LockKeyhole, RefreshCw, RotateCcw, Workflow } from "lucide-react";
import Shell from "@/components/Shell";
import { dateTime } from "@/lib/format";
import type { HealthPayload } from "@/app/api/health/route";

const STATE_LABEL = { ready: "Configured", needs_setup: "Needs setup", off: "Turned off", demo: "Demo" } as const;
const STATE_CLASS = { ready: "connected", needs_setup: "needs-setup", off: "demo-status", demo: "demo-status" } as const;

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/login?next=/settings";
      return;
    }
    setHealth(await res.json());
  }, []);

  useEffect(() => {
    load().catch(() => setMessage("Could not load system health."));
  }, [load]);

  async function retryFailed() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/jobs/retry", { method: "POST" });
      const body = await res.json();
      setMessage(res.ok ? `${body.requeued} failed job(s) queued for another attempt.` : body.error);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!health) return <div className="loading">Checking integrations…</div>;

  return (
    <Shell demo={health.demo}>
      <div className="pagehead">
        <div>
          <div className="eyebrow">INTEGRATIONS & SECURITY</div>
          <h1>System health</h1>
          <p>Configuration is read from environment variables at request time.</p>
        </div>
        <div className="headbuttons">
          <button className="outline-btn" onClick={load}>
            <RefreshCw size={16} /> Recheck
          </button>
        </div>
      </div>

      <div className="kpis three">
        <div className="kpi">
          <div className="kpi-top">
            <span>Database</span>
            <span className="kpi-icon"><Database size={18} /></span>
          </div>
          <div className="kpi-value">{health.demo ? "Demo" : health.database.ok ? "Online" : "Offline"}</div>
          <div className="kpi-sub">
            {health.database.latencyMs !== null ? `${health.database.latencyMs} ms round trip` : health.database.error ?? "Not used in demo mode"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span>Queue</span>
            <span className="kpi-icon"><Workflow size={18} /></span>
          </div>
          <div className="kpi-value">{health.queue.pending}</div>
          <div className="kpi-sub">pending · {health.queue.processing} running</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span>Failed jobs</span>
            <span className="kpi-icon"><RotateCcw size={18} /></span>
          </div>
          <div className="kpi-value">{health.queue.failed}</div>
          <div className="kpi-sub">
            <button className="tiny-button link" onClick={retryFailed} disabled={busy || health.demo || !health.queue.failed}>
              Retry all failed
            </button>
          </div>
        </div>
      </div>
      {message && <div className="demo-banner">{message}</div>}

      <div className="setting-grid">
        {health.integrations.map((item) => (
          <div className="panel settingcard" key={item.key}>
            <div className="setting-head">
              <span className="setting-icon"><Workflow size={19} /></span>
              <span className={`integration-status ${STATE_CLASS[item.state]}`}>{STATE_LABEL[item.state]}</span>
            </div>
            <h2>{item.name}</h2>
            <p>{item.description}</p>
            <p className="setting-detail">{item.detail}</p>
          </div>
        ))}
      </div>

      {health.recentFailures.length > 0 && (
        <section className="panel security-panel">
          <h2>Recent failures</h2>
          <ul className="failure-list">
            {health.recentFailures.map((f, i) => (
              <li key={i}>
                <b>{f.kind}</b> · {dateTime(f.updatedAt)}
                <code>{f.error}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel security-panel">
        <h2>
          <LockKeyhole size={19} /> Security notes
        </h2>
        <p>
          Admin pages and APIs require a signed, HttpOnly 8-hour session. Browser writes must come from this site&apos;s origin, sign-in
          and public forms are rate limited, WordPress requests are HMAC signed with a 5-minute window and an idempotency key, and Twilio
          callbacks are signature checked.
        </p>
        <p>
          Public URL: <code>{health.settings.appUrl ?? "APP_URL not set"}</code> · Reporting time zone: <code>{health.settings.timeZone}</code>
        </p>
      </section>
    </Shell>
  );
}
