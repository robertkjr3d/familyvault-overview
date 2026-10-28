// Use THIS instead of `requireSupabaseAuth` on every server function.
//
// Why: guests (sample-family visitors) are signed in anonymously, so a plain
// `requireSupabaseAuth` lets them in. Many server functions use the admin key
// (supabaseAdmin), which skips the database's own guest rules. Without this
// check a guest could create households, send invite emails, list owner emails
// or delete accounts by calling a server function directly.
//
// src/lib/serverFnGuard.test.ts FAILS THE BUILD if any server function does not
// use this middleware, so a new function cannot be added unguarded by accident.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isGuestClaims } from "@/lib/guest";

export const requireRealUser = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    if (isGuestClaims(context.claims as Parameters<typeof isGuestClaims>[0])) {
      throw new Error("The sample family is view-only. Create an account to use this.");
    }
    return next();
  });
