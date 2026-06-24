import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Pencil, Trash2, Bell, NotebookPen, RotateCw, Paperclip } from "lucide-react";
import { StatusToggle, type Status } from "./StatusToggle";
import { MemberTag } from "./MemberTag";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  memberId?: string | null;
  status: Status;
  onStatusChange: (s: Status) => void;
  action?: string | null;
  /** Small informational badges shown below the title/subtitle */
  tags?: string[] | null;
  /** Second member shown alongside the primary memberId — used for joint savings accounts */
  secondaryMemberId?: string | null;
  rightMeta?: ReactNode;
  children?: ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  defaultOpen?: boolean;
  highlight?: boolean;
  persistKey?: string;
  hasNotes?: boolean;
  updatedAt?: string | null;
  createdAt?: string | null;
  /** Counts for the icon row below the status toggle. Pass undefined/0 to hide an icon entirely. */
  reminderCount?: number;
  historyCount?: number;
  documentsCount?: number;
  /** Called when the Notes/Reminder/Update/Documents icon is tapped. The card expands itself;
   * the parent is responsible for opening the right inner CollapsibleSection and scrolling to it. */
  onNotesClick?: () => void;
  onReminderClick?: () => void;
  onHistoryClick?: () => void;
  onDocumentsClick?: () => void;
  /** Controlled open state, so a click on an icon can force the card open even if it was collapsed.
   * Falls back to internal state if not provided (existing behaviour preserved). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const tintBg: Record<Status, string> = {
  urgent: "bg-urgent-tint border-urgent-border",
  review: "bg-review-tint border-review-border",
  settled: "bg-settled-tint border-settled-border",
};

function readPersisted(key: string | undefined, def: boolean): boolean {
  if (!key || typeof window === "undefined") return def;
  const v = localStorage.getItem(`fv:open:${key}`);
  if (v === "1") return true;
  if (v === "0") return false;
  return def;
}

function CardIconButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground",
        active && "text-primary",
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function RecordCard({
  title, subtitle, memberId, secondaryMemberId, status, onStatusChange, action, tags, rightMeta, children,
  onEdit, onDelete, onDuplicate, defaultOpen = false, highlight, persistKey, hasNotes, updatedAt, createdAt,
  reminderCount, historyCount, documentsCount,
  onNotesClick, onReminderClick, onHistoryClick, onDocumentsClick,
  open: openProp, onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(() => readPersisted(persistKey, defaultOpen));
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  function setOpen(updater: boolean | ((v: boolean) => boolean)) {
    const next = typeof updater === "function" ? updater(open) : updater;
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  }

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") return;
    localStorage.setItem(`fv:open:${persistKey}`, open ? "1" : "0");
  }, [open, persistKey]);

  function handleIconClick(callback?: () => void) {
    setOpen(true);
    callback?.();
  }

  const hasAnyIcon = hasNotes || (reminderCount ?? 0) > 0 || (historyCount ?? 0) > 0 || (documentsCount ?? 0) > 0;

  return (
    <article
      className={cn(
        "group relative rounded-2xl border shadow-sm transition",
        tintBg[status],
        highlight && "ring-2 ring-primary",
      )}
    >
      {/* Icon cluster — top right */}
      <div className="absolute right-2 top-2 z-10 flex gap-0.5">
        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label="Edit"
            title="Edit"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
        )}
        {onDuplicate && (
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label="Duplicate"
            title="Duplicate"
          >
            <Copy className="h-[18px] w-[18px]" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this record?")) onDelete(); }}
            className="cursor-pointer rounded-md p-1 text-urgent hover:bg-urgent/10"
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      {/* rightMeta — absolutely positioned directly below icon cluster, flush right */}
      {rightMeta && (
        <div className="absolute right-2 top-9 z-10 flex flex-col items-end">
          {rightMeta}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer flex-col gap-1.5 px-4 pt-4 pb-6 pr-[90px] text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          <MemberTag memberId={memberId} />
          {secondaryMemberId && <MemberTag memberId={secondaryMemberId} />}
        </div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        {action && (
          <p className="text-sm text-foreground/90">
            <span className="font-medium text-primary">Action:</span> {action}
          </p>
        )}
      </button>

      <div className="flex w-full items-center justify-between gap-2 border-t border-border/40 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center"
            aria-label="Toggle status"
          >
            <StatusToggle value={status} onChange={onStatusChange} />
          </button>
          {hasAnyIcon && (
            <div className="flex items-center gap-1 text-[11px]">
              {hasNotes && (
                <CardIconButton onClick={() => handleIconClick(onNotesClick)} active={!!hasNotes} label="View notes">
                  <NotebookPen className="h-3.5 w-3.5" />
                </CardIconButton>
              )}
              {(reminderCount ?? 0) > 0 && (
                <CardIconButton onClick={() => handleIconClick(onReminderClick)} active label={`${reminderCount} reminder${reminderCount === 1 ? "" : "s"}`}>
                  <Bell className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                  <span>{reminderCount}</span>
                </CardIconButton>
              )}
              {(historyCount ?? 0) > 0 && (
                <CardIconButton onClick={() => handleIconClick(onHistoryClick)} active label={`${historyCount} update${historyCount === 1 ? "" : "s"}`}>
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>{historyCount}</span>
                </CardIconButton>
              )}
              {(documentsCount ?? 0) > 0 && (
                <CardIconButton onClick={() => handleIconClick(onDocumentsClick)} active label={`${documentsCount} document${documentsCount === 1 ? "" : "s"}`}>
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{documentsCount}</span>
                </CardIconButton>
              )}
            </div>
          )}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2" aria-label="Toggle details">
          {updatedAt && (() => {
            const updMs = new Date(updatedAt).getTime();
            const creMs = createdAt ? new Date(createdAt).getTime() : updMs;
            const wasEdited = updMs - creMs > 60000;
            const label = wasEdited ? "Updated" : "Added";
            const dateStr = new Date(updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
            return (
              <span className="text-[10px] text-muted-foreground">{label} {dateStr}</span>
            );
          })()}
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition", open && "rotate-180")}
          />
        </button>
      </div>

      {open && children && (
        <div className="space-y-4 border-t border-border/40 bg-background/40 p-4">{children}</div>
      )}
    </article>
  );
}

export function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}
