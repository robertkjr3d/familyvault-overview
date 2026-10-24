import { describe, it, expect, vi } from "vitest";
import { isStaleChunkError, isExtensionNoise, reloadOnceForNewVersion } from "./staleTab";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("isStaleChunkError", () => {
  it("matches Safari, Chrome and Firefox wording", () => {
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
    expect(isStaleChunkError("Failed to fetch dynamically imported module: https://x/a.js")).toBe(
      true,
    );
    expect(isStaleChunkError("error loading dynamically imported module")).toBe(true);
  });
  it("ignores ordinary errors", () => {
    expect(isStaleChunkError("Cannot read properties of undefined")).toBe(false);
  });
});

describe("isExtensionNoise", () => {
  it("matches MetaMask and extension URLs", () => {
    expect(isExtensionNoise("Failed to connect to MetaMask")).toBe(true);
    expect(isExtensionNoise("x", "at chrome-extension://abc/inpage.js:1")).toBe(true);
  });
  it("does not hide real app errors", () => {
    expect(
      isExtensionNoise(
        "Cannot read properties of undefined",
        "at https://app.familyhubsg.com/assets/a.js",
      ),
    ).toBe(false);
  });
});

describe("reloadOnceForNewVersion", () => {
  it("reloads the first time, not again within a minute, again after a minute", () => {
    const s = fakeStorage();
    const reload = vi.fn();
    expect(reloadOnceForNewVersion(s, reload, 1_000_000)).toBe(true);
    expect(reloadOnceForNewVersion(s, reload, 1_030_000)).toBe(false);
    expect(reloadOnceForNewVersion(s, reload, 1_070_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("never reloads when storage is unavailable (no loop risk)", () => {
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(reloadOnceForNewVersion(broken, reload)).toBe(false);
    expect(reloadOnceForNewVersion(undefined, reload)).toBe(false);
  });
});
