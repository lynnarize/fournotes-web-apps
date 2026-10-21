// Shared layout for the Privacy Policy and Terms of Service. Server-rendered and
// static, so Google's verification crawler can read them without running JavaScript.
import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "./Logo";

/** Who to contact about privacy or the terms. Shown on both pages. */
export const CONTACT_EMAIL = "lynnarize@gmail.com";
export const LAST_UPDATED = "September 25, 2026";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] px-4 pb-16 pt-[calc(env(safe-area-inset-top)+16px)] text-[var(--foreground)]">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10 flex items-center justify-between gap-3">
          <Link href="/" className="-ml-2 flex min-h-11 items-center gap-2.5 rounded-[18px] px-2 hover:bg-[var(--hover)]">
            <Logo size={30} />
            <span className="text-base font-medium">Four Notes</span>
          </Link>
          <Link href="/" className="btn btn-secondary max-md:h-11">Open the app</Link>
        </header>

        <h1 className="fn-display text-[40px]">{title}</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Last updated {LAST_UPDATED}</p>

        <div className="legal mt-8">{children}</div>

        <footer className="mt-12 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] pt-4 text-sm text-[var(--text-secondary)]">
          <Link href="/privacy" className="hover:text-[var(--foreground)]">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-[var(--foreground)]">Terms of Service</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[var(--foreground)]">{CONTACT_EMAIL}</a>
        </footer>
      </div>
    </div>
  );
}
