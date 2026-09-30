import { describe, it, expect } from "vitest";
import { stripUrlSecrets } from "./sentryReport";

describe("stripUrlSecrets", () => {
  it("removes an invite query string, including the invited email", () => {
    expect(stripUrlSecrets("https://app.familyhubsg.com/?invite=abc123&email=a%40b.com")).toBe(
      "https://app.familyhubsg.com/",
    );
  });
  it("removes an auth hash fragment", () => {
    expect(stripUrlSecrets("https://app.familyhubsg.com/#access_token=xyz&refresh_token=q")).toBe(
      "https://app.familyhubsg.com/",
    );
  });
  it("removes both query and hash, keeping the path", () => {
    expect(stripUrlSecrets("https://app.familyhubsg.com/loans?code=1#record-9")).toBe(
      "https://app.familyhubsg.com/loans",
    );
  });
  it("leaves a clean URL and relative paths alone", () => {
    expect(stripUrlSecrets("https://app.familyhubsg.com/settings")).toBe(
      "https://app.familyhubsg.com/settings",
    );
    expect(stripUrlSecrets("/loans?x=1")).toBe("/loans");
  });
  it("never throws on empty or missing input", () => {
    expect(stripUrlSecrets("")).toBe("");
    expect(stripUrlSecrets(undefined as unknown as string)).toBe("");
  });
});
