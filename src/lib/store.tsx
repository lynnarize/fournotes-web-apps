"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { equalSplit } from "./insights";
import { EXPENSE_CATEGORIES } from "./types";
import { nextAfterCompleting } from "./recurrence";
import { buildSamples, SAMPLE_BUDGETS } from "./sample";
import type {
  AIAction,
  AnswerSource,
  ClientContext,
  DailyBrief,
  ExpenseCategory,
  MonthlySummary,
  Note,
  Settings,
  Space,
  Sticky,
  Todo,
  Transaction,
} from "./types";
import { localIso } from "./client";
import { quickNote } from "./quickNote";
import { nextInRotation, postponedAfter } from "./tasks";

// ---------------------------------------------------------------------------
// Persistence adapter. The app always saves locally first (instant UI, works
// offline). Cloud sync runs on top of it in <CloudSync/> when Supabase is
// configured — see src/lib/sync.ts and GUIDE.md -> "Sync backend".
// ---------------------------------------------------------------------------
export interface AppData {
  notes: Note[];
  todos: Todo[];
  transactions: Transaction[];
  stickies: Sticky[];
  summaries: MonthlySummary[];
  briefs: DailyBrief[];
  settings: Settings;
  spaces: Space[];
  currentSpaceId: string | null; // null = personal
}

export type ListKind = "notes" | "todos" | "transactions" | "stickies";

export interface StorageAdapter {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
}

const KEY = "four-notes:v1";

export const localAdapter: StorageAdapter = {
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },
  async save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save (storage full?)", e);
    }
  },
};

const DEFAULT_SETTINGS: Settings = { currency: "IDR", budgets: {}, voiceReplies: true };

/** Fill in fields added after the first release so older saved data keeps working. */
function normalize(d: Partial<AppData>): AppData {
  return {
    notes: d.notes ?? [],
    todos: d.todos ?? [],
    transactions: d.transactions ?? [],
    stickies: d.stickies ?? [],
    summaries: d.summaries ?? [],
    briefs: d.briefs ?? [],
    settings: { ...DEFAULT_SETTINGS, ...d.settings, budgets: { ...d.settings?.budgets } },
    spaces: d.spaces ?? [],
    currentSpaceId: d.currentSpaceId ?? null,
  };
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const nowIso = () => new Date().toISOString();
/** Local calendar date / month (toISOString() is UTC and would be wrong early morning in Jakarta). */
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const localMonth = (d = new Date()) => localDate(d).slice(0, 7);
const stamp = () => {
  const t = nowIso();
  return { id: uid(), createdAt: t, updatedAt: t, deletedAt: null };
};

/** A new install starts completely empty — no demo rows to clean up.
 *  Sample data is opt-in (Settings, the welcome screen, or any empty state). */
function seed(): AppData {
  return normalize({});
}

// ---------------------------------------------------------------------------
/** Where one filed item lives, so the chat can jump to it (null: nothing to show). */
export type ChangeLink = { kind: ListKind; id: string } | { kind: "budget"; id: string } | null;

export interface ApplyResult {
  filed: string[];
  /** Same order and length as `filed`. */
  links: ChangeLink[];
  transactionIds: string[];
  /** Ids of everything created/changed, so the UI can highlight it. */
  created: { kind: ListKind; id: string }[];
}

type Ctx = AppData & {
  ready: boolean;
  /** Unfiltered data (all spaces), for sync and export. */
  all: AppData;
  addNote(p: Partial<Note>): Note;
  updateNote(id: string, p: Partial<Note>): void;
  addTodo(p: Partial<Todo>): Todo;
  updateTodo(id: string, p: Partial<Todo>): void;
  /** Complete / reopen. Completing a recurring task schedules the next one; bills log a transaction. */
  toggleTodo(id: string, done: boolean): string[];
  addTransaction(p: Partial<Transaction>): Transaction;
  updateTransaction(id: string, p: Partial<Transaction>): void;
  addSticky(p: Partial<Sticky>): Sticky;
  updateSticky(id: string, p: Partial<Sticky>): void;
  remove(kind: ListKind, id: string): void;
  saveSummary(s: MonthlySummary): void;
  saveBrief(b: DailyBrief): void;
  updateSettings(p: Partial<Settings>): void;
  setBudget(category: ExpenseCategory, amount: number | null): void;
  /** All categories in use (built-in + custom). */
  categories: string[];
  /** True while the optional sample data is loaded. */
  hasSamples: boolean;
  loadSamples(): void;
  clearSamples(): void;
  /** Returns the created name, or null when it's empty or a duplicate. */
  addCategory(name: string): string | null;
  removeCategory(name: string): void;
  /** Apply settings from another device when they are newer. Does not bump timestamps. */
  mergeSettings(remote?: Partial<Settings>): void;
  setSpaces(spaces: Space[]): void;
  switchSpace(id: string | null): void;
  /** Merge rows pulled from the cloud; newer updatedAt wins. Does not bump timestamps. */
  mergeRemote(kind: ListKind, rows: BaseRow[]): void;
  applyActions(actions: AIAction[], extra?: { imageDataUrl?: string; source?: Note["source"] }): ApplyResult;
  /** `sources`: the numbered items a question's answer may cite as [n] (see answerSources in search.ts). */
  buildContext(relevantNotes?: Note[], sources?: AnswerSource[]): ClientContext;
};
type BaseRow = Note | Todo | Transaction | Sticky;

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children, adapter = localAdapter }: { children: ReactNode; adapter?: StorageAdapter }) {
  const [data, setData] = useState<AppData>(() => normalize({}));
  const [ready, setReady] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    adapter.load().then((d) => {
      if (!d) {
        // Brand new install: offer the first-run setup (see components/Onboarding.tsx).
        try { localStorage.setItem("four-notes:onboarding", "pending"); } catch { /* storage blocked */ }
      }
      setData(d ?? seed());
      setReady(true);
    });
  }, [adapter]);

  const fromOtherTab = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (fromOtherTab.current) { fromOtherTab.current = false; return; } // already saved by the other tab
    adapter.save(data);
  }, [data, ready, adapter]);

  // Keep tabs in sync when the same app is open twice in one browser.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) {
        try { fromOtherTab.current = true; setData(normalize(JSON.parse(e.newValue))); } catch { fromOtherTab.current = false; }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const patchList = useCallback(
    <K extends ListKind>(kind: K, id: string, p: Partial<AppData[K][number]>) =>
      setData((d) => ({
        ...d,
        [kind]: (d[kind] as AppData[K][number][]).map((x) =>
          x.id === id ? { ...x, ...p, updatedAt: nowIso() } : x,
        ),
      })),
    [],
  );

  const api = useMemo(() => {
    const space = () => dataRef.current.currentSpaceId;
    const addNote = (p: Partial<Note>) => {
      const n: Note = { ...stamp(), spaceId: space(), title: "Untitled", content: "", source: "manual", tags: [], ...p };
      setData((d) => ({ ...d, notes: [n, ...d.notes] }));
      return n;
    };
    const addTodo = (p: Partial<Todo>) => {
      const t: Todo = { ...stamp(), spaceId: space(), title: "New task", done: false, priority: "medium", source: "manual", dueAt: null, remindAt: null, ...p };
      setData((d) => ({ ...d, todos: [t, ...d.todos] }));
      return t;
    };
    const addTransaction = (p: Partial<Transaction>) => {
      const t: Transaction = {
        ...stamp(), spaceId: space(), merchant: "Unknown", amount: 0, currency: dataRef.current.settings.currency,
        category: "Other", date: localDate(), items: [], source: "manual", ...p,
      };
      setData((d) => ({ ...d, transactions: [t, ...d.transactions] }));
      return t;
    };
    const addSticky = (p: Partial<Sticky>) => {
      const s: Sticky = { ...stamp(), spaceId: space(), text: "", color: "yellow", ...p };
      setData((d) => ({ ...d, stickies: [...d.stickies, s] }));
      return s;
    };

    const toggleTodo = (id: string, done: boolean): string[] => {
      const t = dataRef.current.todos.find((x) => x.id === id);
      if (!t || t.done === done) return [];
      const out: string[] = [];
      patchList("todos", id, { done, completedAt: done ? nowIso() : null });
      if (!done) return out;

      if (t.bill && t.bill.amount > 0) {
        addTransaction({
          merchant: t.title, amount: t.bill.amount, currency: t.bill.currency || dataRef.current.settings.currency,
          category: t.bill.category, date: localDate(), noteId: t.noteId ?? null, spaceId: t.spaceId ?? null,
        });
        out.push(`💸 Logged bill: ${t.title}`);
      }
      if (t.rrule) {
        const rrule = t.rrule;
        const base = t.dueAt ?? t.remindAt ?? nowIso();
        // Roll forward: completing a task that was due months ago must not schedule the next one in the past.
        const nextDue = t.dueAt ? nextAfterCompleting(t.dueAt, rrule) : null;
        const nextRemind = t.remindAt ? nextAfterCompleting(t.remindAt, rrule) : null;
        const dueAt = nextDue ?? (t.remindAt ? null : nextAfterCompleting(base, rrule));
        // Already scheduled (ticked, unticked and ticked again): not twice.
        const scheduled = dataRef.current.todos.some((x) =>
          !x.deletedAt && !x.done && x.id !== t.id && x.title === t.title && x.rrule === rrule && (x.dueAt ?? null) === dueAt && (x.remindAt ?? null) === nextRemind);
        if (!scheduled) {
          addTodo({
            title: t.title, notes: t.notes, priority: t.priority, source: t.source, rrule, bill: t.bill,
            noteId: t.noteId, spaceId: t.spaceId ?? null, dueAt, remindAt: nextRemind, reminded: false,
            // A chore goes to whoever's turn is next.
            ...(t.rotation?.length ? { rotation: t.rotation, assignee: nextInRotation(t, dataRef.current.todos) } : {}),
          });
          out.push(`🔁 Next: ${t.title}`);
        }
      }
      return out;
    };

    return {
      addNote, addTodo, addTransaction, addSticky, toggleTodo,
      updateNote: (id: string, p: Partial<Note>) => patchList("notes", id, p),
      updateTodo: (id: string, p: Partial<Todo>) => {
        // Moving the due date later counts towards "stuck" (see lib/tasks.ts).
        const t = p.dueAt !== undefined && p.postponed === undefined ? dataRef.current.todos.find((x) => x.id === id) : undefined;
        patchList("todos", id, t ? { ...p, postponed: postponedAfter(t, p.dueAt) } : p);
      },
      updateTransaction: (id: string, p: Partial<Transaction>) => patchList("transactions", id, p),
      updateSticky: (id: string, p: Partial<Sticky>) => patchList("stickies", id, p),
      // Soft delete keeps a tombstone so sync can propagate deletions.
      remove: (kind: ListKind, id: string) => patchList(kind, id, { deletedAt: nowIso() } as never),
      saveSummary: (s: MonthlySummary) =>
        setData((d) => ({ ...d, summaries: [s, ...d.summaries.filter((x) => x.month !== s.month)] })),
      saveBrief: (b: DailyBrief) =>
        setData((d) => ({ ...d, briefs: [b, ...d.briefs.filter((x) => x.date !== b.date)].slice(0, 14) })),
      updateSettings: (p: Partial<Settings>) => setData((d) => ({ ...d, settings: { ...d.settings, ...p, updatedAt: nowIso() } })),
      setBudget: (category: ExpenseCategory, amount: number | null) =>
        setData((d) => {
          const budgets = { ...d.settings.budgets };
          if (amount && amount > 0) budgets[category] = amount;
          else delete budgets[category];
          return { ...d, settings: { ...d.settings, budgets, updatedAt: nowIso() } };
        }),
      mergeSettings: (remote?: Partial<Settings>) =>
        setData((d) => {
          if (!remote?.updatedAt || remote.updatedAt <= (d.settings.updatedAt ?? "")) return d;
          return {
            ...d,
            settings: {
              ...d.settings,
              currency: remote.currency ?? d.settings.currency,
              budgets: remote.budgets ?? d.settings.budgets,
              categories: remote.categories ?? d.settings.categories,
              name: remote.name ?? d.settings.name,
              voiceReplies: remote.voiceReplies ?? d.settings.voiceReplies,
              updatedAt: remote.updatedAt,
            },
          };
        }),
      addCategory: (name: string) => {
        const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
        const existing = categoriesOf(dataRef.current.settings);
        if (!clean || existing.some((c) => c.toLowerCase() === clean.toLowerCase())) return null;
        setData((d) => ({
          ...d,
          settings: { ...d.settings, categories: [...(d.settings.categories ?? []), clean], updatedAt: nowIso() },
        }));
        return clean;
      },
      removeCategory: (name: string) =>
        setData((d) => ({
          ...d,
          settings: {
            ...d.settings,
            categories: (d.settings.categories ?? []).filter((c) => c !== name),
            budgets: Object.fromEntries(Object.entries(d.settings.budgets).filter(([c]) => c !== name)),
            updatedAt: nowIso(),
          },
        })),
      loadSamples: () =>
        setData((d) => {
          if ([d.notes, d.todos, d.transactions, d.stickies].some((list) => list.some((x) => x.sample))) return d;
          const s = buildSamples(uid, d.settings.currency);
          const budgets = Object.keys(d.settings.budgets).length ? d.settings.budgets : { ...s.budgets };
          return {
            ...d,
            notes: [...s.notes, ...d.notes],
            todos: [...s.todos, ...d.todos],
            transactions: [...s.transactions, ...d.transactions],
            stickies: [...d.stickies, ...s.stickies],
            settings: { ...d.settings, budgets, updatedAt: nowIso() },
          };
        }),
      clearSamples: () =>
        setData((d) => {
          const own = <T extends { sample?: boolean }>(xs: T[]) => xs.filter((x) => !x.sample);
          const budgets = { ...d.settings.budgets };
          // Only clear budgets the sample set added, never ones the user changed.
          for (const [category, value] of Object.entries(SAMPLE_BUDGETS)) if (budgets[category] === value) delete budgets[category];
          return {
            ...d,
            notes: own(d.notes),
            todos: own(d.todos),
            transactions: own(d.transactions),
            stickies: own(d.stickies),
            settings: { ...d.settings, budgets, updatedAt: nowIso() },
          };
        }),
      setSpaces: (spaces: Space[]) =>
        setData((d) => {
          const currentSpaceId = spaces.some((s) => s.id === d.currentSpaceId) ? d.currentSpaceId : null;
          if (currentSpaceId === d.currentSpaceId && JSON.stringify(spaces) === JSON.stringify(d.spaces)) return d;
          return { ...d, spaces, currentSpaceId };
        }),
      switchSpace: (id: string | null) => setData((d) => ({ ...d, currentSpaceId: id })),
      mergeRemote: (kind: ListKind, rows: BaseRow[]) =>
        setData((d) => {
          if (!rows.length) return d;
          const byId = new Map((d[kind] as BaseRow[]).map((x) => [x.id, x]));
          let changed = false;
          for (const r of rows) {
            const local = byId.get(r.id);
            if (!local || r.updatedAt > local.updatedAt) {
              // Keep local-only fields (image thumbnails) when the cloud row lacks them.
              byId.set(r.id, { ...local, ...r } as BaseRow);
              changed = true;
            }
          }
          if (!changed) return d;
          const list = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return { ...d, [kind]: kind === "stickies" ? list.reverse() : list };
        }),

      applyActions(actions: AIAction[], extra?: { imageDataUrl?: string; source?: Note["source"] }): ApplyResult {
        const filed: string[] = [];
        const links: ChangeLink[] = [];
        const transactionIds: string[] = [];
        const created: { kind: ListKind; id: string }[] = [];
        const file = (label: string, link: ChangeLink) => {
          filed.push(label);
          links.push(link);
          if (link && link.kind !== "budget") created.push(link);
        };
        const source = extra?.source ?? "chat";
        const refs = new Map<string, string>(); // AI ref -> created note id
        // Notes first so tasks and spending in the same batch can link to them.
        const ordered = [...actions].sort((a, b) => Number(b.type === "create_note") - Number(a.type === "create_note"));
        const fallbackNote = () => (refs.size === 1 ? [...refs.values()][0] : null);

        for (const a of ordered) {
          switch (a.type) {
            case "create_note": {
              const n = addNote({ title: a.title, content: a.content, tags: a.tags ?? [], source, imageDataUrl: extra?.imageDataUrl });
              refs.set(a.ref ?? `note${refs.size}`, n.id);
              file(`📝 Note: ${a.title}`, { kind: "notes", id: n.id });
              break;
            }
            case "create_todo": {
              const todo = addTodo({
                title: a.title, notes: a.notes, dueAt: a.dueAt ?? null, remindAt: a.remindAt ?? a.dueAt ?? null,
                priority: a.priority ?? "medium", source, rrule: a.rrule ?? null, bill: a.bill ?? null,
                doing: a.status === "doing" || undefined,
                noteId: (a.noteRef && refs.get(a.noteRef)) || fallbackNote(),
                ...(a.rotation?.length ? { rotation: a.rotation, assignee: a.rotation[0] } : {}),
              });
              file(`${a.rrule ? "🔁" : a.status === "doing" ? "▶️" : "✅"} ${a.status === "doing" ? "Doing" : "To-do"}: ${a.title}`, { kind: "todos", id: todo.id });
              break;
            }
            case "add_transaction": {
              const t = addTransaction({
                merchant: a.merchant, amount: a.amount, currency: a.currency || dataRef.current.settings.currency,
                category: matchCategory(a.category, categoriesOf(dataRef.current.settings)),
                date: a.date, items: a.items ?? [], source, imageDataUrl: extra?.imageDataUrl,
                splits: a.splitWith?.length ? equalSplit(a.amount, a.splitWith) : undefined,
                noteId: (a.noteRef && refs.get(a.noteRef)) || fallbackNote(),
              });
              transactionIds.push(t.id);
              file(`💸 Finance: ${a.merchant}${a.splitWith?.length ? ` (split ${a.splitWith.length + 1})` : ""}`, { kind: "transactions", id: t.id });
              break;
            }
            case "create_sticky": {
              // Stickies became quick notes (see lib/quickNote.ts); the tool keeps its name.
              const n = addNote({ ...quickNote(a.text), source });
              file(`📝 Quick note: ${a.text.slice(0, 30)}`, { kind: "notes", id: n.id });
              break;
            }
            case "start_todo": {
              const q = a.titleContains.toLowerCase();
              const hit = dataRef.current.todos.find((t) => !t.deletedAt && !t.done && t.title.toLowerCase().includes(q));
              if (hit) {
                patchList("todos", hit.id, { doing: true });
                file(`▶️ Doing: ${hit.title}`, { kind: "todos", id: hit.id });
              }
              break;
            }
            case "complete_todo": {
              const q = a.titleContains.toLowerCase();
              const hit = dataRef.current.todos.find((t) => !t.deletedAt && !t.done && t.title.toLowerCase().includes(q));
              if (hit) {
                file(`☑️ Done: ${hit.title}`, { kind: "todos", id: hit.id });
                // Follow-ups (the next repeat, a bill logged) have no single row to show.
                for (const extra of toggleTodo(hit.id, true)) file(extra, null);
              }
              break;
            }
            case "set_budget":
              setData((d) => ({ ...d, settings: { ...d.settings, budgets: { ...d.settings.budgets, [a.category]: a.amount }, updatedAt: nowIso() } }));
              file(`🎯 Budget: ${a.category}`, { kind: "budget", id: a.category });
              break;
            case "split_transaction": {
              const q = a.merchantContains.toLowerCase();
              const hit = dataRef.current.transactions
                .filter((t) => !t.deletedAt && t.amount > 0 && t.merchant.toLowerCase().includes(q))
                .sort((x, y) => y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt))[0];
              if (hit) {
                patchList("transactions", hit.id, { splits: equalSplit(hit.amount, a.people, a.includeMe ?? true) });
                transactionIds.push(hit.id);
                file(`👥 Split: ${hit.merchant} with ${a.people.join(", ")}`, { kind: "transactions", id: hit.id });
              }
              break;
            }
          }
        }
        return { filed, links, transactionIds, created };
      },

      buildContext(relevantNotes?: Note[], sources?: AnswerSource[]): ClientContext {
        const d = dataRef.current;
        const live = <T extends { deletedAt?: string | null; spaceId?: string | null }>(xs: T[]) =>
          xs.filter((x) => !x.deletedAt && (x.spaceId ?? null) === d.currentSpaceId);
        return {
          now: localIso(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          currency: d.settings.currency,
          notes: live(d.notes).slice(0, 30).map((n) => ({ title: n.title, snippet: n.content.slice(0, 240) })),
          relevantNotes: relevantNotes?.map((n) => ({ title: n.title, content: n.content.slice(0, 3000), updatedAt: n.updatedAt })),
          todos: live(d.todos).slice(0, 50).map((t) => ({ title: t.title, done: t.done, doing: t.doing || undefined, dueAt: t.dueAt, rrule: t.rrule, assignee: t.assignee ?? undefined })),
          transactions: live(d.transactions).slice(0, 80).map((t) => ({ merchant: t.merchant, amount: t.amount, category: t.category, date: t.date })),
          budgets: d.settings.budgets,
          categories: categoriesOf(d.settings),
          // Only what the model reads: ids and dates stay in the browser.
          sources: sources?.length ? sources.map(({ n, kind, title, detail }) => ({ n, kind, title, detail })) : undefined,
        };
      },
    };
  }, [patchList]);

  const categories = useMemo(() => categoriesOf(data.settings), [data.settings]);
  const hasSamples = useMemo(
    () => [data.notes, data.todos, data.transactions, data.stickies].some((list) => list.some((x) => x.sample)),
    [data],
  );

  const value = useMemo<Ctx>(() => {
    const inSpace = <T extends { spaceId?: string | null }>(xs: T[]) =>
      xs.filter((x) => (x.spaceId ?? null) === data.currentSpaceId);
    return {
      ...data,
      notes: inSpace(data.notes),
      todos: inSpace(data.todos),
      transactions: inSpace(data.transactions),
      stickies: inSpace(data.stickies),
      all: data,
      ready,
      categories,
      hasSamples,
      ...api,
    };
  }, [data, ready, categories, hasSamples, api]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export const alive = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);

/** Built-in categories plus the user's own, in a stable order. */
export function categoriesOf(settings: Settings): string[] {
  const custom = (settings.categories ?? []).filter((c) => !EXPENSE_CATEGORIES.includes(c as never));
  return [...EXPENSE_CATEGORIES.filter((c) => c !== "Other"), ...custom, "Other"];
}

/** Map a category coming from the AI onto one the user actually has. */
export function matchCategory(name: string | undefined, categories: string[]): string {
  if (!name) return "Other";
  const exact = categories.find((c) => c === name);
  if (exact) return exact;
  const loose = categories.find((c) => c.toLowerCase() === name.trim().toLowerCase());
  return loose ?? "Other";
}

export { formatMoney, parseAmount } from "./money";
