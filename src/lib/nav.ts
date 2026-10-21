"use client";
// Jump to a specific note, task or transaction from anywhere (search, backlinks,
// daily brief). The page switches tab; the view selects the item when it mounts.
import { useEffect, useRef } from "react";
import { markFiled } from "./highlight";
import type { ChangeLink } from "./store";
import type { Tab } from "./types";

/** "person": a people page in Notes; its id is the person's key (see lib/people.ts). */
export type FocusKind = "note" | "todo" | "transaction" | "budget" | "sticky" | "person" | "talk";
export type Focus = { kind: FocusKind; id: string };

const EVT = "four-notes:open";
let pending: Focus | null = null;

export function openItem(kind: FocusKind, id: string) {
  pending = { kind, id };
  window.dispatchEvent(new CustomEvent<Focus>(EVT, { detail: pending }));
}

/** Views pass their kind; the page shell passes "any" to switch tabs. */
export function useOpenItem(kind: FocusKind | "any", cb: (f: Focus) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const take = (f: Focus | null) => {
      if (!f) return;
      if (kind === "any") return ref.current(f);
      if (f.kind === kind) {
        pending = null;
        ref.current(f);
      }
    };
    if (kind !== "any") take(pending);
    const onOpen = (e: Event) => take((e as CustomEvent<Focus>).detail);
    window.addEventListener(EVT, onOpen);
    return () => window.removeEventListener(EVT, onOpen);
  }, [kind]);
}

const FOCUS: Record<string, FocusKind> = { notes: "note", todos: "todo", transactions: "transaction", budget: "budget", stickies: "sticky" };

/** Jump to something the assistant just changed, and highlight it again. */
export function showChange(link: ChangeLink) {
  if (!link) return;
  // Flash first: the target row reads the flash state when it mounts after the tab switch.
  markFiled([link.id]);
  openItem(FOCUS[link.kind], link.id);
}

const SETTINGS_EVT = "four-notes:open-settings";

export type SettingsTarget = { section?: string; field?: string };
/** A field a settings panel should reveal when it mounts (read once). */
export const SETTINGS_FIELD_KEY = "four-notes:settings-field";

/**
 * Open Settings from anywhere, optionally expanding one section (e.g. "api") and
 * revealing one field in it (e.g. "stt"; the element id is `settings-field-<field>`).
 */
export function openSettings(section?: string, field?: string) {
  try {
    if (field) sessionStorage.setItem(SETTINGS_FIELD_KEY, field);
  } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent<SettingsTarget>(SETTINGS_EVT, { detail: { section, field } }));
}

export function useOpenSettings(cb: (target: SettingsTarget) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<SettingsTarget>).detail ?? {});
    window.addEventListener(SETTINGS_EVT, on);
    return () => window.removeEventListener(SETTINGS_EVT, on);
  }, []);
}

/**
 * Scroll an element into view once the view has rendered it (tab switches mount a
 * frame later). `ready` can hold off until the element is in its final state.
 */
export function scrollToId(domId: string, block: ScrollLogicalPosition = "center", ready?: (el: HTMLElement) => boolean) {
  let tries = 0;
  const attempt = () => {
    const el = document.getElementById(domId);
    if (el && (!ready || ready(el))) {
      // Let the layout settle (expanding sections, entry animation) before measuring.
      return setTimeout(() => el.scrollIntoView({ block, inline: "center", behavior: "smooth" }), 80);
    }
    if (++tries < 60) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

// ---- Tabs ------------------------------------------------------------------------------
const TAB_EVT = "four-notes:open-tab";

/** Go to one of the four places from anywhere (the page shell listens). */
export function openTab(tab: Tab) {
  window.dispatchEvent(new CustomEvent<Tab>(TAB_EVT, { detail: tab }));
}

export function useOpenTab(cb: (tab: Tab) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<Tab>).detail);
    window.addEventListener(TAB_EVT, on);
    return () => window.removeEventListener(TAB_EVT, on);
  }, []);
}

// ---- Assistant ------------------------------------------------------------------------
const ASSISTANT_EVT = "four-notes:open-assistant";

/** Open the assistant from anywhere, optionally with text typed into its box (not sent). */
export function openAssistant(prefill?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(ASSISTANT_EVT, { detail: prefill }));
}

export function useOpenAssistant(cb: (prefill?: string) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<string | undefined>).detail);
    window.addEventListener(ASSISTANT_EVT, on);
    return () => window.removeEventListener(ASSISTANT_EVT, on);
  }, []);
}
