import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { isPasskeySupported, markPasskeyPromptSeen } from "@/lib/passkeyPrompt";

/**
 * Shown once per person, right after they're signed in — NOT buried in
 * Settings. Real adoption data (eBay's Authenticate 2025 case study, cited
 * when this was built) found settings-only placement converts at roughly the
 * same low rate as Auth0/Cognito's own default (~1% of monthly users),
 * while a post-login prompt like this one drives the large majority of
 * enrollments on its own. Settings still has its own "Add a passkey" entry
 * (PasskeyManager.tsx) for anyone who wants to add one on a second device
 * later, or missed this prompt — this isn't a replacement for that, just
 * the primary discovery path instead of the weakest one.
 *
 * Deliberately gated on hasSeenTour === true (not merely !== false), so a
 * genuinely brand-new person isn't shown two full-screen modals stacked in
 * the same sitting — they'll see this one on their next visit instead,
 * once the tour question is already resolved.
 *
 * Copy is deliberately plain-language — research on passkey enrollment
 * completion rates found jargon like "WebAuthn" or "FIDO2" measurably hurts
 * conversion; one clear benefit sentence outperforms any technical one.
 */
export function PostLoginPasskeyPrompt() {
  const { hasSeenTour, hasSeenPasskeyPrompt, isLoading: roleLoading } = useCurrentRole();
  const queryClient = useQueryClient();
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const { data: existingPasskeys, isLoading: passkeysLoading } = useQuery({
    queryKey: ["passkeys"],
    enabled: isPasskeySupported() && hasSeenPasskeyPrompt === false,
    queryFn: async () => {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const show =
    isPasskeySupported() &&
    !roleLoading &&
    hasSeenTour === true &&
    hasSeenPasskeyPrompt === false &&
    !passkeysLoading &&
    (existingPasskeys?.length ?? 0) === 0 &&
    !dismissedThisSession &&
    !justAdded;

  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  if (!show) {
    return null;
  }

  function dismiss() {
    setDismissedThisSession(true);
    void markPasskeyPromptSeen();
  }

  async function addPasskey() {
    setRegistering(true);
    const { error } = await supabase.auth.registerPasskey();
    setRegistering(false);
    if (error) {
      const isUserCancelled =
        "code" in error && (error as { code?: string }).code === "ERROR_CEREMONY_ABORTED";
      if (!isUserCancelled) toast.error(error.message);
      return;
    }
    void markPasskeyPromptSeen();
    setJustAdded(true);
    void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    toast.success("Passkey added — you can use it next time you sign in.");
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 animate-in fade-in-0 duration-200">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="mb-3 text-4xl">🔐</div>
        <h2 className="text-lg font-bold">Skip the email code next time</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Set up Face ID, Touch ID, or your device's screen lock to sign in instantly — no code to
          wait for or type in.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={addPasskey}
            disabled={registering}
            className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {registering ? "Waiting for your device…" : "Set it up"}
          </button>
          <button
            onClick={dismiss}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-muted-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
