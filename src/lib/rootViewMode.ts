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
}): RootViewMode {
  if (!params.initialized) return "loading";
  if (!params.hasSession) return "sign-in";
  if (!params.inviteCheckDone || params.membershipsLoading) return "loading";

  const memberships = params.membershipsCount ?? 0;
  if (memberships > 0) return "family";

  // Zero family memberships from here on — must know the advisor-link state
  // before deciding, or a pure-FA user would flash "no access" for a beat.
  if (params.advisorClientsLoading) return "loading";
  const advisorClients = params.advisorClientsCount ?? 0;
  if (advisorClients > 0) return "advisor-only";
  return "no-access";
}
