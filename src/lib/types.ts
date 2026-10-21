// Shared data model. Keep this file free of browser/server-only imports so it
// can later be copied into a shared package for the mobile and Mac apps.

export type Tab = "today" | "notes" | "todo" | "finance";

export interface BaseItem {
  id: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  deletedAt?: string | null; // soft delete -> makes sync easier
  spaceId?: string | null; // null = personal, otherwise a shared space
  sample?: boolean; // part of the optional sample data; removable in one click, never synced
}

export type NoteSource = "manual" | "chat" | "ocr" | "recording" | "share";

/** What a "keep current" check found has changed since the note was written. */
export interface NoteUpdate {
  at: string; // ISO, when it was checked
  changed: boolean;
  summary: string;
  changes: string[];
  sources: { title: string; url: string }[];
}

/** A note the assistant re-checks against the web now and then (Claude only: it needs web search). */
export interface KeepCurrent {
  every: "week" | "month";
  checkedAt?: string | null; // ISO, the last check (or when it was turned on)
  /** The last check's changes, until they're added to the note or dismissed. */
  update?: NoteUpdate | null;
}

export interface Note extends BaseItem {
  title: string;
  content: string; // plain text / light markdown: what search, the AI and the brief read
  /** Rich text from the editor (TipTap HTML). Absent on notes that were never opened in it. */
  html?: string;
  source: NoteSource;
  tags: string[];
  imageDataUrl?: string; // thumbnail of the scanned page (local only for now)
  keepCurrent?: KeepCurrent | null;
}

export type Priority = "low" | "medium" | "high";

/** A to-do that also logs spending when completed (rent, internet, subscriptions). */
export interface Bill {
  amount: number;
  currency?: string;
  category: ExpenseCategory;
}

export interface Todo extends BaseItem {
  title: string;
  notes?: string;
  done: boolean;
  /** In progress: the "Doing" column of the board. Ignored once done. */
  doing?: boolean;
  completedAt?: string | null; // ISO, used for smart reminder timing
  dueAt?: string | null; // ISO
  remindAt?: string | null; // ISO
  reminded?: boolean;
  priority: Priority;
  source: NoteSource;
  rrule?: string | null; // subset of RFC 5545, e.g. "FREQ=MONTHLY;INTERVAL=1"
  bill?: Bill | null;
  noteId?: string | null; // link back to the note it came from
  /** How often the due date was pushed later, and when last: a task that keeps slipping is "stuck". */
  postponed?: { count: number; at: string } | null;
  /** Not flagged as stuck again before this (ISO): "not now". */
  stuckUntil?: string | null;
  /** Chores: the people taking turns, in order, and whose turn this one is. */
  rotation?: string[] | null;
  assignee?: string | null;
}

/** Built-in categories. Users can add their own (Finance → settings → Categories). */
export const EXPENSE_CATEGORIES = [
  "Food & Drink",
  "Groceries",
  "Transport",
  "Shopping",
  "Bills & Utilities",
  "Health",
  "Entertainment",
  "Education",
  "Income",
  "Other",
] as const;
// A category is any name: the built-ins above plus whatever the user adds.
export type ExpenseCategory = string;

export const CURRENCIES = ["IDR", "USD", "SGD", "MYR", "EUR", "JPY", "AUD", "GBP", "THB", "KRW", "CNY", "SAR"] as const;

export interface LineItem {
  name: string;
  qty?: number;
  price?: number;
}

export interface Split {
  name: string;
  amount: number; // in the transaction's currency
  settled: boolean;
}

export interface Transaction extends BaseItem {
  merchant: string;
  amount: number; // positive = spend, negative = income
  currency: string; // ISO 4217, e.g. IDR
  fxRate?: number | null; // 1 unit of `currency` in the base currency (only when currency differs)
  category: ExpenseCategory;
  date: string; // YYYY-MM-DD
  items: LineItem[];
  source: NoteSource;
  imageDataUrl?: string;
  splits?: Split[]; // other people's shares of this bill
  noteId?: string | null;
}

export type StickyColor = "yellow" | "pink" | "blue" | "green";

export interface Sticky extends BaseItem {
  text: string;
  color: StickyColor;
  pinned?: boolean; // pinned stickies show in the daily brief
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  total: number;
  currency: string;
  byCategory: Record<string, number>;
  text: string; // AI written summary
  createdAt: string;
}

export interface DailyBrief {
  date: string; // YYYY-MM-DD
  text: string;
  basis?: string; // fingerprint of the data it was written from, so it's rewritten when that changes
}

export interface Settings {
  currency: string; // base currency
  budgets: Partial<Record<ExpenseCategory, number>>; // monthly, in base currency
  categories?: string[]; // extra categories the user created
  voiceReplies: boolean; // speak replies aloud in voice mode
  updatedAt?: string; // last change, so sync can keep the newer settings
  name?: string;
}

export interface Space {
  id: string;
  name: string;
  inviteCode?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---- Actions the AI can ask the client to apply --------------------------
// The server never writes to storage directly in the base version; it returns
// actions, and the client store applies them. When you add a sync backend,
// the server can write to the database instead and the client just re-syncs.

export type AIAction =
  | { type: "create_note"; title: string; content: string; tags?: string[]; ref?: string }
  | {
      type: "create_todo";
      title: string;
      notes?: string;
      dueAt?: string | null;
      remindAt?: string | null;
      priority?: Priority;
      /** "doing": the user is working on it now (the board's Doing column). */
      status?: "todo" | "doing";
      rrule?: string | null;
      bill?: Bill | null;
      noteRef?: string; // `ref` of a create_note in the same batch
      /** A chore people take turns at; the first name goes first. */
      rotation?: string[];
    }
  | {
      type: "add_transaction";
      merchant: string;
      amount: number;
      currency?: string;
      category: ExpenseCategory;
      date: string;
      items?: LineItem[];
      splitWith?: string[]; // split equally with these people
      noteRef?: string;
    }
  | { type: "create_sticky"; text: string; color?: StickyColor }
  | { type: "complete_todo"; titleContains: string }
  | { type: "start_todo"; titleContains: string }
  | { type: "set_budget"; category: ExpenseCategory; amount: number }
  | { type: "split_transaction"; merchantContains: string; people: string[]; includeMe?: boolean };

export interface ChatResponse {
  reply: string;
  actions: AIAction[];
  demo?: boolean;
  /** The assistant declined (out of scope, or needs the user's own key): nothing worth saving. */
  refused?: boolean;
  /** The model that wrote the reply, when the provider says (OpenRouter can fall back to another one). */
  model?: string;
}

/** What a numbered source is: a note, a quick note, a task, a transaction or a budget. */
export type SourceKind = "note" | "quick" | "todo" | "transaction" | "budget";
export const SOURCE_KINDS: readonly SourceKind[] = ["note", "quick", "todo", "transaction", "budget"];

/**
 * One of the user's own items picked for a question, numbered so the answer can cite it
 * as [n]. `title` and `detail` are what the model reads; `id` and `date` stay in the browser.
 */
export interface AnswerSource {
  n: number;
  kind: SourceKind;
  id: string;
  title: string;
  detail: string;
  /** YYYY-MM-DD: the transaction's day, the task's due day, the note's last edit. */
  date?: string;
}

export interface CaptureResult {
  kind: "receipt" | "ticket" | "chat" | "handwritten_note" | "todo_list" | "other";
  reply: string;
  actions: AIAction[];
  demo?: boolean;
}

// Compact context the client sends so the AI can answer questions about data.
export interface ClientContext {
  now: string;
  timezone: string;
  currency: string;
  notes: { title: string; snippet: string }[];
  /** Full text of the notes most relevant to the question (retrieval / RAG). */
  relevantNotes?: { title: string; content: string; updatedAt: string }[];
  todos: { title: string; done: boolean; doing?: boolean; dueAt?: string | null; rrule?: string | null; assignee?: string }[];
  transactions: { merchant: string; amount: number; category: string; date: string }[];
  budgets?: Partial<Record<ExpenseCategory, number>>;
  categories?: string[];
  /** Numbered items from the user's data picked for a question; the reply cites them as [n]. */
  sources?: { n: number; kind: SourceKind; title: string; detail: string }[];
}

export interface BriefInput {
  now: string;
  timezone: string;
  currency: string;
  name?: string;
  tasksToday: { title: string; dueAt?: string | null; overdue: boolean }[];
  yesterdaySpend: { merchant: string; amount: number; category: string }[];
  stickies: string[];
  alerts: string[]; // budgets near limit, subscriptions due, money owed
}
