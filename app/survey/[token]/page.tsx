"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Star, TimerOff } from "lucide-react";

export default function SurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"checking" | "open" | "invalid" | "sent">("checking");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/survey/${token}`)
      .then((r) => r.json())
      .then((b) => setState(b.valid ? "open" : "invalid"))
      .catch(() => setState("invalid"));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError("Tap a star to choose your rating.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/survey/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, feedback }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your feedback.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        {state === "checking" && <p>Loading…</p>}
        {state === "invalid" && (
          <>
            <TimerOff color="#c47a5a" size={40} />
            <h1>Link not available</h1>
            <p>This survey link has expired or was already used. Thank you for being a customer.</p>
          </>
        )}
        {state === "sent" && (
          <>
            <CheckCircle2 color="#20b28a" size={40} />
            <h1>Thank you!</h1>
            <p>Your feedback has been received.</p>
          </>
        )}
        {state === "open" && (
          <form onSubmit={submit}>
            <h1>How did we do?</h1>
            <p>Your rating helps us improve.</p>
            <div className="stars" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  onClick={() => setRating(n)}
                >
                  <Star fill={n <= rating ? "#efa928" : "none"} color={n <= rating ? "#efa928" : "#cdd5dd"} size={34} />
                </button>
              ))}
            </div>
            <label>
              Anything else? (optional)
              <textarea rows={4} maxLength={1200} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </label>
            {error && <p className="formerror" role="alert">{error}</p>}
            <button className="dark-btn full" disabled={busy}>
              {busy ? "Sending…" : "Submit feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
