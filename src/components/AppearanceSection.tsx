"use client";
// Settings → Appearance: the theme as four cards with a small preview each
// (System, Light, Paper, Dark), and the accent as six round swatches.
import { useEffect, useState } from "react";
import { isMac } from "@/lib/hooks";
import { useAccent, useTheme, type AccentPref, type ThemePref } from "@/lib/theme";
import { SettingsGroup, SettingsRow } from "./SettingsSection";
import { Icon } from "./ui";

const OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "paper", label: "Paper" },
  { id: "dark", label: "Dark" },
];

// Fixed colours on purpose: each card previews its theme whatever the current one is.
const PREVIEW = {
  light: { bg: "#ffffff", edge: "#ececec", title: "#222222", line: "#d9d9d9" },
  paper: { bg: "#fbf6e8", edge: "#ece3cb", title: "#3a3326", line: "#e2d7bb" },
  dark: { bg: "#232323", edge: "#333333", title: "#f2f2f2", line: "#4a4a4a" },
};

/** A page in miniature: a heading bar and two lines of text. */
function Mini({ look, lines = 2 }: { look: keyof typeof PREVIEW; lines?: 1 | 2 }) {
  const p = PREVIEW[look];
  return (
    <span className="block h-full min-w-0 flex-1 p-2.5" style={{ background: p.bg }}>
      <span className="block h-1.5 w-1/2 rounded-[3px]" style={{ background: p.title }} />
      <span className="mt-1.5 block h-1 w-3/4 rounded-sm" style={{ background: p.line }} />
      {lines === 2 && <span className="mt-1 block h-1 w-3/5 rounded-sm" style={{ background: p.line }} />}
    </span>
  );
}

// Each swatch shows its hue as the current theme draws it; "neutral" is the theme's own ink.
const ACCENT_SWATCHES: { id: AccentPref; label: string; light: string; dark: string }[] = [
  { id: "neutral", label: "Neutral", light: "oklch(30% 0 0)", dark: "oklch(92% 0 0)" },
  { id: "blue", label: "Blue", light: "#0562ef", dark: "#6ba3ff" },
  { id: "violet", label: "Violet", light: "#7747ff", dark: "#a78bff" },
  { id: "green", label: "Green", light: "#0db879", dark: "#53dca6" },
  { id: "coral", label: "Coral", light: "#f15f55", dark: "#ff9386" },
  { id: "rose", label: "Rose", light: "#ed4e9d", dark: "#ff8bc5" },
];
const swatchColor = (s: (typeof ACCENT_SWATCHES)[number], theme: "light" | "paper" | "dark") =>
  theme === "dark" ? s.dark : theme === "paper" && s.id === "neutral" ? "oklch(34% 0.03 60)" : s.light;

/** The four looks as radio cards, each with a small preview. Also used in first-run setup. */
export function ThemeCards({ className = "grid grid-cols-2 gap-3 sm:grid-cols-4" }: { className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={className}>
      {OPTIONS.map((o) => {
        const active = pref === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPref(o.id)}
            className={`flex flex-col gap-2 rounded-[22px] border bg-[var(--surface)] px-1.5 pb-2.5 pt-1.5 text-left transition-[border-color,box-shadow] ${
              active ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-subtle)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
          >
            {/* Corners: 22 outside, 6 padding, so 16 inside. */}
            <span
              aria-hidden
              className="flex h-[72px] overflow-hidden rounded-[16px] border"
              style={{ borderColor: o.id === "system" ? "var(--border-subtle)" : PREVIEW[o.id as keyof typeof PREVIEW].edge }}
            >
              {o.id === "system" ? (
                <>
                  <Mini look="light" lines={1} />
                  <Mini look="dark" lines={1} />
                </>
              ) : (
                <Mini look={o.id as keyof typeof PREVIEW} />
              )}
            </span>
            <span className={`flex items-center gap-1.5 px-1.5 ${active ? "font-medium" : ""}`}>
              <span className="flex-1">{o.label}</span>
              {active && <Icon name="check" size={16} className="text-[var(--accent)]" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Six round swatches, one per accent. Also used in first-run setup. */
export function AccentSwatches({ labelledBy, label, className = "" }: { labelledBy?: string; label?: string; className?: string }) {
  const { resolved } = useTheme();
  const { accent, setAccent } = useAccent();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={`flex flex-wrap gap-1.5 ${className}`}>
      {ACCENT_SWATCHES.map((s) => {
        const on = accent === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={s.label}
            title={s.label}
            onClick={() => setAccent(s.id)}
            // 28px swatch, 44px touch target on phones (the padding is transparent).
            className="grid h-11 w-11 place-items-center rounded-full sm:h-8 sm:w-8"
          >
            <span
              className="block h-7 w-7 rounded-full transition-shadow"
              style={{
                background: swatchColor(s, resolved),
                boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--foreground)" : "inset 0 0 0 1px oklch(0% 0 0 / 0.08)",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

export default function AppearanceSection() {
  const { pref, resolved } = useTheme();
  // The shortcut label depends on the platform, which the server can't know.
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="mb-2.5 p-0 font-medium">Theme</legend>
        <ThemeCards />
        <p className="mt-2.5 text-[13px] text-[var(--text-muted)]">
          {pref === "system"
            ? `Follows your device, currently ${resolved}.`
            : pref === "paper" ? "Warm paper and ink-brown text, whatever your device uses." : `Always ${pref}, whatever your device uses.`}{" "}
          Switch quickly with {mac ? "⌘" : "Ctrl+"}K, then “dark mode”.
        </p>
      </fieldset>

      <SettingsGroup>
        <SettingsRow label="Accent" description="Used for what's selected or active">
          {(labelId) => <AccentSwatches labelledBy={labelId} />}
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
