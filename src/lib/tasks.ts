// Tasks that keep slipping ("stuck"), and chores people take turns at.
import type { Todo } from "./types";

const DAY = 86_400_000;
/** Pushed back this many times, a task is stuck. */
export const STUCK_AFTER_POSTPONES = 3;
const STUCK_AFTER_OVERDUE_DAYS = 7;
/** Typing a new date in fires several changes: changes this close together are one postponement. */
const ONE_POSTPONEMENT_MS = 10 * 60_000;

/** The postponement record once the due date moves to `next`: later by more than an hour counts. */
export function postponedAfter(t: Todo, next: string | null | undefined, now = new Date()): Todo["postponed"] {
  const kept = t.postponed ?? null;
  if (t.done || !t.dueAt || !next) return kept;
  if (!(Date.parse(next) - Date.parse(t.dueAt) > 3_600_000)) return kept;
  const at = now.toISOString();
  if (kept && now.getTime() - Date.parse(kept.at) < ONE_POSTPONEMENT_MS) return { count: kept.count, at };
  return { count: (kept?.count ?? 0) + 1, at };
}

/** Why a task counts as stuck ("Pushed back 3 times", "Overdue for 9 days"), or null. */
export function stuckReason(t: Todo, now = Date.now()): string | null {
  // Repeating tasks move on by themselves when they're done.
  if (t.done || t.deletedAt || t.rrule) return null;
  if (t.stuckUntil && Date.parse(t.stuckUntil) > now) return null;
  const n = t.postponed?.count ?? 0;
  if (n >= STUCK_AFTER_POSTPONES) return `Pushed back ${n} times`;
  if (t.dueAt) {
    const days = Math.floor((now - Date.parse(t.dueAt)) / DAY);
    if (days >= STUCK_AFTER_OVERDUE_DAYS) return `Overdue for ${days} days`;
  }
  return null;
}

export const stuckTasks = (todos: Todo[], now = Date.now()) =>
  todos.map((t) => ({ todo: t, why: stuckReason(t, now) })).filter((x): x is { todo: Todo; why: string } => Boolean(x.why));

// ---- Chores ---------------------------------------------------------------------------

/** "Me, Andi & Budi" → ["Me", "Andi", "Budi"]. */
export const parseRotation = (s: string) =>
  [...new Set(s.split(/\s*(?:,|&|\band\b|\bdan\b|\n)\s*/i).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 10);

const SELF = /^(me|myself|i|saya|aku|gue|gua)$/i;
/** Is this name the user? "Me", "saya", or the name set in Settings. */
export const isMe = (name: string | null | undefined, myName?: string) =>
  Boolean(name && (SELF.test(name.trim()) || (myName && name.trim().toLowerCase() === myName.trim().toLowerCase())));

/** "Your turn", "Andi's turn". */
export const turnLabel = (name: string, myName?: string) => (isMe(name, myName) ? "Your turn" : `${name}’s turn`);

/**
 * Who does the chore next, after `t` is done: whoever has done it least in the last
 * 90 days, and on a tie the next in line after this one's person. Swapping a turn by
 * hand is fine: whoever did more simply waits longer.
 */
export function nextInRotation(t: Todo, all: Todo[], now = Date.now()): string | null {
  const people = t.rotation?.filter(Boolean) ?? [];
  if (!people.length) return null;
  const key = (s: string) => s.trim().toLowerCase();
  const count = new Map(people.map((p) => [key(p), 0]));
  const tally = (name?: string | null) => {
    if (name && count.has(key(name))) count.set(key(name), count.get(key(name))! + 1);
  };
  for (const x of all) {
    if (x.id === t.id || x.deletedAt || !x.done || x.title !== t.title || !x.completedAt || now - Date.parse(x.completedAt) > 90 * DAY) continue;
    tally(x.assignee);
  }
  tally(t.assignee); // the one just finished
  const at = people.findIndex((p) => key(p) === key(t.assignee ?? ""));
  const order = [...people.slice(at + 1), ...people.slice(0, at + 1)];
  return order.reduce((best, p) => (count.get(key(p))! < count.get(key(best))! ? p : best), order[0]);
}

/** A "your turn" message to send yourself (WhatsApp opens with it filled in; the user picks who and sends). */
export function turnMessageUrl(t: Todo, when?: string) {
  const text = `Hi ${t.assignee}, it's your turn: ${t.title}${when ? ` (${when})` : ""}. Thanks!`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
