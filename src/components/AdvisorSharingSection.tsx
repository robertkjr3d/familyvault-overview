import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  sendAdvisorInvite,
  revokeAdvisorAccess,
  updateAdvisorPermissions,
  cancelPendingAdvisorInvite,
  listAdvisorsForHousehold,
  listClientHouseholdsForAdvisor,
} from "@/lib/advisorAccess";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useMembers } from "@/hooks/useMembers";

type AdvisorEntry = {
  advisorUserId: string;
  email: string;
  displayName: string | null;
  canViewInsurance: boolean;
  canViewInvestments: boolean;
  canViewNetworthSummary: boolean;
  canViewProperty: boolean;
  canViewLoans: boolean;
  memberNames: string[];
  memberIds: string[];
  consentRenewedAt: string;
};

// Each row owns its own edit state (draft values, editing on/off) rather
// than the parent tracking "which row is being edited" — same pattern as
// RecordNote on the FA dashboard: open -> edit -> explicit Save/Cancel,
// never autosave, so a half-changed permission set never silently becomes
// live access.
function AdvisorRow({
  advisor,
  members,
  householdId,
  isOwner,
  onRevoke,
  revokePending,
}: {
  advisor: AdvisorEntry;
  members: { id: string; name: string }[];
  householdId: string;
  isOwner: boolean;
  onRevoke: () => void;
  revokePending: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftInsurance, setDraftInsurance] = useState(advisor.canViewInsurance);
  const [draftInvestments, setDraftInvestments] = useState(advisor.canViewInvestments);
  const [draftNetworth, setDraftNetworth] = useState(advisor.canViewNetworthSummary);
  const [draftProperty, setDraftProperty] = useState(advisor.canViewProperty);
  const [draftLoans, setDraftLoans] = useState(advisor.canViewLoans);
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>(advisor.memberIds);

  function toggleDraftMember(id: string) {
    setDraftMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function resetDraft() {
    setDraftInsurance(advisor.canViewInsurance);
    setDraftInvestments(advisor.canViewInvestments);
    setDraftNetworth(advisor.canViewNetworthSummary);
    setDraftProperty(advisor.canViewProperty);
    setDraftLoans(advisor.canViewLoans);
    setDraftMemberIds(advisor.memberIds);
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateAdvisorPermissions({
        data: {
          householdId,
          advisorUserId: advisor.advisorUserId,
          canViewInsurance: draftInsurance,
          canViewInvestments: draftInvestments,
          canViewNetworthSummary: draftNetworth,
          canViewProperty: draftProperty,
          canViewLoans: draftLoans,
          memberIds: draftMemberIds,
        },
      }),
    onSuccess: () => {
      toast.success("Access updated.");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["advisor-access", householdId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to update access.");
    },
  });

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
        <p className="mb-2 font-medium">{advisor.displayName ?? advisor.email}</p>

        <p className="mb-1 font-medium text-muted-foreground">Members</p>
        <div className="mb-2 space-y-1">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draftMemberIds.includes(m.id)}
                onChange={() => toggleDraftMember(m.id)}
              />
              {m.name}
            </label>
          ))}
        </div>

        <p className="mb-1 font-medium text-muted-foreground">Categories</p>
        <div className="mb-1 space-y-1">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draftInsurance}
              onChange={(e) => setDraftInsurance(e.target.checked)}
            />
            Insurance
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draftInvestments}
              onChange={(e) => setDraftInvestments(e.target.checked)}
            />
            Investments
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draftProperty}
              onChange={(e) => setDraftProperty(e.target.checked)}
            />
            Property
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draftLoans} onChange={(e) => setDraftLoans(e.target.checked)} />
            Loans
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draftNetworth}
              onChange={(e) => setDraftNetworth(e.target.checked)}
            />
            Net worth summary
          </label>
        </div>
        {draftMemberIds.length === 0 && (
          <p className="mb-2 text-[10px] font-medium text-urgent">
            At least one member must stay selected — remove them below instead if you want to stop
            sharing entirely.
          </p>
        )}

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
            disabled={updateMutation.isPending || draftMemberIds.length === 0}
            onPointerDown={(e) => {
              e.preventDefault();
              updateMutation.mutate();
            }}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            onPointerDown={(e) => {
              e.preventDefault();
              resetDraft();
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const renewedAt = new Date(advisor.consentRenewedAt);
  const daysLeft = Math.round(365 - (Date.now() - renewedAt.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-medium">{advisor.displayName ?? advisor.email}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {[
            advisor.canViewInsurance && "Insurance",
            advisor.canViewInvestments && "Investments",
            advisor.canViewProperty && "Property",
            advisor.canViewLoans && "Loans",
            advisor.canViewNetworthSummary && "Net worth summary",
          ]
            .filter(Boolean)
            .join(", ") || "No categories shared"}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {advisor.memberNames.length > 0
            ? `Sees: ${advisor.memberNames.join(", ")}`
            : "No members shared — nothing visible yet"}
        </p>
        {daysLeft <= 30 && (
          <p className="text-[10px] font-medium text-review-foreground">
            {daysLeft <= 0
              ? "Access expired — share again to continue"
              : `Renews in ${daysLeft} days — share again to continue`}
          </p>
        )}
      </div>
      {isOwner && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
            onPointerDown={(e) => {
              e.preventDefault();
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-urgent hover:bg-urgent/10 disabled:opacity-40"
            disabled={revokePending}
            onPointerDown={(e) => {
              e.preventDefault();
              onRevoke();
            }}
          >
            Stop sharing
          </button>
        </div>
      )}
    </div>
  );
}

export function AdvisorSharingSection() {
  const { role, householdId } = useCurrentRole();
  const isOwner = role === "owner";
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [canViewInsurance, setCanViewInsurance] = useState(true);
  const [canViewInvestments, setCanViewInvestments] = useState(true);
  const [canViewProperty, setCanViewProperty] = useState(true);
  const [canViewLoans, setCanViewLoans] = useState(true);
  const [canViewNetworthSummary, setCanViewNetworthSummary] = useState(true);
  // Deliberately starts empty, not "everyone" — sharing a member is an
  // opt-in action the household owner takes per person, not a default.
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const { data: members = [] } = useMembers();

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  const { data, isLoading } = useQuery({
    queryKey: ["advisor-access", householdId],
    enabled: !!householdId,
    queryFn: () => listAdvisorsForHousehold({ data: { householdId: householdId! } }),
  });

  // Independent of everything else on this screen: does THIS person also
  // happen to have advisor access to some other household? If so, they need
  // a discoverable way to actually reach that view — a dual-role person
  // otherwise has no path to it at all once they also have a household.
  const { data: myAdvisorClients } = useQuery({
    queryKey: ["advisor-clients"],
    queryFn: () => listClientHouseholdsForAdvisor(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["advisor-access", householdId] });

  const inviteMutation = useMutation({
    mutationFn: () =>
      sendAdvisorInvite({
        data: {
          householdId: householdId!,
          email,
          canViewInsurance,
          canViewInvestments,
          canViewNetworthSummary,
          canViewProperty,
          canViewLoans,
          memberIds,
        },
      }),
    onSuccess: () => {
      toast.success(`Invite sent to ${email}`);
      setEmail("");
      setMemberIds([]);
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to send invite.");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (advisorUserId: string) =>
      revokeAdvisorAccess({ data: { householdId: householdId!, advisorUserId } }),
    onSuccess: () => {
      toast.success("Access removed.");
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to remove access.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (pendingEmail: string) =>
      cancelPendingAdvisorInvite({ data: { householdId: householdId!, email: pendingEmail } }),
    onSuccess: () => {
      toast.success("Invite cancelled.");
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to cancel invite.");
    },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-bold">Financial Advisor Access</h2>
      {(myAdvisorClients?.clients.length ?? 0) > 0 && (
        <a
          href="/?view=advisor"
          className="mb-3 block rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground"
        >
          You also have adviser access to {myAdvisorClients!.clients.length} household
          {myAdvisorClients!.clients.length === 1 ? "" : "s"} — tap to view →
        </a>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        Share a limited view with an adviser you work with. Whichever categories you tick below —
        insurance, investments, property, loans — show real, itemized entries for the members you
        select. A net worth summary (if you choose to share it, separately) always shows one combined
        total only, regardless of what else you share — itemized savings details are never shown to
        an adviser, under any setting. They never see your inventory or anything else.
      </p>

      {isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}

      {!isLoading && (
        <div className="space-y-1 rounded-lg border border-border p-2">
          {data?.advisors.map((a) => (
            <AdvisorRow
              key={a.advisorUserId}
              advisor={a}
              members={members}
              householdId={householdId!}
              isOwner={isOwner}
              revokePending={revokeMutation.isPending}
              onRevoke={() => {
                if (!confirm(`Stop sharing your data with ${a.displayName ?? a.email}?`)) return;
                revokeMutation.mutate(a.advisorUserId);
              }}
            />
          ))}

          {data?.pending.map((p) => (
            <div key={p.email} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{p.email}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-full bg-review-soft px-2 py-0.5 text-[10px] font-medium text-review-foreground">
                  Invited, pending
                </span>
                {isOwner && (
                  <button
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-urgent hover:bg-urgent/10 disabled:opacity-40"
                    disabled={cancelMutation.isPending}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (!confirm(`Cancel the invite to ${p.email}?`)) return;
                      cancelMutation.mutate(p.email);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}

          {(data?.advisors.length ?? 0) === 0 && (data?.pending.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">No advisers have access yet.</p>
          )}
        </div>
      )}

      {isOwner ? (
        <form
          className="mt-4 space-y-3 border-t border-border/40 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim() || !householdId) return;
            if (memberIds.length === 0) {
              toast.error("Select at least one member to share.");
              return;
            }
            inviteMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              Adviser's email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Which household members can they see
            </p>
            {members.length === 0 && (
              <p className="text-xs text-muted-foreground">No members set up yet.</p>
            )}
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={memberIds.includes(m.id)}
                  onChange={() => toggleMember(m.id)}
                />
                {m.name}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              An FA sees each selected member as a separate profile — never a combined household
              total. Anything not tied to one member (e.g. unassigned records) is visible on every
              selected member's profile.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">What they can see</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canViewInsurance}
                onChange={(e) => setCanViewInsurance(e.target.checked)}
              />
              Insurance
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canViewInvestments}
                onChange={(e) => setCanViewInvestments(e.target.checked)}
              />
              Investments
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canViewProperty}
                onChange={(e) => setCanViewProperty(e.target.checked)}
              />
              Property
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canViewLoans}
                onChange={(e) => setCanViewLoans(e.target.checked)}
              />
              Loans
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={canViewNetworthSummary}
                onChange={(e) => setCanViewNetworthSummary(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Net worth summary
                <span className="block text-xs text-muted-foreground">
                  One combined total only, independent of whatever you share above — savings is
                  never itemized under any setting
                </span>
              </span>
            </label>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={inviteMutation.isPending || !householdId || memberIds.length === 0}
          >
            {inviteMutation.isPending ? "Sending..." : "Share access"}
          </button>
        </form>
      ) : (
        <p className="mt-4 border-t border-border/40 pt-4 text-xs text-muted-foreground">
          Only the household owner can share access with an adviser.
        </p>
      )}
    </section>
  );
}
