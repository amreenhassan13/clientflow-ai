import { endSession, sameOrigin } from "@/lib/auth";
import { json } from "@/lib/security";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  await endSession();
  return json({ ok: true });
}
