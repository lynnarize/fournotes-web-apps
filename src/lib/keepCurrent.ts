"use client";
// Notes kept current: a note you mark is checked against the web now and then (a week
// or a month apart), and what has changed since you wrote it waits on the note until
// you add it in or dismiss it. Web search is Claude's, so this needs a Claude key, the
// user's or the server's. The note itself is written to only when something changed,
// so a quiet check doesn't move it to the top of "Last edited".
import { serverStatus } from "./aiRoute";
import { activeProvider, getUserKeys, keysReady } from "./byok";
import { api } from "./client";
import type { KeepCurrent, Note } from "./types";

const DAY = 86_400_000;
const GAP: Record<KeepCurrent["every"], number> = { week: 7 * DAY, month: 30 * DAY };
const CHECKED = "four-notes:rechecked"; // { [noteId]: ISO } — this browser's last check of each note

const readChecked = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(CHECKED) ?? "{}"); } catch { return {}; } };
const markChecked = (id: string, at: string) => {
  try { localStorage.setItem(CHECKED, JSON.stringify({ ...readChecked(), [id]: at })); } catch { /* storage blocked */ }
};

/** When this note was last looked at: here, or (synced) wherever its changes were last found. */
export function lastChecked(n: Note): string | null {
  const here = readChecked()[n.id];
  const there = n.keepCurrent?.checkedAt ?? null;
  return here && (!there || here > there) ? here : there;
}

export function isDue(n: Note, now = Date.now()) {
  if (!n.keepCurrent || n.deletedAt || n.keepCurrent.update?.changed) return false;
  const last = lastChecked(n);
  return !last || now - Date.parse(last) >= GAP[n.keepCurrent.every];
}

/** Can this setup search the web? Only Claude can, with the user's key or the server's. */
export async function canSearchWeb() {
  await keysReady();
  const own = activeProvider(getUserKeys());
  if (own) return own === "anthropic";
  return Boolean((await serverStatus()).anthropic);
}

export const NEEDS_CLAUDE = "Keeping a note current searches the web, which needs Claude. Add an Anthropic key in Settings → AI & API keys.";

/** Checks one note now. Saves the changes on the note when there are any; returns whether there were. */
export async function recheckNote(n: Note, updateNote: (id: string, p: Partial<Note>) => void): Promise<boolean> {
  if (!n.keepCurrent) return false;
  const since = lastChecked(n) ?? n.updatedAt;
  const res = await api.recheck(n.title, n.content, since);
  const at = new Date().toISOString();
  markChecked(n.id, at);
  if (res.changed) updateNote(n.id, { keepCurrent: { ...n.keepCurrent, checkedAt: at, update: { at, ...res } } });
  return res.changed;
}

/** The changes, as a section added to the end of the note. */
export function updateSection(u: NonNullable<KeepCurrent["update"]>) {
  const day = new Date(u.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const sources = u.sources.length ? `\nSources: ${u.sources.map((s) => `[${s.title}](${s.url})`).join(", ")}` : "";
  return `## Updated ${day}\n${u.changes.map((c) => `- ${c}`).join("\n")}${sources}`;
}
