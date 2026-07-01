import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";

export type CheckItem = {
  id: string;
  label: string;
  description: string;
  who: string;
  link?: { label: string; url: string };
  urgent?: boolean;
};

export type EstatePlanningSection = {
  title: string;
  emoji: string;
  color: string;
  items: CheckItem[];
};

export const ESTATE_SECTIONS: EstatePlanningSection[] = [
  {
    title: "Will",
    emoji: "📜",
    color: "border-primary/30 bg-primary/5",
    items: [
      {
        id: "will-draft",
        label: "Draft or update your Will",
        description: "A Will specifies how your assets are distributed. Without one, Singapore intestacy laws apply and your estate may not go to who you intend.",
        who: "Lawyer required to witness and certify",
        link: { label: "Law Society Singapore", url: "https://www.lawsociety.org.sg/for-public/find-a-lawyer/" },
      },
    ],
  },
  {
    title: "Lasting Power of Attorney (LPA)",
    emoji: "⚖️",
    color: "border-review/30 bg-review/5",
    items: [
      {
        id: "lpa-basic",
        label: "Apply for an LPA",
        description: "Appoints someone to act for you if you lose mental capacity. Apply early — you cannot apply after capacity is lost.",
        who: "Certificate Issuer required: doctor, lawyer, or accredited psychiatrist",
        link: { label: "MSF LPA Info", url: "https://www.msf.gov.sg/what-we-do/opg/about-lpa" },
        urgent: true,
      },
    ],
  },
  {
    title: "CPF Nomination",
    emoji: "🏦",
    color: "border-urgent/30 bg-urgent-soft/10",
    items: [
      {
        id: "cpf-nomination",
        label: "Make a CPF Nomination",
        description: "CPF funds do NOT follow your Will. You must nominate separately — otherwise CPF Board distributes under intestacy rules.",
        who: "CPF Board — can be done online",
        link: { label: "CPF Nomination", url: "https://www.cpf.gov.sg/member/account-services/providing-for-your-loved-ones/making-a-cpf-nomination" },
        urgent: true,
      },
    ],
  },
  {
    title: "Advance Medical Directive (AMD)",
    emoji: "🏥",
    color: "border-settled/30 bg-settled/5",
    items: [
      {
        id: "amd-sign",
        label: "Sign an AMD",
        description: "Instructs doctors NOT to use extraordinary life-sustaining treatment if you are terminally ill and unconscious. Does not affect normal care.",
        who: "Must be signed in front of a registered doctor who files it with MOH",
        link: { label: "MOH AMD Info", url: "https://www.moh.gov.sg/home/policies-and-legislation/advance-medical-directive" },
      },
    ],
  },
  {
    title: "Advance Care Planning (ACP)",
    emoji: "💬",
    color: "border-border bg-muted/20",
    items: [
      {
        id: "acp-complete",
        label: "Complete an ACP document",
        description: "Non-legally-binding document capturing your values and care preferences for end-of-life decisions. Free at most public hospitals.",
        who: "No lawyer or doctor required — done at ACP facilitator clinics",
        link: { label: "ACP Singapore", url: "https://www.livingmatters.sg/advance-care-planning/what-is-acp/" },
      },
    ],
  },
];

export type EstateChecklistRow = {
  item_id: string;
  checked: boolean;
  external_url: string | null;
  notes: string | null;
};

export function useEstateChecklist() {
  const householdId = useAppStore((s) => s.activeHouseholdId);
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["estate-checklist", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("estate_checklist")
        .select("item_id, checked, external_url, notes")
        .eq("household_id", householdId);
      return (data ?? []) as EstateChecklistRow[];
    },
  });

  const rowByItemId = new Map(rows.map((r) => [r.item_id, r]));
  const checked = new Set(rows.filter((r) => r.checked).map((r) => r.item_id));

  async function toggle(itemId: string) {
    if (!householdId) return;
    const existing = rowByItemId.get(itemId);
    const nowChecked = !(existing?.checked ?? false);
    await (supabase as any)
      .from("estate_checklist")
      .upsert(
        { household_id: householdId, item_id: itemId, checked: nowChecked, updated_at: new Date().toISOString() },
        { onConflict: "household_id,item_id" }
      );
    qc.invalidateQueries({ queryKey: ["estate-checklist", householdId] });
  }

  async function saveDetails(itemId: string, fields: { external_url?: string | null; notes?: string | null }) {
    if (!householdId) return;
    const existing = rowByItemId.get(itemId);
    await (supabase as any)
      .from("estate_checklist")
      .upsert(
        {
          household_id: householdId,
          item_id: itemId,
          checked: existing?.checked ?? false,
          external_url: fields.external_url !== undefined ? fields.external_url : existing?.external_url ?? null,
          notes: fields.notes !== undefined ? fields.notes : existing?.notes ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "household_id,item_id" }
      );
    qc.invalidateQueries({ queryKey: ["estate-checklist", householdId] });
  }

  return { checked, rowByItemId, toggle, saveDetails, isLoading };
}
