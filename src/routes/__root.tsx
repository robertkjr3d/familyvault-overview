import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useState } from "react";
import type { FormEvent } from "react";

import appCss from "../styles.css?url";
import { BottomTabs } from "@/components/BottomTabs";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/useAuthSession";
import { acceptHouseholdInvite } from "@/lib/householdInvites";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "FamilyVault" },
      { name: "description", content: "One glance — finance, insurance, health, home." },
      { name: "theme-color", content: "#fbf8f0" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
  const { initialized, session } = useAuthSession();
  const setActiveHouseholdId = useAppStore((s) => s.setActiveHouseholdId);

  useEffect(() => {
    if (!session?.user?.id || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("invite");
    if (!inviteToken) {
      return;
    }

    let cancelled = false;

    void acceptHouseholdInvite({ data: { token: inviteToken } })
      .then((result) => {
        if (cancelled) return;
        if (result?.householdId) {
          setActiveHouseholdId(result.householdId);
        }
        toast.success("Invitation accepted.");

        params.delete("invite");
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", nextUrl);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unable to accept invite.";
        toast.error(message);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, setActiveHouseholdId]);

  if (!initialized) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      </QueryClientProvider>
    );
  }

  if (!session) {
    return (
      <QueryClientProvider client={queryClient}>
        <SignInScreen />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen pb-20">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-4">
          <Outlet />
        </main>
        <BottomTabs />
        <Toaster position="top-center" richColors closeButton />
      </div>
    </QueryClientProvider>
  );
}

function SignInScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inviteMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("invite");

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const configuredRedirect = import.meta.env.VITE_SUPABASE_AUTH_REDIRECT_URL?.trim();
    const redirectTo =
      configuredRedirect ||
      (typeof window !== "undefined" ? window.location.origin : undefined);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    setSentTo(email);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          FamilyVault
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {inviteMode
            ? "You are accepting a household invite. Enter the invited email to continue."
            : "Enter your email and we will send a secure magic link."}
        </p>

        <form onSubmit={sendMagicLink} className="mt-5 space-y-3">
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={loading || !email} className="w-full">
            {loading ? "Sending link..." : "Send magic link"}
          </Button>
        </form>

        {sentTo && <p className="mt-3 text-xs text-settled">Magic link sent to {sentTo}.</p>}
        {error && <p className="mt-3 text-xs text-urgent">{error}</p>}
      </div>
    </div>
  );
}
