"use client";
// Talks live in this browser's IndexedDB, not with the rest of the data in localStorage:
// an hour's transcript is tens of kilobytes and its recording megabytes, which would
// soon fill localStorage. Nothing here is synced; "Save to Notes" is how a talk travels.
import { useSyncExternalStore } from "react";
import type { Talk } from "../types";

const DB = "four-notes-talks";
const TALKS = "talks";
const AUDIO = "audio"; // talk id -> Blob (the whole recording, mixed)
/** Deleted talks (and their audio) are kept this long for Undo, then removed for good. */
const PURGE_AFTER_MS = 7 * 86_400_000;

let opening: Promise<IDBDatabase> | null = null;
function db() {
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(TALKS, { keyPath: "id" });
      req.result.createObjectStore(AUDIO);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---- The in-memory list the UI reads -----------------------------------------------
let talks: Talk[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const all = await run<Talk[]>(TALKS, "readonly", (s) => s.getAll());
    const cutoff = Date.now() - PURGE_AFTER_MS;
    for (const t of all.filter((x) => x.deletedAt && Date.parse(x.deletedAt) < cutoff)) void purge(t.id);
    // A talk left "recording" by a closed tab: keep what it has and finish it.
    talks = all
      .filter((x) => !(x.deletedAt && Date.parse(x.deletedAt) < cutoff))
      .map((x) => (x.status === "recording" ? { ...x, status: "transcribing" as const } : x))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (e) {
    console.warn("[talks] couldn't open the talks database", e);
  }
  emit();
}

const EMPTY: Talk[] = [];
/** Every talk, newest first (deleted ones included: filter with `alive`). */
export function useTalks(): Talk[] {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); void load(); return () => listeners.delete(fn); },
    () => (loaded ? talks : EMPTY),
    () => EMPTY,
  );
}

export const allTalks = () => talks;
export const getTalk = (id: string) => talks.find((t) => t.id === id);
export const talksReady = () => load();

function put(t: Talk) {
  talks = [t, ...talks.filter((x) => x.id !== t.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  emit();
  run(TALKS, "readwrite", (s) => s.put(t)).catch((e) => console.warn("[talks] couldn't save", e));
}

export function addTalk(t: Talk) {
  put(t);
  return t;
}

/** Changes a talk. `fn` gets the latest copy, so updates from the recorder never overwrite each other. */
export function updateTalk(id: string, p: Partial<Talk> | ((t: Talk) => Partial<Talk>)) {
  const t = getTalk(id);
  if (!t) return;
  put({ ...t, ...(typeof p === "function" ? p(t) : p), updatedAt: new Date().toISOString() });
}

export const removeTalk = (id: string) => updateTalk(id, { deletedAt: new Date().toISOString() });

async function purge(id: string) {
  await run(TALKS, "readwrite", (s) => s.delete(id)).catch(() => {});
  await run(AUDIO, "readwrite", (s) => s.delete(id)).catch(() => {});
}

export const saveAudio = (id: string, blob: Blob) => run(AUDIO, "readwrite", (s) => s.put(blob, id));
export const loadAudio = (id: string) => run<Blob | undefined>(AUDIO, "readonly", (s) => s.get(id)).catch(() => undefined);
