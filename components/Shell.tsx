"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartNoAxesCombined, ExternalLink, LayoutDashboard, LogOut, Users, Workflow } from "lucide-react";

const NAV = [
  { href: "/", icon: LayoutDashboard, label: "Overview" },
  { href: "/leads", icon: Users, label: "Lead management" },
  { href: "/settings", icon: Workflow, label: "Integrations & health" },
];

const BUSINESS = process.env.NEXT_PUBLIC_BUSINESS_NAME || "Coastal Clean Co.";

export default function Shell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = NAV.find((item) => item.href === pathname)?.label ?? "Overview";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brandmark">
            <ChartNoAxesCombined size={21} />
          </span>
          <span>
            clientflow<span className="brand-ai">.ai</span>
            <small>COMMAND CENTER</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-icon">{BUSINESS.charAt(0)}</span>
          <span>
            <b>{BUSINESS}</b>
            <small>Business workspace</small>
          </span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`navitem ${pathname === item.href ? "active" : ""}`}>
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="nav-label bottomlabel">RESOURCES</div>
        <nav>
          <a className="navitem" href="/quote" target="_blank" rel="noreferrer">
            <ExternalLink size={18} />
            Public quote form
          </a>
        </nav>
        <div className="sidebar-foot">
          <div className={`health-dot ${demo ? "demo" : ""}`} />
          <span>
            {demo ? "Demo workspace" : "Live workspace"}
            <small>{demo ? "Synthetic data, read-only" : "Connected to PostgreSQL"}</small>
          </span>
        </div>
      </aside>
      <div className="mainframe">
        <header className="topbar">
          <div className="crumb">
            Workspace <span>/</span> {current}
          </div>
          <div className="top-actions">
            {demo && <span className="demo-pill">● DEMO DATA</span>}
            <nav className="mobile-nav" aria-label="Sections">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""} aria-label={item.label}>
                  <item.icon size={18} />
                </Link>
              ))}
            </nav>
            {!demo && (
              <button className="tiny-button" onClick={logout} title="Sign out" aria-label="Sign out">
                <LogOut size={17} />
              </button>
            )}
          </div>
        </header>
        <main className="maincontent">{children}</main>
      </div>
    </div>
  );
}
