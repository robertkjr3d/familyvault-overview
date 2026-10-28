// Fails if ANY server function can be called by a sample-family guest.
// See src/lib/requireRealUser.ts for why. This test reads the source files.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isGuestClaims } from "./guest";

const SRC = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

// Files allowed to use the admin (service-role) key. Every one is either a server
// function file (checked below) or a scheduled job that no browser can call.
const ADMIN_KEY_ALLOWED = new Set(
  [
    "integrations/supabase/client.server.ts",
    "integrations/supabase/client.ts", // only mentions it in a comment
    "lib/requireRealUser.ts", // only mentions it in a comment
    "lib/accountDeletion.ts",
    "lib/advisorAccess.ts",
    "lib/auditLog.ts",
    "lib/householdInvites.ts",
    "lib/fxRateCron.ts", // scheduled job, not callable from a browser
  ].map((f) => path.join(SRC, f)),
);

describe("every server function blocks guests", () => {
  const found: { file: string; name: string; header: string }[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const re = /export const (\w+)\s*=\s*createServerFn\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const rest = text.slice(m.index);
      const end = rest.indexOf(".handler(");
      found.push({
        file: f,
        name: m[1],
        header: end === -1 ? rest.slice(0, 400) : rest.slice(0, end),
      });
    }
    // A server function that is not a plain `export const x = createServerFn(` would escape the
    // check above, so refuse that shape outright.
    const all = (text.match(/createServerFn\(/g) ?? []).length;
    const exported = (text.match(/export const \w+\s*=\s*createServerFn\(/g) ?? []).length;
    it(`${path.relative(SRC, f)}: every createServerFn is a plain exported const`, () => {
      expect(all).toBe(exported);
    });
  }

  it("finds the server functions (sanity check, so this test cannot silently pass on nothing)", () => {
    expect(found.length).toBeGreaterThanOrEqual(28);
  });

  for (const fn of found) {
    it(`${fn.name} uses requireRealUser`, () => {
      expect(fn.header).toMatch(/\.middleware\(\[\s*requireRealUser\s*\]\)/);
      expect(fn.header).not.toMatch(/requireSupabaseAuth/);
    });
  }

  it("requireSupabaseAuth is used nowhere except inside requireRealUser", () => {
    const users = files.filter((f) => /requireSupabaseAuth/.test(readFileSync(f, "utf8")));
    const rel = users.map((f) => path.relative(SRC, f)).sort();
    expect(rel).toEqual(["integrations/supabase/auth-middleware.ts", "lib/requireRealUser.ts"]);
  });

  it("only known files use the admin key", () => {
    const users = files.filter((f) => /supabaseAdmin|client\.server/.test(readFileSync(f, "utf8")));
    const unexpected = users
      .filter((f) => !ADMIN_KEY_ALLOWED.has(f))
      .map((f) => path.relative(SRC, f));
    expect(unexpected).toEqual([]);
  });

  it("no route file defines its own server handler (they would skip the guard)", () => {
    const routes = files.filter((f) => f.includes(`${path.sep}routes${path.sep}`));
    const bad = routes.filter((f) =>
      /\bserver:\s*\{|\bhandlers:\s*\{/.test(readFileSync(f, "utf8")),
    );
    expect(bad.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

describe("isGuestClaims fails closed", () => {
  it("treats anonymous tokens as guests", () => {
    expect(isGuestClaims({ is_anonymous: true })).toBe(true);
    expect(isGuestClaims({ app_metadata: { provider: "anonymous" } })).toBe(true);
  });
  it("treats missing claims as a guest", () => {
    expect(isGuestClaims(null)).toBe(true);
    expect(isGuestClaims(undefined)).toBe(true);
  });
  it("lets normal users through", () => {
    expect(isGuestClaims({ is_anonymous: false })).toBe(false);
    expect(isGuestClaims({ app_metadata: { provider: "email" } })).toBe(false);
    expect(isGuestClaims({})).toBe(false);
  });
});
