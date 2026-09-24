import { MessageCircleHeart } from "lucide-react";
import { FEEDBACK_FORM_URL, feedbackClickHandler } from "@/lib/feedback";

// Persistent, always-visible way to give feedback — deliberately NOT a
// one-time banner or a first-visit-only prompt. The whole point is that
// someone invited from Reddit/elsewhere (or a long-time family user) can
// leave feedback the moment they think of something, at any point while
// using the app, not just once on their first visit. Rendered once,
// globally, in __root.tsx — only for the real signed-in/has-a-household
// state (not on the sign-in screen, not for the advisor-only view).
//
// Placed bottom-LEFT, opposite AddRecordFab's bottom-right position, so it
// never competes with or crowds the primary "add a record" action, and
// deliberately smaller (h-12 vs AddRecordFab's h-14) so it reads as
// secondary. Sits at bottom-24 to clear BottomTabs the same way
// AddRecordFab already does on a 375px-wide screen.
export function FeedbackTab() {
  return (
    <a
      href={FEEDBACK_FORM_URL}
      target="_blank"
      rel="noreferrer"
      onClick={feedbackClickHandler("global_tab")}
      aria-label="Give feedback — we're in beta and read every response"
      title="Give feedback — we're in beta and read every response"
      className="fixed bottom-24 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition-transform duration-150 ease-out active:scale-95"
    >
      <MessageCircleHeart className="h-5 w-5" />
    </a>
  );
}
