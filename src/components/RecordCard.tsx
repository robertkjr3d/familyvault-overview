import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
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
  rightMeta?: ReactNode;
  children?: ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  defaultOpen?: boolean;
  highlight?: boolean;
  persistKey?: string;
  hasNotes?: boolean;
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

export function RecordCard({
  title, subtitle, memberId, status, onStatusChange, action, rightMeta, children,
  onEdit, onDelete, defaultOpen = false, highlight, persistKey, hasNotes,
}: Props) {
  const [open, setOpen] = useState(() => readPersisted(persistKey, defaultOpen));

  useEffect(() => {
    if (!persistKey || typeof window === "undefined") return;
    localStorage.setItem(`fv:open:${persistKey}`, open ? "1" : "0");
  }, [open, persistKey]);

  return (
    <article
      className={cn(
        "group relative rounded-2xl border shadow-sm transition",
        tintBg[status],
        highlight && "ring-2 ring-primary",
      )}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-0.5">
        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label="Edit"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this record?")) onDelete(); }}
            className="cursor-pointer rounded-md p-1 text-urgent hover:bg-urgent/10"
            aria-label="Delete"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-start gap-3 p-4 pr-20 text-left"
      >
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            <MemberTag memberId={memberId} />
          </div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          {action && (
            <p className="line-clamp-2 text-sm text-foreground/90">
              <span className="font-medium text-primary">Action:</span> {action}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 pt-7">
          {rightMeta}
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition", open && "rotate-180")}
          />
        </div>
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-4 py-2">
        <StatusToggle value={status} onChange={onStatusChange} />
        {hasNotes && <span className="text-xs" title="Has notes">📝</span>}
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
