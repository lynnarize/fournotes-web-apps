"use client";
import { useEffect, useReducer, useState } from "react";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Whether a media query matches now (false until mounted). */
export function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

// ---- "Install app" prompt (Chrome/Edge/Android) ----------------------------
type InstallEvent = Event & { prompt(): Promise<void> };
let deferred: InstallEvent | null = null;
const subscribers = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    subscribers.forEach((f) => f());
  });
}

/** Returns a function that shows the install prompt, or null when unavailable. */
export function useInstallPrompt() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(rerender);
    return () => { subscribers.delete(rerender); };
  }, []);
  if (!deferred) return null;
  return async () => {
    await deferred?.prompt();
    deferred = null;
    subscribers.forEach((f) => f());
  };
}

/**
 * Keeps a pop-up mounted for `ms` after it's closed so it can animate out.
 * `state` goes on the element as data-state ("open" | "closing") for the CSS.
 */
export function usePresence(open: boolean, ms = 200) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    if (!mounted) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setMounted(false), reduce ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, mounted, ms]);
  return { mounted: open || mounted, state: (open ? "open" : "closing") as "open" | "closing" };
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * The current time, refreshed every minute and when the app comes back into view, so
 * anything time-based (like Today's greeting) doesn't go stale while the app stays open.
 */
export function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, everyMs);
    const onShow = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", tick);
    };
  }, [everyMs]);
  return now;
}

/** Greeting for the device's local time, as the macOS app words it: morning until noon, afternoon until 6. */
export function greetingFor(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
