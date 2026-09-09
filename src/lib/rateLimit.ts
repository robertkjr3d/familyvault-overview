// Wraps Cloudflare Workers' native RateLimit binding (declared in wrangler.jsonc under
// "ratelimits") for use inside TanStack Start server functions. Uses the `cloudflare:workers`
// module's `env` export rather than threading `env` through function parameters — this is the
// pattern @cloudflare/vite-plugin (already a dependency here, see vite.config.ts) is built to
// support, so bindings are reachable from anywhere in the Worker, not just the top-level fetch
// handler. This is the one part of this feature I could not verify by running an actual
// Cloudflare Workers runtime — everything else in this file was checked against real type
// definitions or the app's own existing code; this specific binding-resolution path needs a
// live test after deploy (see the comment on checkRateLimit below for exactly what to check).
//
// Cloudflare's rate-limit period can ONLY be 10 or 60 seconds — there is no native "N per
// hour"/"N per day" option without extra infrastructure (Durable Objects/KV), so every limit
// here is expressed as a 60-second window. That's a real platform constraint, not a choice.

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

// Fails OPEN, not closed — same philosophy already applied to the Turnstile captcha in
// __root.tsx ("this app must not become permanently un-usable over it"). If the binding is
// missing (e.g. a local/dev environment without it configured) or the call itself throws,
// the action proceeds rather than blocking every real user because of an infra hiccup.
export async function checkRateLimit(bindingName: string, key: string): Promise<boolean> {
  try {
    // @ts-expect-error -- `cloudflare:workers` has no bundled type declarations in this
    // project; the shape is asserted below instead. Dynamic import so this file doesn't
    // break any non-Workers context (e.g. vitest) that can't resolve this module at all.
    const { env } = await import("cloudflare:workers");
    const binding = (env as Record<string, unknown>)[bindingName] as RateLimitBinding | undefined;
    if (!binding) return true; // not configured (e.g. local dev) — allow

    const { success } = await binding.limit({ key });
    return success;
  } catch {
    return true; // binding resolution failed for any reason — fail open, log nothing user-facing
  }
}
