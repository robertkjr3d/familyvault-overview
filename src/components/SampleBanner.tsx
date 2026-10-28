import { supabase } from "@/integrations/supabase/client";
import { useIsGuest } from "@/hooks/useIsGuest";

/** Shown only to sample-family guests, above the header. */
export function SampleBanner() {
  const isGuest = useIsGuest();
  if (!isGuest) return null;

  async function startOwn() {
    // Ends the guest session and returns to the sign-in screen.
    await supabase.auth.signOut();
  }

  return (
    <div className="bg-primary px-4 py-2 text-center text-xs text-primary-foreground">
      <span className="font-semibold">Sample family</span>: made-up data, view only.{" "}
      <button type="button" onClick={startOwn} className="font-semibold underline">
        Start your own
      </button>
    </div>
  );
}
