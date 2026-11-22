"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Plus, Search } from "lucide-react";
import Shell from "@/components/Shell";
import { dateTime, money, sourceLabel, statusLabel } from "@/lib/format";
import { STATUSES, type LeadStatus } from "@/lib/constants";

type Lead = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  service: string;
  source: string;
  notes: string;
  status: LeadStatus;
  estimated_value: number;
  created_at: string;
  integration_hubspot: string;
  integration_sms: string;
};

const GOOD = new Set(["synced", "delivered", "sent", "queued", "accepted"]);
const BAD = new Set(["failed", "undelivered"]);
const PAGE_SIZE = 50;

function stateClass(value: string) {
  return GOOD.has(value) ? "good" : BAD.has(value) ? "bad" : "";
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [demo, setDemo] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<"all" | LeadStatus>("all");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/leads", { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login?next=/leads";
          return null;
        }
        return r.json();
      })
      .then((body) => {
        if (!body) return;
        setLeads(body.leads);
        setDemo(body.demo);
        setLoaded(true);
      })
      .catch(() => setToast({ text: "Could not load leads.", error: true }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (status === "all" || l.status === status) &&
        (!term || `${l.full_name} ${l.email} ${l.service} ${l.source} ${l.phone ?? ""}`.toLowerCase().includes(term)),
    );
  }, [leads, filter, status]);

  async function save(lead: Lead, change: { status?: LeadStatus; estimated_value?: number }) {
    setBusy(lead.id);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Update failed");
      setLeads((all) =>
        all.map((l) => (l.id === lead.id ? { ...l, status: body.status, estimated_value: body.estimated_value } : l)),
      );
      if (body.surveyScheduled) {
        setToast({ text: `${lead.full_name} marked won. Survey SMS scheduled for 24 hours from now (if they consented).` });
      } else if (change.status === "won" && !body.estimated_value) {
        setToast({ text: "Marked won. Add the deal value so it counts towards revenue." });
      } else {
        setToast({ text: "Saved." });
      }
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "Update failed", error: true });
    } finally {
      setBusy("");
    }
  }

  function commitValue(lead: Lead) {
    const raw = drafts[lead.id];
    if (raw === undefined) return;
    setDrafts(({ [lead.id]: _omit, ...rest }) => rest);
    const value = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(value) || value < 0) {
      setToast({ text: "Enter a value of 0 or more.", error: true });
      return;
    }
    if (value !== lead.estimated_value) save(lead, { estimated_value: value });
  }

  return (
    <Shell demo={demo}>
      <div className="pagehead">
        <div>
          <div className="eyebrow">CUSTOMER OPERATIONS</div>
          <h1>Lead management</h1>
          <p>Move each enquiry through the pipeline and record the deal value when you quote.</p>
        </div>
        <div className="headbuttons">
          <a href="/api/leads/export" className="outline-btn">
            <Download size={16} /> CSV
          </a>
          <Link href="/quote" className="dark-btn" target="_blank">
            <Plus size={17} /> Quote form
          </Link>
        </div>
      </div>

      {demo && (
        <div className="demo-banner">Demo mode is read-only. Status and value controls are disabled.</div>
      )}

      <section className="panel tablepanel">
        <div className="tabletools">
          <div className="searchfield">
            <Search size={17} />
            <input
              aria-label="Search leads"
              placeholder="Search name, email, phone, service…"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setVisible(PAGE_SIZE);
              }}
            />
          </div>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>CONTACT</th>
                <th>REQUEST</th>
                <th>SOURCE</th>
                <th>RECEIVED</th>
                <th>EST. VALUE</th>
                <th>HUBSPOT</th>
                <th>SMS</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, visible).map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="table-name">{l.full_name}</div>
                    <small>{l.email}</small>
                    {l.phone && <small className="block">{l.phone}</small>}
                  </td>
                  <td>
                    {l.service}
                    {l.notes && (
                      <small className="block notes" title={l.notes}>
                        {l.notes}
                      </small>
                    )}
                  </td>
                  <td>{sourceLabel(l.source)}</td>
                  <td>{dateTime(l.created_at)}</td>
                  <td>
                    {demo ? (
                      money(l.estimated_value)
                    ) : (
                      <input
                        className="value-input"
                        type="number"
                        min={0}
                        step="10"
                        inputMode="decimal"
                        aria-label={`Estimated value for ${l.full_name}`}
                        value={drafts[l.id] ?? String(l.estimated_value)}
                        disabled={busy === l.id}
                        onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                        onBlur={() => commitValue(l)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    )}
                  </td>
                  <td>
                    <span className={`dot-status ${stateClass(l.integration_hubspot)}`}>{statusLabel(l.integration_hubspot)}</span>
                  </td>
                  <td>
                    <span className={`dot-status ${stateClass(l.integration_sms)}`}>{statusLabel(l.integration_sms)}</span>
                  </td>
                  <td>
                    <select
                      className={`status-select ${l.status}`}
                      disabled={demo || busy === l.id}
                      value={l.status}
                      aria-label={`Status for ${l.full_name}`}
                      onChange={(e) => save(l, { status: e.target.value as LeadStatus })}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {loaded && !shown.length && (
                <tr>
                  <td colSpan={8} className="empty">
                    {leads.length ? "No leads match your search." : "No leads yet. Submit the quote form to create one."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-bottom">
          Showing {Math.min(visible, shown.length)} of {shown.length} matching ({leads.length} loaded)
          {visible < shown.length && (
            <button className="tiny-button more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              Show more
            </button>
          )}
        </div>
      </section>

      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.text}
        </div>
      )}
    </Shell>
  );
}
