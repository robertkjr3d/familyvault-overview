import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouterState,
  Link,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useEffect, useState, useRef } from "react";
import type { FormEvent } from "react";

import appCss from "../styles.css?url";
import { BottomTabs } from "@/components/BottomTabs";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/useAuthSession";
import { acceptPendingInvitesForCurrentUser, createOwnHousehold } from "@/lib/householdInvites";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { setupGlobalErrorHandlers } from "@/lib/errorLogger";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "FamilyHub SG" },
      { name: "description", content: "One glance — finance, insurance, health, home." },
      { name: "theme-color", content: "#fbf8f0" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">Not found</h1>
        <a href="/" className="mt-2 inline-block text-sm text-primary underline">
          Go home
        </a>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <RootContent />
    </QueryClientProvider>
  );
}

function RootContent() {
  const { initialized, session } = useAuthSession();
  const setActiveHouseholdId = useAppStore((s) => s.setActiveHouseholdId);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();
  // Legal pages must be readable before signing in — that's the whole point
  // of a privacy policy / terms page. Bypass the auth gate for just these two.
  const isPublicRoute = pathname === "/privacy" || pathname === "/terms";
  const [inviteCheckDone, setInviteCheckDone] = useState(false);

  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setInviteCheckDone(false);
      return;
    }

    let cancelled = false;
    setInviteCheckDone(false);

    // Bug fix: this used to only run when the URL had ?invite=<token>,
    // which meant someone who typed their email + code directly on the
    // homepage (instead of clicking the emailed link) never got joined to
    // the household that invited them — the app had no way to know an
    // invite was involved at all. Checking by the user's own verified
    // email instead of a URL param fixes this regardless of how they
    // arrived, and also accepts multiple pending invites if there are any.
    void acceptPendingInvitesForCurrentUser()
      .then(async (result) => {
        if (cancelled) return;
        if (result?.acceptedHouseholdIds?.length) {
          setActiveHouseholdId(result.acceptedHouseholdIds[0]);
          // Wait for the refetch to actually land, not just fire it — an
          // invalidation alone doesn't mean fresh data has arrived yet, so
          // marking the check "done" right after invalidating (without
          // awaiting) would just relocate the same flash to a moment later.
          await queryClient.invalidateQueries({ queryKey: ["household-memberships"] });
          toast.success(
            result.acceptedHouseholdIds.length > 1
              ? "Invitations accepted."
              : "Invitation accepted."
          );
        }
        if (cancelled) return;
        setInviteCheckDone(true);

        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (!params.has("invite") && !params.has("email")) return;
        params.delete("invite");
        params.delete("email");
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", nextUrl);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInviteCheckDone(true);
        const message = error instanceof Error ? error.message : "Unable to check for pending invites.";
        toast.error(message);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, setActiveHouseholdId, queryClient]);

  const { data: memberships, isLoading: membershipsLoading } = useQuery({
    queryKey: ["household-memberships", session?.user?.id],
    enabled: !!session?.user?.id && !isPublicRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household_users" as any)
        .select("household_id, role, households(id, name)")
        .eq("user_id", session!.user!.id);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ household_id: string }>;
    },
  });

  if (isPublicRoute) {
    return <Outlet />;
  }

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!session) {
    return <SignInScreen />;
  }

  if (!inviteCheckDone || membershipsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (memberships && memberships.length === 0) {
    return <NoHouseholdScreen />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen pb-36">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-4">
          <Outlet />
        </main>
        <BottomTabs />
        <Toaster position="bottom-right" richColors closeButton offset={{ bottom: 80 }} duration={1000} />
      </div>
    </ErrorBoundary>
  );
}

function NoHouseholdScreen() {
  const queryClient = useQueryClient();
  const setActiveHouseholdId = useAppStore((s) => s.setActiveHouseholdId);
  const [creating, setCreating] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  async function handleCreateOwn() {
    setCreating(true);
    try {
      const result = await createOwnHousehold();
      setActiveHouseholdId(result.householdId);
      await queryClient.invalidateQueries({ queryKey: ["household-memberships"] });
      toast.success("Your household is ready.");
    } catch (err: any) {
      toast.error(err.message || "Could not create a household.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-primary px-6 py-6">
          <p className="text-lg font-bold tracking-tight text-primary-foreground">FamilyHub SG</p>
        </div>
        <div className="p-6">
          <h1 className="text-lg font-semibold tracking-tight">No household access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You're signed in, but you're not currently part of any household. If you were
            recently removed, or you're waiting on an invite, check with whoever manages the
            household you're expecting access to. Otherwise, you can start your own.
          </p>
          <Button type="button" onClick={handleCreateOwn} disabled={creating} className="mt-5 w-full">
            {creating ? "Creating..." : "Create your own household"}
          </Button>
          <Button type="button" variant="outline" onClick={handleSignOut} className="mt-2 w-full">
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

// Cloudflare Turnstile site key — safe to be public, it only identifies
// which site is asking; the secret half of this lives in Supabase's own
// dashboard (Settings > Authentication > Bot and Abuse Protection), not in
// this app's code, since Supabase's own auth server verifies the token.
const TURNSTILE_SITE_KEY = "0x4AAAAAAD-_TZ38lRs8wlpW";

/**
 * Renders Cloudflare Turnstile's "Managed" widget — mostly invisible; it
 * resolves on its own in the background for the vast majority of real
 * people, only showing an actual checkbox to a small minority Cloudflare
 * is unsure about. Not the old "type these letters" CAPTCHA. Calls
 * onToken(token) once a token is ready; parent must call reset() to get a
 * fresh token after each use, since Turnstile tokens are single-use.
 */
function TurnstileWidget({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function render() {
      const w = window as any;
      if (cancelled || !containerRef.current || !w.turnstile) return;
      widgetIdRef.current = w.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => { if (!cancelled) onToken(token); },
        "expired-callback": () => { if (!cancelled) onToken(null); },
        "error-callback": () => { if (!cancelled) onToken(null); },
      });
    }

    const w = window as any;
    if (w.turnstile) {
      render();
    } else if (!document.querySelector('script[data-turnstile]')) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.addEventListener("load", render);
      document.head.appendChild(script);
    } else {
      document.querySelector('script[data-turnstile]')?.addEventListener("load", render);
      // Script tag already exists from a previous mount — poll briefly in
      // case it finished loading before this effect ran.
      const interval = setInterval(() => {
        if ((window as any).turnstile) { clearInterval(interval); render(); }
      }, 100);
      setTimeout(() => clearInterval(interval), 5000);
    }

    return () => {
      cancelled = true;
      const w2 = window as any;
      if (widgetIdRef.current && w2.turnstile) {
        w2.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} />;
}

function SignInScreen() {
  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    // Prefill from the invite link when present, so someone who actually
    // clicked their invite email doesn't have to retype their own address.
    return new URLSearchParams(window.location.search).get("email") ?? "";
  });
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  // Fail open, not closed: if Turnstile's script is ever blocked (network
  // issue, ad-blocker, a Cloudflare outage) this app must not become
  // permanently un-sign-in-able for real family members over it. After a
  // generous wait with no token, let the button become clickable anyway —
  // worst case Supabase's own captcha check rejects it with a visible,
  // recoverable error; that's still far better than a silently disabled
  // button with no explanation, forever.
  const [captchaTimedOut, setCaptchaTimedOut] = useState(false);
  useEffect(() => {
    setCaptchaTimedOut(false);
    const t = setTimeout(() => setCaptchaTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [captchaResetKey]);
  const inviteMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("invite");

  async function sendMagicLink() {
    setLoading(true);
    setError(null);

    const inviteToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invite") : null;
    const base = typeof window !== "undefined" ? window.location.origin : undefined;
    let redirectTo = base;
    if (base && typeof window !== "undefined") {
      const url = new URL(base);
      if (inviteToken) url.searchParams.set("invite", inviteToken);
      redirectTo = url.toString();
    }
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        captchaToken: captchaToken ?? undefined,
        // Bug fix: Supabase's email template data reflects the user's
        // STORED profile data, not just this one request — confirmed by
        // a real case where someone who'd been removed from a household,
        // then requested a completely fresh code with no invite involved,
        // still got an email saying "invited by" a household they'd left.
        // Only clear it when this genuinely isn't an invite request —
        // otherwise a legitimate "resend my invite code" click would lose
        // its own correct wording.
        data: inviteToken ? undefined : { invited_household_name: null, invited_by_email: null },
      },
    });

    setLoading(false);
    // Turnstile tokens are single-use — get a fresh one for next time
    // regardless of whether this attempt succeeded or failed.
    setCaptchaToken(null);
    setCaptchaResetKey((k) => k + 1);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    setSentTo(email);
  }

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setVerifyError(null);

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });

    setVerifying(false);
    if (verifyErr) {
      setVerifyError(verifyErr.message);
      return;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-primary px-6 py-6">
          <p className="text-lg font-bold tracking-tight text-primary-foreground">FamilyHub SG</p>
          <p className="mt-1 text-xs text-primary-foreground/70">
            Your family's financial command centre
          </p>
        </div>

        <div className="p-6">
          <h1 className="text-lg font-semibold tracking-tight">
            {inviteMode ? "Join your family's household" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {inviteMode
              ? "Enter the invited email and the code from your invite email."
              : "Enter your email and the code we send you — no password needed."}
          </p>

          <div className="mt-5 space-y-3">
            <Input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <form onSubmit={verifyCode} className="space-y-3">
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" disabled={verifying || !email || !code} className="w-full">
                {verifying ? "Verifying..." : "Verify code and sign in"}
              </Button>
            </form>
            {verifyError && <p className="text-xs text-urgent">{verifyError}</p>}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              {inviteMode ? "Code not showing up?" : "Don't have a code yet?"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter your email above and we'll email you a code to register.
            </p>
            <TurnstileWidget key={captchaResetKey} resetKey={captchaResetKey} onToken={setCaptchaToken} />
            <Button
              type="button"
              variant="outline"
              onClick={sendMagicLink}
              disabled={loading || !email || (!captchaToken && !captchaTimedOut)}
              className="mt-2 w-full"
            >
              {loading ? "Sending..." : !captchaToken && !captchaTimedOut ? "Verifying you're human…" : "Email me a code"}
            </Button>
            {sentTo && <p className="mt-2 text-xs text-settled">New code sent to {sentTo}.</p>}
          </div>

          {error && <p className="mt-3 text-xs text-urgent">{error}</p>}

          <p className="mt-5 text-center text-[11px] text-muted-foreground">
            By continuing, you agree to our{" "}
            <Link to="/terms" className="underline">Terms of Service</Link> and{" "}
            <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
