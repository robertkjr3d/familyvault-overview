import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { isPasskeySupported } from "@/lib/passkeyPrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Deliberately its own file, not inline in settings.tsx — same reasoning already
// applied to PolicyChart.tsx elsewhere in this app: keeps an already-large file
// from growing further for a genuinely separate concern.
export function PasskeyManager() {
  const queryClient = useQueryClient();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: passkeys, isLoading } = useQuery({
    queryKey: ["passkeys"],
    enabled: isPasskeySupported(),
    queryFn: async () => {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const register = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Passkey added");
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: (err: unknown) => {
      // Same user-cancelled-the-prompt case as the sign-in flow — don't
      // show an error toast for someone just backing out of the dialog.
      const isUserCancelled =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "ERROR_CEREMONY_ABORTED";
      if (!isUserCancelled) {
        const message = err instanceof Error ? err.message : "Couldn't add passkey";
        toast.error(message);
      }
    },
  });

  const rename = useMutation({
    mutationFn: async ({
      passkeyId,
      friendlyName,
    }: {
      passkeyId: string;
      friendlyName: string;
    }) => {
      const { data, error } = await supabase.auth.passkey.update({ passkeyId, friendlyName });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      setRenamingId(null);
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (passkeyId: string) => {
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Passkey removed");
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isPasskeySupported()) {
    return (
      <div className="mt-2 border-t border-border pt-3">
        <h3 className="mb-2 text-xs font-bold text-muted-foreground">Passkeys</h3>
        <p className="text-xs text-muted-foreground">
          This browser doesn't support passkeys — try a recent version of Chrome, Safari, or Edge.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-border pt-3">
      <h3 className="mb-2 text-xs font-bold text-muted-foreground">Passkeys</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Sign in with Face ID, Touch ID, or your device's screen lock instead of an email code.
      </p>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {passkeys && passkeys.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {passkeys.map((pk) => (
            <li
              key={pk.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              {renamingId === pk.id ? (
                <div className="flex flex-1 items-center gap-1.5">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-7 text-sm"
                    autoFocus
                    maxLength={120}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={rename.isPending || !renameValue.trim()}
                    onClick={() =>
                      rename.mutate({ passkeyId: pk.id, friendlyName: renameValue.trim() })
                    }
                  >
                    Save
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {pk.friendly_name || "Unnamed passkey"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Added {fmtDate(pk.created_at)}
                      {pk.last_used_at
                        ? ` · Last used ${fmtDate(pk.last_used_at)}`
                        : " · Never used"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2"
                    onClick={() => {
                      setRenamingId(pk.id);
                      setRenameValue(pk.friendly_name ?? "");
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="text-xs text-urgent underline decoration-dotted underline-offset-2"
                    onClick={() => {
                      if (
                        confirm(
                          `Remove "${pk.friendly_name || "Unnamed passkey"}"? You'll need another way to sign in if this was your only one.`,
                        )
                      ) {
                        remove.mutate(pk.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={register.isPending}
        onClick={() => register.mutate()}
      >
        {register.isPending ? "Waiting for your device…" : "+ Add a passkey"}
      </Button>
    </div>
  );
}
