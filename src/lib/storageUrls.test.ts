import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Fake Supabase client: records every signing request so we can count them.
const createSignedUrls = vi.fn();
const createSignedUrl = vi.fn();
let authCallback: ((event: string) => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrls, createSignedUrl }) },
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

type Mod = typeof import("./storageUrls");
let m: Mod;

const okBatch = (paths: string[], tag = "t1") => ({
  data: paths.map((p) => ({ path: p, signedUrl: `https://x/${p}?token=${tag}`, error: null })),
  error: null,
});

async function settle() {
  await vi.advanceTimersByTimeAsync(30);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal("window", {});
  createSignedUrls.mockReset();
  createSignedUrl.mockReset();
  authCallback = null;
  m = await import("./storageUrls");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getCachedDisplayUrl", () => {
  it("fetches photos requested at the same moment in ONE request", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const all = Promise.all(
      ["a.jpg", "b.jpg", "c.jpg"].map((p) => m.getCachedDisplayUrl("inventory-photos", p)),
    );
    await settle();
    const urls = await all;
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0][0]).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(urls).toEqual([
      "https://x/a.jpg?token=t1",
      "https://x/b.jpg?token=t1",
      "https://x/c.jpg?token=t1",
    ]);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("reuses the same link afterwards (no new request, identical URL)", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const first = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    const u1 = await first;
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).toBe(u1);
    const u2 = await m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    expect(u2).toBe(u1);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("asks only once when the same photo is requested twice at the same moment", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const a = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    const b = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    expect(await a).toBe(await b);
    expect(createSignedUrls.mock.calls[0][0]).toEqual(["a.jpg"]);
  });

  it("stops reusing a link after 50 minutes (links live 60)", async () => {
    createSignedUrls
      .mockImplementationOnce(async (p: string[]) => okBatch(p, "old"))
      .mockImplementationOnce(async (p: string[]) => okBatch(p, "new"));
    const first = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    expect(await first).toContain("old");
    await vi.advanceTimersByTimeAsync(49 * 60 * 1000);
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).toContain("old");
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).toBeNull();
    const again = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    expect(await again).toContain("new");
  });

  it("splits very large lists into chunks of 50", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const paths = Array.from({ length: 120 }, (_, i) => `p${i}.jpg`);
    const all = Promise.all(paths.map((p) => m.getCachedDisplayUrl("inventory-photos", p)));
    await settle();
    await all;
    expect(createSignedUrls.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
  });

  it("falls back to one-by-one signing if the batch request itself fails", async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: new Error("boom") });
    createSignedUrl.mockImplementation(async (p: string) => ({
      data: { signedUrl: `https://x/${p}?single` },
      error: null,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const all = Promise.all(
      ["a.jpg", "b.jpg"].map((p) => m.getCachedDisplayUrl("inventory-photos", p)),
    );
    await settle();
    expect(await all).toEqual(["https://x/a.jpg?single", "https://x/b.jpg?single"]);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("gives null (and no retry storm) for a photo the server says is missing", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "a.jpg", signedUrl: "https://x/a.jpg?t", error: null },
        { path: "gone.jpg", signedUrl: null, error: "Object not found" },
      ],
      error: null,
    });
    const a = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    const gone = m.getCachedDisplayUrl("inventory-photos", "gone.jpg");
    await settle();
    expect(await a).toBe("https://x/a.jpg?t");
    expect(await gone).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns null straight away when there is no path", async () => {
    expect(await m.getCachedDisplayUrl("inventory-photos", null)).toBeNull();
    expect(await m.getCachedDisplayUrl("inventory-photos", "")).toBeNull();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("understands old full-URL rows the same way the original code did", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const p = m.getCachedDisplayUrl(
      "inventory-photos",
      "https://abc.supabase.co/storage/v1/object/public/inventory-photos/h1/items/1-a.jpg",
    );
    await settle();
    await p;
    expect(createSignedUrls.mock.calls[0][0]).toEqual(["h1/items/1-a.jpg"]);
  });

  it("invalidate forces a fresh link", async () => {
    createSignedUrls
      .mockImplementationOnce(async (p: string[]) => okBatch(p, "one"))
      .mockImplementationOnce(async (p: string[]) => okBatch(p, "two"));
    const first = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    await first;
    m.invalidateCachedDisplayUrl("inventory-photos", "a.jpg");
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).toBeNull();
    const second = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    expect(await second).toContain("two");
  });
});

describe("sign-out", () => {
  it("forgets every remembered link", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const p = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    await p;
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).not.toBeNull();
    authCallback?.("SIGNED_OUT");
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).toBeNull();
  });

  it("does not remember links that were still being fetched when sign-out happened", async () => {
    let release: (v: unknown) => void = () => {};
    createSignedUrls.mockImplementation(
      (paths: string[]) => new Promise((res) => (release = () => res(okBatch(paths)))),
    );
    const p = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle(); // request is now in flight
    authCallback?.("SIGNED_OUT");
    release(null);
    await p;
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).toBeNull();
  });

  it("ignores other auth events such as token refresh", async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => okBatch(paths));
    const p = m.getCachedDisplayUrl("inventory-photos", "a.jpg");
    await settle();
    await p;
    authCallback?.("TOKEN_REFRESHED");
    expect(m.peekCachedDisplayUrl("inventory-photos", "a.jpg")).not.toBeNull();
  });
});

describe("unchanged behaviour (Documents list and exports)", () => {
  it("getDisplayUrl still makes one fresh single link every time and never uses the cache", async () => {
    createSignedUrl
      .mockResolvedValueOnce({ data: { signedUrl: "https://x/d.pdf?1" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://x/d.pdf?2" }, error: null });
    expect(await m.getDisplayUrl("vault-docs", "d.pdf")).toBe("https://x/d.pdf?1");
    expect(await m.getDisplayUrl("vault-docs", "d.pdf")).toBe("https://x/d.pdf?2");
    expect(createSignedUrl).toHaveBeenNthCalledWith(1, "d.pdf", 3600);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("getExportUrl still uses the 10-year link", async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/e" }, error: null });
    await m.getExportUrl("inventory-photos", "e.jpg");
    expect(createSignedUrl).toHaveBeenCalledWith("e.jpg", 60 * 60 * 24 * 365 * 10);
  });
});
