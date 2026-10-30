export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Public origin for redirects. A configured NEXT_PUBLIC_APP_URL always wins —
 * x-forwarded-host is client-controllable and could poison emailed links and
 * auth redirects. Behind a proxy without it, the forwarded host is the real
 * one (request.url is the container's internal address).
 */
export function requestOrigin(request: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const fwdHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (fwdHost)
    return `${request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? "https"}://${fwdHost}`;
  return new URL(request.url).origin;
}
