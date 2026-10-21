"use client";
// People pages, built from what you've already written. The assistant reads notes a few
// at a time and lists who's in them and what they say about each person; that's kept in
// this browser and redone only for notes that changed. Tasks naming someone, chores they
// take turns at and bills they haven't settled are matched here, with no AI at all.
import { useSyncExternalStore } from "react";
import { api } from "./client";
import { isQuick } from "./quickNote";
import { isMe } from "./tasks";
import type { Note, Todo, Transaction } from "./types";

type Found = { name: string; facts: string[] };
type Cache = Record<string, { at: string; people: Found[] }>; // by note id; `at` = the note's updatedAt when read
const KEY = "four-notes:people:v1";

let cache: Cache | null = null;
const listeners = new Set<() => void>();
const load = (): Cache => (cache ??= (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Cache; } catch { return {}; } })());
const save = (c: Cache) => {
  cache = c;
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full: kept for this session */ }
  for (const fn of listeners) fn();
};
const EMPTY: Cache = {};
const useCache = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, load, () => EMPTY);

/** Notes worth reading for people: with some text, not quick jottings, not read since they last changed. */
export function unread(notes: Note[]) {
  const c = load();
  return notes.filter((n) => !n.deletedAt && !isQuick(n) && n.content.trim().length >= 30 && c[n.id]?.at !== n.updatedAt);
}

const BATCH = 6;
/** Reads up to `limit` unread notes, a batch at a time. Returns how many it read. */
export async function readPeople(notes: Note[], limit = 30, onProgress?: (done: number, total: number) => void) {
  const todo = unread(notes).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const res = await api.agent("people", {
      notes: batch.map((n, k) => ({ id: String(k + 1), title: n.title || "Untitled", content: n.content.slice(0, 2000) })),
    });
    const next = { ...load() };
    batch.forEach((n, k) => {
      const found = res.notes.find((x) => x.id.trim() === String(k + 1))?.people ?? [];
      next[n.id] = {
        at: n.updatedAt,
        people: found
          .map((p) => ({ name: p.name.trim().slice(0, 60), facts: p.facts.map((f) => f.trim().slice(0, 160)).filter(Boolean).slice(0, 5) }))
          .filter((p) => p.name && !isMe(p.name)),
      };
    });
    save(next);
    done += batch.length;
    onProgress?.(done, todo.length);
  }
  return done;
}

export type Person = {
  key: string;
  name: string;
  mentions: { note: Note; facts: string[] }[];
  tasks: Todo[];
  chores: Todo[];
  owes: { tx: Transaction; amount: number }[];
  last: string; // ISO: the latest note or task that names them
};

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "Andi" matches "Call Andi", not "Andini". Full names match on their first word too. */
const names = (name: string) => {
  const first = name.trim().split(/\s+/)[0];
  return new RegExp(`(^|[^\\p{L}])(${esc(name.trim())}${first.length >= 3 && first !== name.trim() ? `|${esc(first)}` : ""})(?![\\p{L}])`, "iu");
};

/** Everyone in your notes, with what's known about each: most recently mentioned first. */
export function usePeople(data: { notes: Note[]; todos: Todo[]; transactions: Transaction[] }): Person[] {
  const c = useCache();
  const byKey = new Map<string, Person>();
  const person = (name: string) => {
    const k = keyOf(name);
    let p = byKey.get(k);
    if (!p) byKey.set(k, (p = { key: k, name: name.trim(), mentions: [], tasks: [], chores: [], owes: [], last: "" }));
    return p;
  };
  for (const n of data.notes) {
    if (n.deletedAt) continue;
    for (const f of c[n.id]?.people ?? []) {
      const p = person(f.name);
      p.mentions.push({ note: n, facts: f.facts });
      if (n.updatedAt > p.last) p.last = n.updatedAt;
    }
  }
  // Split bills and chores name people too, even ones no note mentions.
  for (const t of data.transactions) {
    if (t.deletedAt) continue;
    for (const s of t.splits ?? []) if (!s.settled && s.amount > 0 && !isMe(s.name)) person(s.name).owes.push({ tx: t, amount: s.amount });
  }
  for (const t of data.todos) {
    if (t.deletedAt || t.done) continue;
    for (const r of t.rotation ?? []) if (!isMe(r)) person(r).chores.push(t);
  }
  const people = [...byKey.values()];
  const tests = people.map((p) => ({ p, re: names(p.name) }));
  for (const t of data.todos) {
    if (t.deletedAt || t.rotation?.length) continue;
    for (const { p, re } of tests) {
      if (!re.test(`${t.title} ${t.notes ?? ""}`)) continue;
      p.tasks.push(t);
      if (t.updatedAt > p.last) p.last = t.updatedAt;
    }
  }
  for (const p of people) {
    p.tasks.sort((a, b) => Number(a.done) - Number(b.done) || (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~"));
    p.mentions.sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt));
    if (!p.last) p.last = p.owes[0]?.tx.updatedAt ?? p.chores[0]?.updatedAt ?? "";
  }
  return people.sort((a, b) => b.last.localeCompare(a.last));
}

/** The people a task names, for its "about" chips. */
export function peopleIn(text: string, people: Person[]) {
  return people.filter((p) => p.mentions.length && names(p.name).test(text));
}
