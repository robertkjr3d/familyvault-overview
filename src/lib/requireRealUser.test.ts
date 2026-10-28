import { it, expect } from "vitest";
import { requireRealUser } from "@/lib/requireRealUser";
it("requireRealUser rejects guests and lets normal users through", async () => {
  const srv = (requireRealUser as any).options.server;
  expect(typeof srv).toBe("function");
  const next = async () => "NEXT";
  await expect(srv({ next, context: { claims: { is_anonymous: true } } })).rejects.toThrow(
    /view-only/,
  );
  await expect(srv({ next, context: { claims: undefined } })).rejects.toThrow();
  expect(await srv({ next, context: { claims: { is_anonymous: false, email: "a@b.c" } } })).toBe(
    "NEXT",
  );
  expect((requireRealUser as any).options.middleware?.length).toBe(1);
});
