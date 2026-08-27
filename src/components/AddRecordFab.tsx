import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { RecordFormSheet } from "./RecordFormSheet";
import { RecordWizardSheet } from "./RecordWizardSheet";
import { recordConfigs } from "@/lib/recordConfigs";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useAppStore } from "@/lib/store";

const WIZARD_CONFIGS = new Set(["properties", "insurance_policies"]);

export function AddRecordFab({ configKey }: { configKey: keyof typeof recordConfigs }) {
  const { canEdit } = useCurrentRole();
  const activeTour = useAppStore((s) => s.activeTour);
  const cfg = recordConfigs[configKey];
  const [formOpen, setFormOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasWizard = WIZARD_CONFIGS.has(configKey as string);

  if (!canEdit) return null;
  // The "more tips" tour never uses this button, but its own fixed
  // position can end up visually overlapping a card the tour is
  // highlighting further down a longer list — confirmed to only show up
  // once a household has more than a couple of entries. Hiding it here
  // for that tour specifically removes the collision outright, rather
  // than trying to reposition the highlight around wherever this happens
  // to be for any given household's list length.
  if (activeTour === "extras") return null;

  function onFabClick() {
    if (hasWizard) {
      setMenuOpen((v) => !v);
    } else {
      setFormOpen(true);
    }
  }

  return (
    <>
      {menuOpen && (
        <div className="fixed bottom-44 right-6 z-40 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setWizardOpen(true); }}
            className="flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm shadow-md border border-border cursor-pointer"
          >
            <Sparkles className="h-4 w-4" />
            Guided (one question at a time)
          </button>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setFormOpen(true); }}
            className="flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm shadow-md border border-border cursor-pointer"
          >
            Full form
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={`Add ${cfg.label}`}
        onClick={onFabClick}
        data-tour="add-record-fab"
        className="fixed bottom-24 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition-transform duration-150 ease-out active:scale-95"
        style={{ background: "var(--aza)" }}
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>
      <RecordFormSheet configKey={configKey} open={formOpen} onOpenChange={setFormOpen} />
      {hasWizard && (
        <RecordWizardSheet
          configKey={configKey as "properties" | "insurance_policies"}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
        />
      )}
    </>
  );
}
