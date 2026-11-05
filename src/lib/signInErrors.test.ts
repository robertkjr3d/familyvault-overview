import { describe, expect, it } from "vitest";
import {
  passkeyNotice,
  sampleFamilyMessage,
  sendCodeMessage,
  signInIssuePayload,
} from "./signInErrors";

// The exact sentence the owner saw in red (Nov 2026).
const RAW =
  "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.";

// Shape the installed SDK really produces for a browser NotAllowedError: name copied from the
// cause, code ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY, message = the browser's sentence.
const notAllowed = {
  name: "NotAllowedError",
  code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  message: RAW,
};

describe("passkeyNotice", () => {
  it("shows nothing when the person cancels", () => {
    expect(passkeyNotice({ code: "ERROR_CEREMONY_ABORTED", message: "x" })).toBeNull();
    expect(
      passkeyNotice({ name: "AbortError", code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" }),
    ).toBeNull();
    expect(passkeyNotice(null)).toBeNull();
  });
  it("never shows the raw browser sentence, and is soft (not red) for 'no passkey'", () => {
    const n = passkeyNotice(notAllowed)!;
    expect(n.tone).toBe("soft");
    expect(n.text).not.toContain("user agent");
    expect(n.text).toMatch(/Google|emailed code/);
  });
  it("still recognises NotAllowedError when only the original browser error (cause) carries the name", () => {
    const n = passkeyNotice({
      name: "Unknown Error",
      message: RAW,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: { name: "NotAllowedError" },
    })!;
    expect(n.tone).toBe("soft");
  });
  it("explains a failed human check and a rate limit in plain words", () => {
    expect(
      passkeyNotice({
        code: "captcha_failed",
        status: 400,
        message: "captcha verification process failed",
      })!.text,
    ).toMatch(/confirm you're human/);
    expect(passkeyNotice({ status: 429, message: "x" })!.text).toMatch(/Too many tries/);
  });
  it("uses a calm generic message for anything unknown, never the raw text", () => {
    const n = passkeyNotice({ name: "TypeError", message: "Failed to fetch" })!;
    expect(n.tone).toBe("error");
    expect(n.text).not.toContain("Failed to fetch");
  });
});

describe("sampleFamilyMessage", () => {
  it("keeps the original sentence for unknown failures", () => {
    expect(sampleFamilyMessage({ status: 500, message: "boom" })).toBe(
      "We could not open the sample just now. Please try again in a minute.",
    );
    expect(sampleFamilyMessage({ code: "anonymous_provider_disabled", status: 422 })).toMatch(
      /could not open the sample/,
    );
  });
  it("separates a failed human check and a rate limit", () => {
    expect(sampleFamilyMessage({ code: "captcha_failed" })).toMatch(/confirm you're human/);
    expect(sampleFamilyMessage({ code: "over_request_rate_limit", status: 429 })).toMatch(
      /Too many tries/,
    );
  });
});

describe("sendCodeMessage", () => {
  it("passes every ordinary server message through unchanged", () => {
    const m = "For security purposes, you can only request this after 47 seconds.";
    expect(sendCodeMessage({ message: m, status: 429, code: "over_email_send_rate_limit" })).toBe(
      m,
    );
    expect(sendCodeMessage({ message: "Unable to validate email address: invalid format" })).toBe(
      "Unable to validate email address: invalid format",
    );
  });
  it("only replaces the captcha sentence", () => {
    expect(
      sendCodeMessage({ message: "captcha verification process failed", code: "captcha_failed" }),
    ).toMatch(/confirm you're human/);
  });
});

describe("signInIssuePayload", () => {
  it("carries flow, code, status and human-check state, and nothing personal", () => {
    const p = signInIssuePayload(
      "sample_family",
      { code: "captcha_failed", status: 400, message: "secret@example.com" },
      { hadCaptchaToken: false, captchaTimedOut: true },
    );
    expect(p).toEqual({
      flow: "sample_family",
      code: "captcha_failed",
      status: 400,
      had_captcha_token: false,
      captcha_timed_out: true,
    });
    expect(JSON.stringify(p)).not.toContain("secret");
  });
  it("falls back to name, then 'unknown'", () => {
    expect(
      signInIssuePayload(
        "passkey",
        { name: "NotAllowedError" },
        { hadCaptchaToken: true, captchaTimedOut: false },
      ).code,
    ).toBe("NotAllowedError");
    expect(
      signInIssuePayload("passkey", undefined, { hadCaptchaToken: true, captchaTimedOut: false })
        .code,
    ).toBe("unknown");
  });
});
