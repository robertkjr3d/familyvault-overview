import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({ meta: [{ title: "Privacy Policy — FamilyHub SG" }] }),
});

const LAST_UPDATED = "20 June 2026";
// Placeholder — replace with a real, monitored inbox. See chat for details.
const CONTACT_EMAIL = "support@familyhubsg.com";

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/90 px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <Link to="/" className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            FamilyHub SG
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 text-sm leading-relaxed text-foreground">
        <Section title="What this is">
          <p>
            FamilyHub SG is a household finance and household tracker. This policy explains what
            information we collect when you use it, how it's stored, who can see it, and how to
            reach us with questions or requests.
          </p>
        </Section>

        <Section title="Information we collect">
          <p>We collect information you choose to enter into the app, which may include:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Your email address, used solely to send you a secure sign-in link</li>
            <li>Household and family member details you add (names, relationships)</li>
            <li>Financial information you enter — properties, loans, insurance policies, investments, savings and CPF balances, and other assets</li>
            <li>Health-related notes you choose to add for yourself or family members</li>
            <li>Inventory items and any photos or documents you upload</li>
            <li>Notes, reminders, and history you add against any record</li>
          </ul>
          <p>We do not ask for or store payment card numbers, passwords (sign-in is passwordless via emailed link), or government ID numbers.</p>
        </Section>

        <Section title="How your data is stored and protected">
          <p>
            Your data is stored with Supabase (database, authentication, and file storage) and the
            app itself is served via Cloudflare. Connections to FamilyHub SG are encrypted in
            transit (HTTPS).
          </p>
          <p>
            FamilyHub SG is built around households. Each household's data is kept separate from
            every other household by database-level access rules — your data isn't visible to
            other households using the app. If you invite someone to join your household, they
            gain the level of access you grant them to that household's data.
          </p>
        </Section>

        <Section title="Who can see your data">
          <p>
            Only people you've explicitly invited into your household, plus FamilyHub SG's
            operator for the limited purpose of running and maintaining the service. We do not
            sell your data, and we do not share it with advertisers — FamilyHub SG does not run
            ads or third-party analytics or tracking scripts.
          </p>
          <p>
            We use Supabase and Cloudflare as infrastructure providers to operate the service;
            they process data on our behalf under their own data protection commitments, and
            don't use your data for their own purposes.
          </p>
        </Section>

        <Section title="Cookies and local storage">
          <p>
            FamilyHub SG uses your browser's local storage to keep you signed in and to remember a
            small number of display preferences (such as light/dark mode and reminder thresholds).
            We don't use advertising or cross-site tracking cookies.
          </p>
        </Section>

        <Section title="Exporting and deleting your data">
          <p>
            You can export your household's data at any time from Settings → Data, as an Excel
            workbook covering every record in the app. If you'd like your account and data
            permanently deleted, contact us at the email below and we'll action it.
          </p>
        </Section>

        <Section title="Children's information">
          <p>
            FamilyHub SG is intended for use by adults managing household records. A parent or
            guardian may enter information about their children (for example, a child's health
            note) as part of managing the household — FamilyVault itself does not knowingly
            collect information directly from children.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If this policy changes in a meaningful way, we'll update the date above and let
            existing users know within the app.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions, data requests, or concerns: <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-primary underline">{CONTACT_EMAIL}</a>
          </p>
        </Section>

        <p className="pt-2 text-xs text-muted-foreground">
          This policy is provided as general information about how FamilyHub SG handles data and
          is not a substitute for legal advice.
        </p>

        <Link to="/" className="inline-block pt-2 text-sm font-semibold text-primary underline">
          ← Back to FamilyHub SG
        </Link>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}
