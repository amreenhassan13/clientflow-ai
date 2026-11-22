"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { SERVICES } from "@/lib/constants";

const BUSINESS = process.env.NEXT_PUBLIC_BUSINESS_NAME || "Coastal Clean Co.";

type FieldErrors = Partial<Record<string, string[]>>;

export default function QuotePage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string>("");
  const source = useRef("website");

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
    const params = new URLSearchParams(window.location.search);
    source.current = (params.get("utm_source") || params.get("source") || "website").slice(0, 80);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    const form = new FormData(e.currentTarget);
    const payload = {
      full_name: String(form.get("full_name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      service: String(form.get("service") ?? ""),
      notes: String(form.get("notes") ?? ""),
      website: String(form.get("website") ?? ""),
      sms_consent: form.has("sms_consent"),
      source: source.current,
      idempotency_key: idempotencyKey.current,
    };
    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFields(body.fields ?? {});
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      setSent(true);
      idempotencyKey.current = crypto.randomUUID();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (name: string) =>
    fields[name]?.length ? <span className="field-error">{fields[name]![0]}</span> : null;

  return (
    <div className="quote-screen">
      <div className="quote-layout">
        <div className="quote-hero">
          <span className="quote-tag">{BUSINESS.toUpperCase()}</span>
          <h1>
            A cleaner space. <em>A better day.</em>
          </h1>
          <p>Tell us about your space and we&apos;ll come back with a tailored cleaning estimate.</p>
          <div className="trust">
            <ShieldCheck size={18} /> Your details are only used to answer this enquiry.
          </div>
        </div>
        <div className="quote-card">
          {sent ? (
            <div className="quote-done">
              <CheckCircle2 size={45} color="#18aa87" />
              <h2>Request received</h2>
              <p>Thanks! We&apos;ll be in touch shortly. If you opted in to SMS, a confirmation text is on its way.</p>
              <button className="outline-btn" onClick={() => setSent(false)}>
                Send another request
              </button>
            </div>
          ) : (
            <>
              <h2>Get a free quote</h2>
              <p>Takes less than two minutes.</p>
              <form onSubmit={submit} noValidate={false}>
                <label>
                  Full name
                  <input required name="full_name" minLength={2} maxLength={120} autoComplete="name" />
                  {fieldError("full_name")}
                </label>
                <label>
                  Email address
                  <input required type="email" name="email" maxLength={254} autoComplete="email" />
                  {fieldError("email")}
                </label>
                <label>
                  Mobile (with country code)
                  <input name="phone" type="tel" placeholder="+61 400 000 000" maxLength={35} autoComplete="tel" />
                  {fieldError("phone")}
                </label>
                <label>
                  What do you need?
                  <select name="service" required defaultValue={SERVICES[0]}>
                    {SERVICES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tell us more
                  <textarea name="notes" maxLength={1600} placeholder="Bedrooms, preferred date, anything special…" rows={3} />
                </label>
                <div className="hp" aria-hidden="true">
                  <label>
                    Leave this empty
                    <input type="text" name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>
                <label className="consent">
                  <input name="sms_consent" type="checkbox" />
                  Text me updates about this enquiry. Message and data rates may apply. Reply STOP to opt out.
                </label>
                {error && <p className="formerror" role="alert">{error}</p>}
                <button className="dark-btn" disabled={busy}>
                  {busy ? "Sending…" : "Request my quote"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
