import "server-only";
import { createHash } from "node:crypto";
import { query } from "./db";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Vercel sets x-real-ip; x-forwarded-for is the fallback for other hosts. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Fixed-window limiter stored in PostgreSQL. Returns true when the request may proceed. */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const rows = await query<{ count: number }>(
    `INSERT INTO rate_limits (key_hash, count, window_start)
     VALUES ($1, 1, now())
     ON CONFLICT (key_hash) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2)
                    THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2)
                    THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [sha256(key), windowSeconds],
  );
  return rows[0].count <= max;
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function publicError(error: unknown): Response {
  console.error(error);
  return json({ error: "An internal error occurred." }, 500);
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Payload too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handleRouteError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  return publicError(error);
}
