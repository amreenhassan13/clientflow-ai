"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, Clock3, Database, Download, MessageSquareText,
  RefreshCw, TrendingUp, Users, Wallet, Workflow, type LucideIcon,
} from "lucide-react";
import Shell from "./Shell";
import { PERIODS, type AnalyticsPayload } from "@/lib/analytics";
import { dateTime, delta, money, percent, shortDate, sourceLabel } from "@/lib/format";

const COLORS = ["#37c7a4", "#6e8df5", "#f0ad6e", "#b58cf4", "#8493a8", "#e57f8f"];

function Kpi(props: {
  label: string;
  value: string;
  icon: LucideIcon;
  sub: string;
  change?: { label: string; up: boolean } | null;
}) {
  const { label, value, icon: Icon, sub, change } = props;
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
        <span className="kpi-icon">
          <Icon size={18} />
        </span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">
        {change && (
          <span className={change.up ? "up" : "down"} title="Compared with the previous period">
            {change.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {change.label}
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (period: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/analytics?days=${period}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login?next=/";
        return;
      }
      if (!res.ok) throw new Error("The analytics service did not respond. Check the database connection on the Integrations page.");
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  if (error && !data) {
    return (
      <Shell>
        <div className="panel error-panel">
          <h2>Could not load the dashboard</h2>
          <p>{error}</p>
          <button className="outline-btn" onClick={() => load(days)}>
            <RefreshCw size={16} /> Try again
          </button>
        </div>
      </Shell>
    );
  }
  if (!data) return <div className="loading">Loading your command center…</div>;

  const k = data.kpis;
  const maxSource = Math.max(1, ...data.sources.map((s) => s.value));
  const pipelineTotal = Math.max(1, data.pipeline.reduce((t, p) => t + p.value, 0));
  const hubspotAttempted = data.health.hubspotSynced + data.health.hubspotFailed;
  const trend = data.trend.map((t) => ({ ...t, label: shortDate(t.day) }));

  return (
    <Shell demo={data.demo}>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            BUSINESS INTELLIGENCE <span>●</span> LAST {data.periodDays} DAYS
          </div>
          <h1>Business overview</h1>
          <p>
            Pipeline performance for the selected period. Updated {dateTime(data.generatedAt)}
            {data.timeZone !== "UTC" ? ` (${data.timeZone})` : ""}.
          </p>
        </div>
        <div className="headbuttons">
          <label className="period-select">
            <span className="sr-only">Period</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Reporting period">
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  Last {p} days
                </option>
              ))}
            </select>
          </label>
          <button className="outline-btn" onClick={() => load(days)} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
          <a className="dark-btn" href="/api/leads/export">
            <Download size={16} /> Export leads
          </a>
        </div>
      </div>

      {data.demo && (
        <div className="demo-banner">
          <BadgeCheck size={16} /> Demo mode. Every name and number here is generated sample data.
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}

      <div className="kpis">
        <Kpi
          label="New leads"
          value={k.leads.toLocaleString()}
          icon={Users}
          change={delta(k.leads, k.leadsPrev)}
          sub={`vs ${k.leadsPrev.toLocaleString()} previous period`}
        />
        <Kpi
          label="Open qualified"
          value={k.qualifiedOpen.toLocaleString()}
          icon={BadgeCheck}
          sub={`${money(k.qualifiedOpenValue)} in estimates`}
        />
        <Kpi
          label="Won revenue"
          value={money(k.wonValue)}
          icon={Wallet}
          change={delta(k.wonValue, k.wonValuePrev)}
          sub={`${k.wonCount} deals closed (estimated value)`}
        />
        <Kpi
          label="Win conversion"
          value={percent(k.conversion)}
          icon={TrendingUp}
          change={delta(k.conversion, k.conversionPrev)}
          sub="of this period's leads are won"
        />
      </div>

      <div className="chartgrid">
        <section className="panel">
          <div className="panelhead">
            <div>
              <h2>Lead acquisition trend</h2>
              <p>New leads per day, and how many are qualified or won now</p>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: "#34c7a5" }} /> All leads
              </span>
              <span>
                <i style={{ background: "#7992ed" }} /> Qualified or won
              </span>
            </div>
          </div>
          <div className="chartarea">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 14, left: -22, right: 3, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#35c9a6" stopOpacity=".23" />
                    <stop offset="100%" stopColor="#35c9a6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#edf1f5" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a0af" }} minTickGap={18} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a0af" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e6edf1" }} />
                <Area type="monotone" dataKey="leads" name="All leads" stroke="#35c9a6" strokeWidth={3} fill="url(#leadGrad)" />
                <Area type="monotone" dataKey="qualified" name="Qualified or won" stroke="#7992ed" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="panelhead">
            <div>
              <h2>Acquisition channels</h2>
              <p>Lead source for this period</p>
            </div>
          </div>
          <div className="source-list">
            {data.sources.map((s, i) => (
              <div className="source" key={s.name}>
                <div className="source-row">
                  <span className="source-dot" style={{ background: COLORS[i % COLORS.length] }} />
                  <span>{sourceLabel(s.name)}</span>
                  <b>{s.value}</b>
                </div>
                <div className="track">
                  <div className="trackfill" style={{ width: `${(s.value / maxSource) * 100}%`, background: COLORS[i % COLORS.length] }} />
                </div>
              </div>
            ))}
            {!data.sources.length && <p className="empty">No leads in this period yet.</p>}
          </div>
        </section>
      </div>

      <div className="chartgrid lower">
        <section className="panel">
          <div className="panelhead">
            <div>
              <h2>Pipeline today</h2>
              <p>Every lead by its current stage</p>
            </div>
            <span className="smallbadge">ALL TIME</span>
          </div>
          <div className="pipeline">
            {data.pipeline.map((stage, i) => (
              <div className="pipe" key={stage.name}>
                <div className="pipe-label">
                  <span>
                    <i style={{ background: COLORS[i] }} />
                    <span className="capitalize">{stage.name}</span>
                  </span>
                  <b>{stage.value}</b>
                </div>
                <div className="track">
                  <div className="trackfill" style={{ width: `${(stage.value / pipelineTotal) * 100}%`, background: COLORS[i] }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelhead">
            <div>
              <h2>Service demand</h2>
              <p>Requested services this period</p>
            </div>
            <span className="smallbadge">LEAD MIX</span>
          </div>
          <div className="servicechart">
            {data.services.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.services} layout="vertical" margin={{ left: 4, right: 25, top: 5, bottom: 0 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fill: "#778499", fontSize: 11 }} axisLine={false} tickLine={false} width={135} />
                  <Tooltip />
                  <Bar dataKey="value" name="Leads" radius={[0, 5, 5, 0]}>
                    {data.services.map((s, i) => (
                      <Cell key={s.name} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty">No leads in this period yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="chartgrid lower">
        <section className="panel">
          <div className="panelhead">
            <div>
              <h2>Integration health</h2>
              <p>Delivery indicators across all leads</p>
            </div>
            <Workflow size={19} color="#7c899c" />
          </div>
          <div className="health-rows">
            <div>
              <span>
                <span className="health-icon mint"><BadgeCheck size={16} /></span>
                HubSpot contact sync
              </span>
              <b>
                {hubspotAttempted ? percent(data.health.hubspotSynced / hubspotAttempted) : "–"}{" "}
                <em>{data.health.hubspotNotConfigured ? `${data.health.hubspotNotConfigured} waiting for setup` : `${data.health.hubspotFailed} failed`}</em>
              </b>
            </div>
            <div>
              <span>
                <span className="health-icon blue"><MessageSquareText size={16} /></span>
                SMS delivery rate
              </span>
              <b>
                {data.health.smsSent ? percent(data.health.smsDelivered / data.health.smsSent) : "–"}{" "}
                <em>of {data.health.smsSent} sent · {data.health.optedOut} opted out</em>
              </b>
            </div>
            <div>
              <span>
                <span className="health-icon gold"><Database size={16} /></span>
                BigQuery export
              </span>
              <b>
                {data.exports.pending} <em>waiting · last {data.exports.lastExportAt ? dateTime(data.exports.lastExportAt) : "never"}</em>
              </b>
            </div>
            <div>
              <span>
                <span className="health-icon violet"><Clock3 size={16} /></span>
                Background queue
              </span>
              <b>
                {data.queue.pending} <em>pending · {data.queue.failed} failed</em>
              </b>
            </div>
          </div>
          <p className="panel-foot">
            SMS delivery rate counts welcome messages actually sent. Leads without consent or a valid mobile number are excluded.
          </p>
        </section>

        <section className="panel">
          <div className="panelhead">
            <div>
              <h2>Performance signals</h2>
              <p>Ratios for the selected period</p>
            </div>
            <TrendingUp size={19} color="#7c899c" />
          </div>
          <div className="insight-rows">
            <div>
              <span>Average won deal (all time)</span>
              <b>{money(k.averageDeal)}</b>
            </div>
            <div>
              <span>Won revenue per new lead</span>
              <b>{money(k.leads ? k.wonValue / k.leads : 0)}</b>
            </div>
            <div>
              <span>Lost ratio of new leads</span>
              <b>{percent(k.lostRatio)}</b>
            </div>
            <div>
              <span>Previous period conversion</span>
              <b>{percent(k.conversionPrev)}</b>
            </div>
          </div>
          <p className="panel-foot">
            Revenue is the estimated deal value staff enter on the Leads page, counted on the day a lead is marked won. It is not invoiced income.
          </p>
        </section>
      </div>
    </Shell>
  );
}
