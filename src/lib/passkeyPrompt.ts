// Whether this browser can do a passkey ceremony at all — shared between the
// sign-in screen's "Sign in with a passkey" button and the post-login
// enrollment prompt below, so the two checks can't drift apart.
export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

// Same per-person "mark seen" pattern as markTourSeen() in tourSteps.ts —
// deliberately a separate function/file rather than folding into that one,
// since this isn't tour-related and a future person reading tourSteps.ts
// shouldn't have to wade through an unrelated concern to find the tour logic.
export async function markPasskeyPromptSeen() {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return;
  await supabase
    .from("household_users" as any)
    .update({ has_seen_passkey_prompt: true })
    .eq("user_id", userId);
}
