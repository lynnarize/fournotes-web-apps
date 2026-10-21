"use client";
// Banner + button for the optional sample data.
import { useStore } from "@/lib/store";
import { Icon, useToast } from "./ui";

const BUTTON = "btn btn-secondary max-md:h-11";

export function SampleDataButton({ label = "Explore with sample data", className }: { label?: string; className?: string }) {
  const { loadSamples, hasSamples } = useStore();
  const toast = useToast();
  if (hasSamples) return null;
  return (
    <button
      type="button"
      className={className ?? BUTTON}
      onClick={() => {
        loadSamples();
        toast("Sample data added. Remove it any time from the banner at the top or in Settings.");
      }}
    >
      {label}
    </button>
  );
}

export function RemoveSamplesButton({ className }: { className?: string }) {
  const { clearSamples, hasSamples } = useStore();
  const toast = useToast();
  if (!hasSamples) return null;
  return (
    <button
      type="button"
      className={className ?? BUTTON}
      onClick={() => {
        clearSamples();
        toast("Sample data removed. Only your own items are left.");
      }}
    >
      Remove sample data
    </button>
  );
}

/** Thin strip shown while sample data is present, so it's never mistaken for real data. */
export default function SampleBanner() {
  const { hasSamples, clearSamples } = useStore();
  const toast = useToast();
  if (!hasSamples) return null;
  return (
    <div
      className="no-print flex min-h-11 items-center md:min-h-9 justify-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] px-4 text-[13px] text-[var(--text-secondary)]"
      role="status"
    >
      <Icon name="sparkle" size={14} className="shrink-0 text-[var(--accent)]" />
      <span>You&apos;re looking at sample data. It isn&apos;t saved to the cloud.</span>
      <button
        className="btn btn-sm btn-plain font-medium text-[var(--foreground)] max-md:h-11"
        onClick={() => {
          clearSamples();
          toast("Sample data removed.");
        }}
      >
        Remove
      </button>
    </div>
  );
}
