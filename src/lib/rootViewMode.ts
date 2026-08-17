// Pure decision logic for what RootContent should render, extracted specifically
// so it can be exhaustively tested with synthetic inputs (no React, no DB) —
// this project has no component-render-testing framework, and the actual JSX
// is a thin switch on this result, so THIS is where a mistake would hide.
export type RootViewMode = "loading" | "sign-in" | "no-access" | "advisor-only" | "family";

export function computeRootViewMode(params: {
  initialized: boolean;
  hasSession: boolean;
  inviteCheckDone: boolean;
  membershipsLoading: boolean;
  membershipsCount: number | null;
  advisorClientsLoading: boolean;
  advisorClientsCount: number | null;
  wantsAdvisorView?: boolean;
}): RootViewMode {
  if (!params.initialized) return "loading";
  if (!params.hasSession) return "sign-in";
  if (!params.inviteCheckDone || params.membershipsLoading) return "loading";

  const memberships = params.membershipsCount ?? 0;
  const advisorClients = params.advisorClientsCount ?? 0;

  // A dual-role person (runs their own family household AND has separate
  // advisor access elsewhere) can explicitly ask to see the advisor view —
  // additive only: nobody who doesn't ask for this is ever affected, and it
  // still requires genuinely having advisor clients, not just asking.
  //
  // REAL BUG (found Aug 17, 2026): memberships usually resolves before the
  // advisor-clients query does. While advisorClientsLoading is still true,
  // advisorClientsCount is null -> advisorClients defaults to 0 below, so the
  // check above used to fail and fall through to "family" for a dual-role
  // user who clicked into the advisor view — flashing the home page for a
  // beat before the advisor-clients query resolved and flipped it over to
  // advisor-only. Fix: while genuinely still loading that count, stay in
  // "loading" instead of guessing "family".
  if (memberships > 0 && params.wantsAdvisorView) {
    if (params.advisorClientsLoading) return "loading";
    if (advisorClients > 0) return "advisor-only";
    // Asked for the advisor view but genuinely has none — fall through below.
  }

  if (memberships > 0) return "family";

  // Zero family memberships from here on — must know the advisor-link state
  // before deciding, or a pure-FA user would flash "no access" for a beat.
  if (params.advisorClientsLoading) return "loading";
  if (advisorClients > 0) return "advisor-only";
  return "no-access";
}
