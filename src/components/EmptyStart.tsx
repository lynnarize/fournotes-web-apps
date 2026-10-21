"use client";
// Empty state that teaches: tap an example and the assistant does it, so the
// first item in the app is the user's own rather than seeded demo data.
import type { ReactNode } from "react";
import { useAssistant } from "./assistant";
import { SampleDataButton } from "./SampleData";

export default function EmptyStart({ title, hint, prompts, extra, showSample = true }: {
  title: string;
  hint: string;
  prompts: string[];
  extra?: ReactNode;
  showSample?: boolean;
}) {
  const { send, busy } = useAssistant();
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] px-6 py-8 text-center">
      <div className="text-lg font-medium">{title}</div>
      <p className="max-w-[420px] text-[var(--text-secondary)]">{hint}</p>

      <div role="group" aria-label="Try saying" className="mt-2 flex flex-wrap justify-center gap-2">
        {prompts.map((p) => (
          <button key={p} type="button" disabled={!!busy} onClick={() => send(p)} className="pill disabled:opacity-45 max-md:h-11">
            “{p}”
          </button>
        ))}
      </div>

      {(extra || showSample) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {extra}
          {showSample && <SampleDataButton />}
        </div>
      )}
    </div>
  );
}
