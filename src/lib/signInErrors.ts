/**
 * Plain-language messages for sign-in failures, plus a small, privacy-safe diagnostic event.
 *
 * Why this exists: the sign-in screen used to show the browser's or server's own sentence.
 * For passkeys that was "The request is not allowed by the user agent or the platform in the
 * current context, possibly because the user denied permission" — shown in red to anyone who
 * simply has no passkey (or cancelled). Duck-typed on purpose (no SDK imports) so it is
 * trivially unit-testable and cannot break if the SDK's class names move.
 */
export type AuthErrorLike =
  | { name?: string; message?: string; code?: string; status?: number; cause?: unknown }
  | null
  | undefined;

/** `soft` = informational (grey), `error` = something actually went wrong (red). */
export type Notice = { text: string; tone: "soft" | "error" };

const CAPTCHA_TEXT = "We couldn't confirm you're human. Please try once more.";
const RATE_LIMIT_TEXT = "Too many tries just now. Please wait a minute and try again.";

// The SDK copies the browser error's name onto its own error, and keeps the original as `cause`.
// Checking both means we still recognise it if the name is ever not copied across.
function causeName(err: AuthErrorLike): string | undefined {
  const cause = err?.cause as { name?: unknown } | undefined;
  return typeof cause?.name === "string" ? cause.name : undefined;
}

function isCaptchaFailure(err: AuthErrorLike): boolean {
  return err?.code === "captcha_failed" || /captcha/i.test(err?.message ?? "");
}

function isRateLimited(err: AuthErrorLike): boolean {
  return (
    err?.status === 429 ||
    err?.code === "over_request_rate_limit" ||
    err?.code === "over_email_send_rate_limit"
  );
}

/**
 * Passkey sign-in failure -> what to show. Returns null for "show nothing".
 * - A ceremony that was aborted by the page itself (the SDK's ERROR_CEREMONY_ABORTED, or a bare
 *   AbortError): the person did nothing wrong. Show nothing.
 * - NotAllowedError: the browser's catch-all for "no passkey available here", "tapped Cancel", or
 *   "timed out". Checked against the installed SDK: it passes this through with name
 *   NotAllowedError and the long technical sentence. Not a real failure.
 */
export function passkeyNotice(err: AuthErrorLike): Notice | null {
  if (!err) return null;
  if (err.code === "ERROR_CEREMONY_ABORTED" || err.name === "AbortError") return null;
  if (isCaptchaFailure(err)) return { text: CAPTCHA_TEXT, tone: "error" };
  if (isRateLimited(err)) return { text: RATE_LIMIT_TEXT, tone: "error" };
  if (err.name === "NotAllowedError" || causeName(err) === "NotAllowedError") {
    return {
      text: "No passkey was used. If you haven't set one up on this device, use Google or the emailed code instead.",
      tone: "soft",
    };
  }
  return {
    text: "Passkey sign-in didn't work this time. Please try again, or use Google or the emailed code.",
    tone: "error",
  };
}

/** "Look around a sample family" failure. Unknown failures keep the original sentence. */
export function sampleFamilyMessage(err: AuthErrorLike): string {
  if (isCaptchaFailure(err)) return CAPTCHA_TEXT;
  if (isRateLimited(err)) return RATE_LIMIT_TEXT;
  return "We could not open the sample just now. Please try again in a minute.";
}

/** "Email me a code" failure: only the unfriendly captcha sentence is replaced; every other
 * server message (rate limits with their countdown, etc.) is shown exactly as before. */
export function sendCodeMessage(err: { message: string } & AuthErrorLike): string {
  return isCaptchaFailure(err) ? CAPTCHA_TEXT : err.message;
}

export type SignInFlow = "passkey" | "sample_family" | "email_code";

/** What gets sent to analytics: which flow, the error's code/status, and whether the human
 * check had produced a token. Never an email, never message text, never a token. */
export function signInIssuePayload(
  flow: SignInFlow,
  err: AuthErrorLike,
  ctx: { hadCaptchaToken: boolean; captchaTimedOut: boolean },
) {
  return {
    flow,
    code: err?.code ?? err?.name ?? "unknown",
    status: typeof err?.status === "number" ? err.status : null,
    had_captcha_token: ctx.hadCaptchaToken,
    captcha_timed_out: ctx.captchaTimedOut,
  };
}

/** Fire-and-forget. Analytics being blocked (privacy tools) must never affect sign-in. */
export function reportSignInIssue(
  flow: SignInFlow,
  err: AuthErrorLike,
  ctx: { hadCaptchaToken: boolean; captchaTimedOut: boolean },
): void {
  try {
    const posthog = (window as unknown as { posthog?: { capture: (e: string, p: object) => void } })
      .posthog;
    posthog?.capture("sign_in_issue", signInIssuePayload(flow, err, ctx));
  } catch {
    // analytics blocked: ignore
  }
}
