"use client";
// Themes: "system" follows the device; "light", "paper" (warm paper, ink-brown text)
// and "dark" override it. Stored per device (not synced) and applied via <html data-theme="…">.
import { useEffect, useState } from "react";
import { ACCENT_KEY, ACCENTS, THEME_COLORS, THEME_KEY } from "./theme-script";

export type ThemePref = "system" | "light" | "paper" | "dark";
export type ResolvedTheme = "light" | "paper" | "dark";

const EVT = "four-notes:theme-changed";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "paper" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export const resolveTheme = (pref: ThemePref): ResolvedTheme =>
  pref === "system" ? (darkQuery().matches ? "dark" : "light") : pref;

/** Light and paper are both light looks: anything with only two looks treats paper as light. */
export const isDark = (t: ResolvedTheme) => t === "dark";

/** Browser UI (address bar, installed app title bar) follows the chosen theme. */
function syncThemeColor(resolved: ResolvedTheme) {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (m.hasAttribute("media")) m.removeAttribute("media");
    if (m.getAttribute("content") !== THEME_COLORS[resolved]) m.setAttribute("content", THEME_COLORS[resolved]);
  });
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  syncThemeColor(resolved);
  return resolved;
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch { /* storage blocked: still apply for this session */ }
  applyTheme(pref);
  window.dispatchEvent(new Event(EVT));
}

if (typeof window !== "undefined") {
  // The inline script set data-theme before paint, but Next renders the
  // theme-color meta tags after it (and can add more later); keep them in sync.
  applyTheme();
  new MutationObserver(() => syncThemeColor(resolveTheme(getThemePref()))).observe(document.head, { childList: true });
  // Follow the OS switching between light and dark while set to "system".
  darkQuery().addEventListener("change", () => {
    if (getThemePref() !== "system") return;
    applyTheme("system");
    window.dispatchEvent(new Event(EVT));
  });
  // Another tab changed the theme or the accent.
  window.addEventListener("storage", (e) => {
    if (e.key === ACCENT_KEY) {
      applyAccent();
      window.dispatchEvent(new Event(ACCENT_EVT));
      return;
    }
    if (e.key !== THEME_KEY) return;
    applyTheme();
    window.dispatchEvent(new Event(EVT));
  });
}

// ---- Accent ------------------------------------------------------------------
// One hue spent on what is selected or active (Settings → Appearance). Stored per device,
// like the theme, and applied as <html data-accent="…"> before first paint (theme-script.ts).

export type AccentPref = (typeof ACCENTS)[number];
const ACCENT_EVT = "four-notes:accent-changed";

export function getAccent(): AccentPref {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return (ACCENTS as readonly string[]).includes(v ?? "") ? (v as AccentPref) : "neutral";
  } catch {
    return "neutral";
  }
}

export function applyAccent(accent: AccentPref = getAccent()) {
  const root = document.documentElement;
  if (accent === "neutral") delete root.dataset.accent;
  else root.dataset.accent = accent;
}

export function setAccent(accent: AccentPref) {
  try {
    if (accent === "neutral") localStorage.removeItem(ACCENT_KEY);
    else localStorage.setItem(ACCENT_KEY, accent);
  } catch { /* storage blocked: still apply for this session */ }
  applyAccent(accent);
  window.dispatchEvent(new Event(ACCENT_EVT));
}

export function useAccent() {
  const [accent, setState] = useState<AccentPref>("neutral");
  useEffect(() => {
    const update = () => setState(getAccent());
    update();
    window.addEventListener(ACCENT_EVT, update);
    return () => window.removeEventListener(ACCENT_EVT, update);
  }, []);
  return { accent, setAccent };
}

export function useTheme() {
  const [state, setState] = useState<{ pref: ThemePref; resolved: ResolvedTheme }>({ pref: "system", resolved: "light" });
  useEffect(() => {
    const update = () => {
      const pref = getThemePref();
      setState({ pref, resolved: resolveTheme(pref) });
    };
    update();
    window.addEventListener(EVT, update);
    return () => window.removeEventListener(EVT, update);
  }, []);
  return { ...state, setPref: setThemePref };
}
