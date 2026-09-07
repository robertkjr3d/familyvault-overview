import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Pencil, Trash2, Bell, NotebookPen, MessageSquare, RotateCw, Paperclip, ExternalLink } from "lucide-react";
import { StatusToggle, type Status } from "./StatusToggle";
import { MemberTag } from "./MemberTag";
import { cn } from "@/lib/utils";
import { useCurrentRole } from "@/lib/useCurrentRole";

type Props = {
  title: string;
  subtitle?: string;
  memberId?: string | null;
  status: Status;
  onStatusChange: (s: Status) => void;
  action?: string | null;
  /** External link (e.g. provider website, portal) shown as an icon next to the title, only while the card is expanded */
  externalUrl?: string | null;
  /** Small informational badges shown below the title/subtitle */
  tags?: string[] | null;
  /** Shows a bold [GIRO] tag next to the title when true */
  isGiro?: boolean;
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
  /** True when an adviser has left a note on this record — shown as its own
   * badge, distinct from hasNotes (the household's own notes), so the two
   * never get visually confused with each other. */
  hasAdvisorNote?: boolean;
  updatedAt?: string | null;
  createdAt?: string | null;
  /** Counts for the icon row below the status toggle. Pass undefined/0 to hide an icon entirely. */
  reminderCount?: number;
  historyCount?: number;
  documentsCount?: number;
  /** Called when the Notes/Reminder/Update/Documents icon is tapped. The card expands itself;
   * the parent is responsible for opening the right inner CollapsibleSection and scrolling to it. */
  onNotesClick?: () => void;
  onAdvisorNoteClick?: () => void;
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
  title, subtitle, memberId, secondaryMemberId, status, onStatusChange, action, externalUrl, tags, isGiro, rightMeta, children,
  onEdit, onDelete, onDuplicate, defaultOpen = false, highlight, persistKey, hasNotes, hasAdvisorNote, updatedAt, createdAt,
  reminderCount, historyCount, documentsCount,
  onNotesClick, onAdvisorNoteClick, onReminderClick, onHistoryClick, onDocumentsClick,
  open: openProp, onOpenChange,
}: Props) {
  const { canEdit } = useCurrentRole();
  const [internalOpen, setInternalOpen] = useState(() => readPersisted(persistKey, defaultOpen));
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  // Long free-text Action notes (e.g. detailed payment instructions) used to render at
  // full length on the collapsed card, letting a single record dominate the whole list.
  // Clamped to 3 lines by default — but ONLY when the text actually overflows 3 lines
  // at the current screen width. A character-count guess was tried first and was wrong:
  // the same note can wrap to 1 line on a wide laptop screen and 3 lines on a phone, so
  // whether "Show more" is needed depends on real layout, not string length.
  //
  // Sep 6 2026 v3: two earlier CSS-only approaches (line-clamp, then a fixed max-height)
  // both broke in real screenshots — line-clamp silently swallowed the clickable "…"
  // button, and a hard pixel cutoff sliced a word's last letter in half wherever the
  // 3-line boundary happened to land mid-glyph. Neither approach knows where WORDS end,
  // only where pixels end. Fixed properly this time: a hidden same-width measurer node
  // (actionMeasureRef) binary-searches, word by word, for the most whole words that fit
  // in 3 lines WITH "…" already included in the measurement — matching the Word-doc
  // framing exactly (fit whole words up to the line; if the next one doesn't fit, it's
  // just not there). The truncated text + the real clickable "…" button are then
  // rendered as plain inline flow, no CSS clipping at all — so "…" always lands right
  // after the last visible word, never floating off with empty space after a short line.
  const actionRef = useRef<HTMLParagraphElement>(null);
  const actionMeasureRef = useRef<HTMLParagraphElement>(null);
  const [actionExpanded, setActionExpanded] = useState(false);
  const [actionOverflows, setActionOverflows] = useState(false);
  const [truncatedAction, setTruncatedAction] = useState("");
  useLayoutEffect(() => {
    if (actionExpanded || !action) {
      setActionOverflows(false);
      return;
    }
    const el = actionRef.current;
    const measureEl = actionMeasureRef.current;
    if (!el || !measureEl) return;

    function recompute() {
      if (!el || !measureEl || !action) return;
      const lineHeight = parseFloat(window.getComputedStyle(el).lineHeight) || 20;
      const maxHeightPx = lineHeight * 3 + 1; // +1px rounding tolerance
      measureEl.style.width = `${el.clientWidth}px`;

      // Does the full text already fit in 3 lines? Then there's nothing to truncate.
      measureEl.textContent = `Action: ${action}`;
      if (measureEl.scrollHeight <= maxHeightPx) {
        setActionOverflows(false);
        return;
      }
      setActionOverflows(true);

      // Binary search over WHOLE WORDS (never characters) for the most that fit
      // alongside "…" — guarantees no mid-word cut, ever, regardless of font/width.
      const words = action.split(" ");
      let lo = 0;
      let hi = words.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        measureEl.textContent = `Action: ${words.slice(0, mid).join(" ")}…`;
        if (measureEl.scrollHeight <= maxHeightPx) lo = mid;
        else hi = mid - 1;
      }
      setTruncatedAction(words.slice(0, lo).join(" "));
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [action, actionExpanded]);

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

  const hasAnyIcon = hasNotes || hasAdvisorNote || (reminderCount ?? 0) > 0 || (historyCount ?? 0) > 0 || (documentsCount ?? 0) > 0;

  return (
    <article
      data-tour="record-card"
      className={cn(
        "group relative rounded-2xl border shadow-sm transition",
        tintBg[status],
        highlight && "ring-2 ring-primary",
      )}
    >
      {/* Icon cluster — top right, absolute, sits OUTSIDE the toggle <button> below
          (sibling, not child) so we never nest a <button> inside a <button>, which
          is invalid HTML and can make the outer button's own click handling and
          Safari/iOS rendering behave unpredictably. Kept at the original comfortable
          tap-target size (p-1) — the shrink tried on Sep 5 traded away tap-target
          size for a padding fix that's been replaced by the pr-24 approach below,
          so there's no longer a reason to keep icons smaller than before. */}
      <div className="absolute right-2 top-2 z-10 flex gap-0.5">
        {onEdit && canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label="Edit"
            title="Edit"
          >
            <Pencil className="h-[18px] w-[18px]" />
          </button>
        )}
        {onDuplicate && canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            data-tour="duplicate-icon"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label="Duplicate"
            title="Duplicate"
          >
            <Copy className="h-[18px] w-[18px]" />
          </button>
        )}
        {onDelete && canEdit && (
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

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-stretch gap-0 text-left"
      >
        {/* Left column — text content. Sep 6 2026 v4: splitting badges onto their
            own row (v3) wasn't enough — a plain padding-right on a block box
            applies to the WHOLE box's height, so even a 3-4 line wrapped title
            was narrowed on every single line, not just the first one where the
            icons actually are (confirmed from the user's own screenshot: visible
            empty space between the wrapped text and the icons on every line).
            CSS can't give a text box a different available width per line —
            except with a float, which is exactly the "avatar + text" technique
            for this. A tiny invisible floated spacer (not the real icon buttons —
            those stay absolutely-positioned siblings of the toggle button below,
            so we're not nesting interactive buttons inside it) reserves space
            only for the ~1 line height the icons actually occupy; the title
            wraps around it for that line, then gets the FULL card width for
            every line after. The clear-both div makes this block correctly
            report its full height (floats don't count toward a container's
            height on their own) so the badges row below doesn't overlap it.
            Sep 6 2026 v5: v4 alone still wasn't enough — real screenshots showed
            it varied a LOT by tab (property's title wrapped one word too early;
            loans' wrapped after a single word, far worse). Root cause: the right
            "amounts" column (see its own comment below) had NO width cap, so it
            silently grew to fit whatever it needed — loans' 3-line balance block
            is wider than property's 1-line value, so it was stealing more space
            from THIS column before the title ever got a chance. Capping that
            column is the bigger fix; trimmed the float here too (w-20/ml-2 → w-16/
            ml-1) since it had ~10px more margin than the icon cluster's actual
            footprint needs. Both changes together, not either alone. Still my
            best measurement from the code, not a live-rendered check — if a
            title's last line is still noticeably short of the icons after this,
            the fastest way to nail the exact number is Safari's own inspector on
            the real device (long-press → Inspect, or connect to a Mac): drag the
            float's width down in devtools until it looks right, and send me that
            number directly instead of another screenshot-and-guess round. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pl-4 pr-3 pb-6 pt-3">
          <div>
            <div aria-hidden="true" className="float-right ml-1 h-6 w-16" />
            <h3 className="text-sm font-semibold leading-tight">
              {title}
              {externalUrl && (
                <a
                  href={/^https?:\/\//i.test(externalUrl) ? externalUrl : `https://${externalUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full align-middle text-primary hover:bg-primary/10"
                  aria-label="Open external link"
                  title={externalUrl}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </h3>
            <div className="clear-both" />
          </div>
          {(isGiro || memberId || secondaryMemberId) && (
            <div className="flex flex-wrap items-center gap-2">
              {isGiro && <span className="text-sm font-bold">[GIRO]</span>}
              <MemberTag memberId={memberId} />
              {secondaryMemberId && <MemberTag memberId={secondaryMemberId} />}
            </div>
          )}
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
            /* Sep 6 2026 v3: plain inline flow now, no CSS clipping (line-clamp and
               max-height both broke real screenshots — see the big comment above by
               the state hooks). truncatedAction is already the exact word-safe cut
               computed there; "…" is a real button appended right after it in normal
               text flow, so it always sits directly after the last visible word,
               never floating off with a gap when the last line happens to be short. */
            <p ref={actionRef} className="text-sm text-foreground/90">
              <span className="font-medium text-primary">Action:</span>{" "}
              {actionOverflows && !actionExpanded ? truncatedAction : action}
              {actionOverflows && !actionExpanded && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActionExpanded(true); }}
                  aria-label="Show full action text"
                  className="font-medium text-primary"
                >
                  …
                </button>
              )}
              {actionOverflows && actionExpanded && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActionExpanded(false); }}
                  className="ml-1.5 text-xs font-medium text-primary underline decoration-dotted underline-offset-2"
                >
                  Show less
                </button>
              )}
            </p>
          )}
          {/* Hidden measurer for the word-safe truncation above — never painted or
              interactive, exists purely so recompute() has a same-font, same-width
              box to test candidate strings against via scrollHeight. */}
          <p
            ref={actionMeasureRef}
            aria-hidden="true"
            className="text-sm text-foreground/90"
            style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", zIndex: -1 }}
          />
        </div>

        {/* Right column — amounts. Was a fixed 88px, too narrow for a date string
            (caused "Updated: 02" / "Sep 2026" to split mid-value). Grows to fit its
            content, but Sep 6 2026: had NO upper bound — shrink-0 meant it could
            grow as wide as it wanted (e.g. loans' "$304,591 (est.)" balance line),
            silently stealing width from the title on the left every time. That's
            the real reason loans' titles wrapped far worse than property's: loans'
            right column is wider (balance + monthly payment + rate, 3 lines) so it
            was eating more of the card before the title ever got a chance. Capped
            now — a genuinely long value here wraps onto its own line instead of
            growing sideways forever, same trade Action text already makes. */}
        {rightMeta && (
          <div className="flex min-w-[92px] max-w-[124px] shrink-0 flex-col items-end pr-3 pb-6 pt-14">
            {rightMeta}
          </div>
        )}
      </button>

      <div
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 border-t border-border/40 px-4 py-2"
      >
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="flex items-center"
            aria-label="Toggle status"
            data-tour="status-toggle"
          >
            <StatusToggle value={status} onChange={onStatusChange} disabled={!canEdit} />
          </button>
          {hasAnyIcon && (
            <div className="flex items-center gap-1 text-[11px]">
              {hasNotes && (
                <CardIconButton onClick={() => handleIconClick(onNotesClick)} active={!!hasNotes} label="View notes">
                  <NotebookPen className="h-3.5 w-3.5" />
                </CardIconButton>
              )}
              {hasAdvisorNote && (
                <CardIconButton onClick={() => handleIconClick(onAdvisorNoteClick)} active={!!hasAdvisorNote} label="Adviser's note">
                  <MessageSquare className="h-3.5 w-3.5" />
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
        <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className="flex items-center gap-2" aria-label="Toggle details" data-tour="expand-card">
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

export function FieldRow({ label, value }: { label: ReactNode; value: ReactNode }) {
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
