import { getSession } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { json } from "@/lib/security";

export async function GET() {
  const session = isDemo() ? null : await getSession();
  return json({ demo: isDemo(), authenticated: Boolean(session), email: session?.email ?? null });
}
