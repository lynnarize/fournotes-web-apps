"use client";
// Notes that disagree: two notes stating the same fact differently (a Wi-Fi password, an
// address, a meeting time). Notes that share enough words are paired up here, and the
// assistant reads only those pairs. Every quote it returns must really be in its note,
// so a made-up conflict never reaches the screen.
import { api } from "./client";
import { isQuick } from "./quickNote";
import type { Note } from "./types";

export type Conflict = { key: string; topic: string; a: { note: Note; quote: string }; b: { note: Note; quote: string } };

const STOP = new Set(
  ("the and for with that this from have has was are you your not but all can will just into our out about what when then than them they " +
    "yang dan untuk dengan ini itu dari ada akan bisa juga sudah belum tidak atau karena pada saya aku kamu kita mereka").split(" "),
);
const words = (n: Note) =>
  new Set(`${n.title} ${n.content}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));

/** The most alike pairs among recent notes: each note in at most three. */
export function candidatePairs(notes: Note[], max = 8): [Note, Note][] {
  const pool = notes.filter((n) => !n.deletedAt && !isQuick(n) && n.content.trim().length > 20).slice(0, 80);
  const sets = pool.map(words);
  const scored: { i: number; j: number; s: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      let shared = 0;
      for (const w of sets[i]) if (sets[j].has(w)) shared++;
      const s = shared / (sets[i].size + sets[j].size - shared || 1);
      if (shared >= 3 && s >= 0.08) scored.push({ i, j, s });
    }
  }
  scored.sort((x, y) => y.s - x.s);
  const uses = new Map<number, number>();
  const out: [Note, Note][] = [];
  for (const { i, j } of scored) {
    if ((uses.get(i) ?? 0) >= 3 || (uses.get(j) ?? 0) >= 3) continue;
    uses.set(i, (uses.get(i) ?? 0) + 1);
    uses.set(j, (uses.get(j) ?? 0) + 1);
    out.push([pool[i], pool[j]]);
    if (out.length >= max) break;
  }
  return out;
}

const DISMISSED = "four-notes:conflicts-dismissed";
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISSED) ?? "[]"); } catch { return []; } };
/** "Not a conflict": never shown again for these two notes and this topic. */
export function dismissConflict(key: string) {
  try { localStorage.setItem(DISMISSED, JSON.stringify([...readDismissed(), key].slice(-300))); } catch { /* storage blocked */ }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const quoted = (n: Note, q: string) => q.trim().length > 0 && norm(`${n.title}\n${n.content}`).includes(norm(q));

export async function findConflicts(notes: Note[]): Promise<{ pairs: number; conflicts: Conflict[] }> {
  const pairs = candidatePairs(notes);
  if (!pairs.length) return { pairs: 0, conflicts: [] };
  const cut = (n: Note) => ({ title: n.title || "Untitled", content: n.content.slice(0, 1500) });
  const res = await api.agent("conflicts", { pairs: pairs.map(([a, b]) => ({ a: cut(a), b: cut(b) })) });
  const dismissed = new Set(readDismissed());
  const out: Conflict[] = [];
  for (const c of res.conflicts) {
    const pair = pairs[Math.round(c.pair) - 1];
    if (!pair) continue;
    const [a, b] = pair;
    if (!quoted(a, c.a) || !quoted(b, c.b) || norm(c.a) === norm(c.b)) continue;
    const key = `${[a.id, b.id].sort().join(":")}:${norm(c.topic)}`;
    if (dismissed.has(key) || out.some((x) => x.key === key)) continue;
    out.push({ key, topic: c.topic.trim(), a: { note: a, quote: c.a.trim() }, b: { note: b, quote: c.b.trim() } });
  }
  return { pairs: pairs.length, conflicts: out };
}
