"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChartNoAxesCombined, LockKeyhole } from "lucide-react";

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => {
        if (s.demo) setDemo(true);
        else if (s.authenticated) window.location.replace(safeNext());
      })
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sign-in failed.");
      window.location.replace(safeNext());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form onSubmit={submit} className="login-card">
        <span className="brandmark">
          <ChartNoAxesCombined />
        </span>
        <h1>Welcome back</h1>
        {demo ? (
          <>
            <p>This deployment is running in demo mode, so there is nothing to sign in to.</p>
            <Link className="dark-btn full" href="/">
              Open the demo dashboard
            </Link>
          </>
        ) : (
          <>
            <p>Sign in to your ClientFlow workspace.</p>
            <label>
              Email
              <input autoComplete="username" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p className="formerror" role="alert">{error}</p>}
            <button disabled={busy} className="dark-btn">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </>
        )}
        <small>
          <LockKeyhole size={13} /> Single administrator account
        </small>
      </form>
    </div>
  );
}
