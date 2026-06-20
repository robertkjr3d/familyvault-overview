import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({ meta: [{ title: "Terms of Service — FamilyVault" }] }),
});

const LAST_UPDATED = "20 June 2026";
// Placeholder — replace with a real, monitored inbox. See chat for details.
const CONTACT_EMAIL = "aza_tan@yahoo.com.sg";

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/90 px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <Link to="/" className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            FamilyVault
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight">Terms of Service</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 text-sm leading-relaxed text-foreground">
        <Section title="Agreement">
          <p>
            By creating an account or using FamilyVault, you agree to these terms. If you don't
            agree, please don't use the app.
          </p>
        </Section>

        <Section title="What FamilyVault is — and isn't">
          <p>
            FamilyVault is a personal record-keeping tool for tracking household finances,
            insurance, property, investments, health notes, and inventory in one place.
          </p>
          <p>
            FamilyVault is not a licensed financial adviser, insurer, bank, or law firm.
            Calculations shown in the app (such as net worth projections, cash flow estimates, or
            insurance coverage ratios) are indicative only, based entirely on the figures you
            enter, and are not financial, tax, legal, or insurance advice. Always confirm
            important decisions with a qualified, licensed professional.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            You're responsible for keeping access to your email account secure, since sign-in
            links are sent there. You're responsible for the accuracy of the information you
            enter, and for who you invite into your household — anyone you invite can see the
            data you've given them access to.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>
            Use FamilyVault only for lawful, personal household record-keeping. Don't attempt to
            access another household's data, disrupt the service, or use the app in a way that
            could harm other users.
          </p>
        </Section>

        <Section title="No warranty">
          <p>
            FamilyVault is provided "as is." We work to keep it reliable and your data intact,
            but we don't guarantee the app will be error-free, uninterrupted, or available at all
            times, and we're not liable for losses arising from reliance on figures or
            calculations shown in the app.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the fullest extent permitted by law, FamilyVault and its operator aren't liable for
            indirect, incidental, or consequential damages arising from your use of the app.
            Nothing in these terms limits liability that can't be excluded under applicable law.
          </p>
        </Section>

        <Section title="Ending your use">
          <p>
            You can stop using FamilyVault at any time. To request deletion of your account and
            data, contact us at the email below.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We may update these terms from time to time. If we make a material change, we'll
            update the date above and let existing users know within the app.
          </p>
        </Section>

        <Section title="Governing law">
          <p>These terms are governed by the laws of Singapore.</p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-primary underline">{CONTACT_EMAIL}</a>
          </p>
        </Section>

        <p className="pt-2 text-xs text-muted-foreground">
          See also our <Link to="/privacy" className="underline">Privacy Policy</Link>.
        </p>

        <Link to="/" className="inline-block pt-2 text-sm font-semibold text-primary underline">
          ← Back to FamilyVault
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
