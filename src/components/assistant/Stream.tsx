"use client";
// Replies arrive whole. As in the AI composer and AI chat blocks, one that just landed is
// revealed a few words at a time (about a hundred words a second, the newest line fading in);
// one you have already seen is drawn at once, here or anywhere else it shows. Never replayed.
import { useEffect, useMemo, useState } from "react";

/** Messages already drawn once: they never animate again. */
const known = new Set<string>();

/** Everything in the conversation so far counts as seen (a view calls this as it mounts). */
export function markSeen(ids: string[]) {
  for (const id of ids) known.add(id);
}

/** True the first time a message is drawn after it was sent or received, and only then. */
export function useFresh(id: string) {
  const [fresh] = useState(() => {
    const first = !known.has(id);
    known.add(id);
    return first;
  });
  return fresh;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A cut mid-reply: close a bold or code span it left open, and drop a half-written [n]. */
function tidy(partial: string) {
  let t = partial.replace(/\[\d*$/, "");
  if ((t.match(/\*\*/g)?.length ?? 0) % 2) t += "**";
  if ((t.match(/`/g)?.length ?? 0) % 2) t += "`";
  return t;
}

/** The part of a reply to draw now, and whether more is still to come. */
export function useReveal(text: string, animate: boolean): { shown: string; revealing: boolean } {
  const words = useMemo(() => text.match(/\S+\s*/g) ?? [], [text]);
  const [count, setCount] = useState(() => (animate && !reducedMotion() ? 0 : Number.POSITIVE_INFINITY));

  useEffect(() => {
    if (count >= words.length) return;
    // Three to eight words a step, every 34ms; a long reply takes bigger steps (2.5s at most).
    const step = Math.max(3, Math.ceil(words.length / 74));
    let n = count;
    let last = 0;
    let raf = 0;
    const tick = (t: number) => {
      if (t - last >= 34) {
        last = t;
        n = Math.min(words.length, n + step + Math.floor(Math.random() * 3));
        setCount(n);
      }
      if (n < words.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The reveal runs once per reply; count is its own progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  const revealing = count < words.length;
  return { shown: revealing ? tidy(words.slice(0, count).join("")) : text, revealing };
}
