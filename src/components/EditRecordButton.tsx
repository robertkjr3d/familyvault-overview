import { useState } from "react";
import { Pencil } from "lucide-react";
import { RecordFormSheet } from "./RecordFormSheet";
import { recordConfigs } from "@/lib/recordConfigs";

/**
 * Pencil icon — renders nothing visible until tapped, but exposes
 * an `onEdit` prop you can plug straight into RecordCard.
 *
 * Usage:
 *   const edit = useEditRecord("properties", row);
 *   <RecordCard onEdit={edit.open} ... />
 *   {edit.element}
 */
export function useEditRecord(
  configKey: keyof typeof recordConfigs,
  row: Record<string, any> | null | undefined,
) {
  const [open, setOpen] = useState(false);
  return {
    open: () => setOpen(true),
    element: row ? (
      <RecordFormSheet
        configKey={configKey}
        open={open}
        onOpenChange={setOpen}
        initial={row}
        recordId={row.id}
      />
    ) : null,
  };
}

/**
 * Opens the Add form pre-filled with a copy of an existing record
 * (id/timestamps stripped) so the user can review/edit before saving
 * as a brand-new record.
 *
 * Usage:
 *   const dup = useDuplicateRecord("insurance_policies", p);
 *   <RecordCard onDuplicate={dup.open} ... />
 *   {dup.element}
 */
export function useDuplicateRecord(
  configKey: keyof typeof recordConfigs,
  row: Record<string, any> | null | undefined,
) {
  const [open, setOpen] = useState(false);
  const { id, created_at, updated_at, ...rest } = row ?? {};
  return {
    open: () => setOpen(true),
    element: row ? (
      <RecordFormSheet
        configKey={configKey}
        open={open}
        onOpenChange={setOpen}
        initial={rest}
      />
    ) : null,
  };
}


export function EditRecordButton({
  configKey, row,
}: { configKey: keyof typeof recordConfigs; row: Record<string, any> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
        aria-label="Edit"
      >
        <Pencil className="h-[18px] w-[18px]" />
      </button>
      <RecordFormSheet configKey={configKey} open={open} onOpenChange={setOpen} initial={row} recordId={row.id} />
    </>
  );
}
