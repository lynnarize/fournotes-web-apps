"use client";
// Cloud sync with Supabase. Active only when NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY are set; otherwise the app stays local-only.
//
// How it works (see GUIDE.md -> "How sync works"):
// - The local store is always written first, so the UI is instant and works offline.
// - Push: rows whose updatedAt is newer than the last successful push are upserted.
//   A database trigger ignores writes older than the stored row (newer wins).
// - Pull: rows whose server-side synced_at is newer than the last pull are merged.
// - Realtime notifies other devices, which then pull.
// - Deletions are soft (deletedAt), so they sync like any other edit.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { ListKind } from "./store";
import type { Note, Space, Sticky, Todo, Transaction } from "./types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const cloudEnabled = Boolean(URL_ && ANON);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!cloudEnabled) return null;
  return (client ??= createClient(URL_!, ANON!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
}

type Row = Note | Todo | Transaction | Sticky;

// Fields synced per table (camelCase locally, snake_case in Postgres).
// Image thumbnails stay local; upload them to Storage when you need them on other devices.
const COMMON = ["id", "spaceId", "createdAt", "updatedAt", "deletedAt"];
const FIELDS: Record<ListKind, string[]> = {
  notes: [...COMMON, "title", "content", "html", "source", "tags", "keepCurrent"],
  todos: [
    ...COMMON, "title", "notes", "done", "doing", "completedAt", "dueAt", "remindAt", "reminded", "priority", "source", "rrule", "bill", "noteId",
    "postponed", "stuckUntil", "rotation", "assignee",
  ],
  transactions: [...COMMON, "merchant", "amount", "currency", "fxRate", "category", "date", "items", "source", "splits", "noteId"],
  stickies: [...COMMON, "text", "color", "pinned"],
};
export const KINDS: ListKind[] = ["notes", "todos", "transactions", "stickies"];
const NUMERIC = new Set(["amount", "fxRate"]);

const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

function toRow(kind: ListKind, item: Row) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS[kind]) out[snake(k)] = (item as unknown as Record<string, unknown>)[k] ?? null;
  return out;
}

function fromRow(kind: ListKind, row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS[kind]) {
    const v = row[snake(k)];
    if (v === null || v === undefined) continue;
    out[k] = NUMERIC.has(k) ? Number(v) : v;
  }
  return out as unknown as Row;
}

// ---- Sync cursors (per user, per browser) ----------------------------------
const cursorKey = (userId: string) => `four-notes:sync:${userId}`;
export function getCursors(userId: string): { pulledAt: string; pushedAt: string } {
  try {
    return { pulledAt: "1970-01-01T00:00:00Z", pushedAt: "1970-01-01T00:00:00Z", ...JSON.parse(localStorage.getItem(cursorKey(userId)) ?? "{}") };
  } catch {
    return { pulledAt: "1970-01-01T00:00:00Z", pushedAt: "1970-01-01T00:00:00Z" };
  }
}
export function setCursors(userId: string, p: Partial<{ pulledAt: string; pushedAt: string }>) {
  localStorage.setItem(cursorKey(userId), JSON.stringify({ ...getCursors(userId), ...p }));
}

// ---- Data -------------------------------------------------------------------
export async function pull(since: string): Promise<{ rows: Record<ListKind, Row[]>; maxSyncedAt: string }> {
  const sb = supabase()!;
  let maxSyncedAt = since;
  const rows = {} as Record<ListKind, Row[]>;
  await Promise.all(
    KINDS.map(async (kind) => {
      const { data, error } = await sb.from(kind).select("*").gt("synced_at", since).order("synced_at").limit(2000);
      if (error) throw error;
      rows[kind] = (data ?? []).map((r) => {
        if (r.synced_at > maxSyncedAt) maxSyncedAt = r.synced_at;
        return fromRow(kind, r);
      });
    }),
  );
  return { rows, maxSyncedAt };
}

export async function push(kind: ListKind, items: Row[]) {
  if (!items.length) return;
  const sb = supabase()!;
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await sb.from(kind).upsert(items.slice(i, i + 500).map((x) => toRow(kind, x)), { onConflict: "id" });
    if (error) throw error;
  }
}

export function subscribe(onChange: () => void) {
  const sb = supabase()!;
  const channel = sb.channel("four-notes-sync");
  for (const table of KINDS) channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  channel.subscribe();
  return () => { sb.removeChannel(channel); };
}

// ---- Auth --------------------------------------------------------------------
export const auth = {
  getSession: async (): Promise<Session | null> => (await supabase()!.auth.getSession()).data.session,
  onChange: (cb: (s: Session | null) => void) => {
    const { data } = supabase()!.auth.onAuthStateChange((_e, s) => cb(s));
    return () => data.subscription.unsubscribe();
  },
  sendMagicLink: async (email: string) => {
    const { error } = await supabase()!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) throw error;
  },
  signInWithGoogle: async () => {
    const { error } = await supabase()!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) throw error;
  },
  signOut: async () => { await supabase()!.auth.signOut(); },
};

// ---- Shared spaces --------------------------------------------------------------
export const spaces = {
  list: async (): Promise<Space[]> => {
    const { data, error } = await supabase()!.from("spaces").select("id, name, invite_code").order("created_at");
    if (error) throw error;
    return (data ?? []).map((s) => ({ id: s.id, name: s.name, inviteCode: s.invite_code }));
  },
  create: async (name: string): Promise<string> => {
    const { data, error } = await supabase()!.rpc("create_space", { space_name: name });
    if (error) throw error;
    return data as string;
  },
  join: async (code: string): Promise<string> => {
    const { data, error } = await supabase()!.rpc("join_space", { code: code.trim() });
    if (error) throw error;
    return data as string;
  },
  leave: async (spaceId: string) => {
    const { error } = await supabase()!.rpc("leave_space", { target: spaceId });
    if (error) throw error;
  },
};
