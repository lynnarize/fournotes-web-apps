"use client";
// Search across notes, tasks and spending.
// - Keyword ranking (BM25) always works, offline too.
// - Meaning-based search: when a Voyage key is available (Settings or VOYAGE_API_KEY), notes are embedded
//   once (cached in localStorage by updatedAt) and ranked by cosine similarity,
//   blended with BM25. The Supabase version of this is pgvector (see GUIDE.md).
import { authHeaders } from "./byok";
import { formatMoney } from "./money";
import type { AnswerSource, Note, Todo, Transaction } from "./types";

export type SearchHit =
  | { kind: "note"; item: Note; score: number }
  | { kind: "todo"; item: Todo; score: number }
  | { kind: "transaction"; item: Transaction; score: number };

const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

function bm25(docs: string[], query: string): number[] {
  const q = tokenize(query);
  if (!q.length) return docs.map(() => 0);
  const toks = docs.map(tokenize);
  const avg = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, toks.length);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  return toks.map((t) => {
    let score = 0;
    for (const term of q) {
      // Prefix match so "bal" finds "bali"
      const tf = t.filter((w) => w === term || (term.length >= 3 && w.startsWith(term))).length;
      if (!tf) continue;
      const n = [...df.entries()].filter(([w]) => w === term || (term.length >= 3 && w.startsWith(term))).reduce((s, [, c]) => s + c, 0);
      const idf = Math.log(1 + (toks.length - n + 0.5) / (n + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (t.length / avg))));
    }
    return score;
  });
}

export function keywordSearch(data: { notes: Note[]; todos: Todo[]; transactions: Transaction[] }, query: string, limit = 12): SearchHit[] {
  const notes = data.notes.filter((x) => !x.deletedAt);
  const todos = data.todos.filter((x) => !x.deletedAt);
  const txs = data.transactions.filter((x) => !x.deletedAt);
  const docs = [
    ...notes.map((n) => `${n.title} ${n.title} ${n.tags.join(" ")} ${n.content}`),
    ...todos.map((t) => `${t.title} ${t.notes ?? ""}`),
    ...txs.map((t) => `${t.merchant} ${t.category} ${t.items.map((i) => i.name).join(" ")}`),
  ];
  const scores = bm25(docs, query);
  const hits: SearchHit[] = [
    ...notes.map((item, i) => ({ kind: "note" as const, item, score: scores[i] })),
    ...todos.map((item, i) => ({ kind: "todo" as const, item, score: scores[notes.length + i] })),
    ...txs.map((item, i) => ({ kind: "transaction" as const, item, score: scores[notes.length + todos.length + i] })),
  ];
  return hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---- Embeddings -----------------------------------------------------------------
const EMB_KEY = "four-notes:embeddings";
type EmbCache = Record<string, { v: string; e: number[] }>; // noteId -> { version (updatedAt), embedding }
let semanticAvailable: boolean | null = null;

function loadCache(): EmbCache {
  try { return JSON.parse(localStorage.getItem(EMB_KEY) ?? "{}"); } catch { return {}; }
}
function saveCache(c: EmbCache) {
  try { localStorage.setItem(EMB_KEY, JSON.stringify(c)); } catch { /* storage full: skip caching */ }
}

async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][] | null> {
  if (semanticAvailable === false || !texts.length || (typeof navigator !== "undefined" && !navigator.onLine)) return null;
  try {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ texts, inputType }),
    });
    if (!res.ok) return null;
    const { embeddings } = (await res.json()) as { embeddings: number[][] | null };
    semanticAvailable = embeddings !== null;
    return embeddings;
  } catch {
    return null;
  }
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
};

/** Notes ranked by meaning (if embeddings are configured) blended with keywords. */
export async function semanticNotes(notes: Note[], query: string, limit = 5): Promise<{ note: Note; score: number }[]> {
  const live = notes.filter((n) => !n.deletedAt && (n.title || n.content));
  const kw = bm25(live.map((n) => `${n.title} ${n.title} ${n.content}`), query);
  const maxKw = Math.max(...kw, 1e-9);

  let sem: number[] | null = null;
  const cache = loadCache();
  const stale = live.filter((n) => cache[n.id]?.v !== n.updatedAt);
  if (semanticAvailable !== false) {
    // Embed changed notes in batches (most recently edited first, capped per search).
    const batch = stale.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 64);
    const [docVecs, qVec] = await Promise.all([
      embed(batch.map((n) => `${n.title}\n${n.content}`.slice(0, 4000)), "document"),
      embed([query], "query"),
    ]);
    if (docVecs) batch.forEach((n, i) => (cache[n.id] = { v: n.updatedAt, e: docVecs[i] }));
    if (docVecs || batch.length === 0) {
      const liveIds = new Set(live.map((n) => n.id));
      for (const id of Object.keys(cache)) if (!liveIds.has(id)) delete cache[id];
      saveCache(cache);
    }
    if (qVec?.[0]) sem = live.map((n) => (cache[n.id] ? cosine(cache[n.id].e, qVec[0]) : 0));
  }

  return live
    .map((note, i) => ({ note, score: sem ? 0.7 * sem[i] + 0.3 * (kw[i] / maxKw) : kw[i] / maxKw }))
    .filter((x) => x.score > (sem ? 0.25 : 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---- Sources for an answer --------------------------------------------------------
// A question ("what did I spend on food this month?") gets a short, numbered list of the
// user's own items that bear on it, so the answer can cite them as [n]. Notes come from
// the retrieval above (passed in); transactions, tasks and budgets are matched here by
// keywords, category names and simple date ranges. Nothing leaves the browser but the
// titles and details of the items picked.

export type SourceData = {
  notes: Note[];
  todos: Todo[];
  transactions: Transaction[];
  budgets: Partial<Record<string, number>>;
  categories: string[];
  currency: string;
};

/** Inclusive, as YYYY-MM-DD. */
export type DateRange = { from: string; to: string };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monthRange = (y: number, m: number): DateRange => ({ from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) });
/** Monday-based week containing `d`. */
const weekOf = (d: Date): DateRange => {
  const monday = addDays(d, -((d.getDay() + 6) % 7));
  return { from: ymd(monday), to: ymd(addDays(monday, 6)) };
};

const MONTHS = [
  ["january", "jan", "januari"], ["february", "feb", "februari"], ["march", "maret"], ["april", "apr"],
  ["may", "mei"], ["june", "jun", "juni"], ["july", "jul", "juli"], ["august", "aug", "agustus"],
  ["september", "sep", "sept"], ["october", "oct", "oktober"], ["november", "nov"], ["december", "dec", "desember"],
];

/**
 * The period a question names, if any: today, yesterday, tomorrow, this/last/next week,
 * this/last month, this year, the last N days, or a month by name ("in October").
 */
export function dateRange(text: string, now = new Date()): DateRange | null {
  const t = text.toLowerCase();
  const today = ymd(now);
  if (/\b(today|tonight|this (morning|afternoon|evening)|hari ini)\b/.test(t)) return { from: today, to: today };
  if (/\b(yesterday|kemarin)\b/.test(t)) { const y = ymd(addDays(now, -1)); return { from: y, to: y }; }
  if (/\b(tomorrow|besok)\b/.test(t)) { const y = ymd(addDays(now, 1)); return { from: y, to: y }; }
  const lastDays = t.match(/\b(?:last|past) (\d{1,3}) days\b/);
  if (lastDays) return { from: ymd(addDays(now, 1 - Math.min(366, Number(lastDays[1])))), to: today };
  if (/\b(this week|minggu ini)\b/.test(t)) return weekOf(now);
  if (/\b(last week|past week|minggu lalu)\b/.test(t)) return weekOf(addDays(now, -7));
  if (/\b(next week|minggu depan)\b/.test(t)) return weekOf(addDays(now, 7));
  if (/\b(this month|bulan ini)\b/.test(t)) return monthRange(now.getFullYear(), now.getMonth());
  if (/\b(last month|bulan lalu)\b/.test(t)) return monthRange(now.getFullYear(), now.getMonth() - 1);
  if (/\b(this year|tahun ini)\b/.test(t)) return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  const year = Number(t.match(/\b(20\d{2})\b/)?.[1]) || null;
  for (let m = 0; m < 12; m++) {
    const names = MONTHS[m].join("|");
    // "may" and "march" are ordinary words too: only as a month after "in", "during" and the like, or before a year.
    const re = m === 2 || m === 4
      ? new RegExp(`\\b(in|during|for|since|of|last|bulan) (${names})\\b|\\b(${names}) 20\\d{2}\\b`)
      : new RegExp(`\\b(${names})\\b`);
    if (!re.test(t)) continue;
    const y = year ?? (m > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
    return monthRange(y, m);
  }
  return null;
}

const CATEGORY_WORDS: Record<string, RegExp> = {
  "Food & Drink": /\b(food|foods|eat|eating|ate|meals?|lunch|dinner|breakfast|coffee|kopi|makan(an)?|drinks?|snacks?|restaurants?|cafes?|warteg)\b/,
  Groceries: /\b(grocer(y|ies)|supermarket|minimarket|belanjaan|sayur)\b/,
  Transport: /\b(transport(ation)?|taxi|gojek|grab|ojek|fuel|petrol|bensin|parking|parkir|trains?|bus|toll?)\b/,
  Shopping: /\b(shopping|clothes|tokopedia|shopee)\b/,
  "Bills & Utilities": /\b(bills?|utilit(y|ies)|electricity|listrik|internet|wifi|pln|pulsa|rent|sewa)\b/,
  Health: /\b(health|doctors?|medicine|pharmacy|obat|dokter|hospital|apotek)\b/,
  Entertainment: /\b(entertainment|movies?|cinema|netflix|spotify|games?|bioskop)\b/,
  Education: /\b(education|courses?|school|tuition|kursus|sekolah)\b/,
  Income: /\b(income|salary|gaji|earned|pemasukan)\b/,
};

/** The question names the category by its first word: "pets" for "Pets & vet". */
const namesCategory = (q: string, category: string) => {
  const word = category.toLowerCase().split(/[^\p{L}\p{N}]+/u).find(Boolean) ?? "";
  return word.length >= 3 && tokenize(q).map(norm).includes(norm(word));
};

const MONEY = /\b(spen[dt]|spending|expenses?|money|costs?|paid|pay|bought|budgets?|income|owe[sd]?|split|bills?|how much|total|cash|uang|duit|habis|pengeluaran|bayar|beli)\b/;
const TASKS = /\b(tasks?|to-?dos?|due|overdue|remind\w*|deadlines?|schedule|agenda|plan|planned|focus|priorit\w*|done|finish\w*|tugas|jadwal|rencana)\b/;
const NOTES = /\b(notes?|wrote|write|written|ideas?|catatan|tulis)\b/;
const BUDGET = /\b(budgets?|limits?|allowance|anggaran)\b/;
const DONE = /\b(done|finished|completed|selesai)\b/;

// Words that say nothing about which item is meant.
const SOURCE_STOP = new Set((
  "the and for are was were what whats when where which while with without this that these those there their them they then than from have has had does did done doing " +
  "will would should could about most more much many some also just like only into over your yours you mine my me our out how why who all any can get got " +
  "today tonight yesterday tomorrow week weeks month months year years last next past this days day morning afternoon evening " +
  "spend spent spending expense expenses money cost costs paid pay bought total budget budgets income task tasks todo todos due overdue note notes wrote write written " +
  "plan focus show list tell give find look much many time times ago since still left " +
  "january february march april may june july august september october november december " +
  "apa apakah berapa bagaimana gimana kenapa mengapa siapa kapan dimana mana yang untuk dengan dari atau juga sudah belum ini itu saya aku kamu hari minggu bulan tahun"
).split(" "));

const norm = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
const sourceTerms = (q: string) => [...new Set(tokenize(q).map(norm).filter((w) => w.length >= 3 && !SOURCE_STOP.has(w) && !/^\d+$/.test(w)))];
/** How many of the terms the text mentions (a term of 4+ letters also matches as a prefix: "groc" → "groceries"). */
const hits = (text: string, terms: string[]) => {
  if (!terms.length) return 0;
  const words = tokenize(text).map(norm);
  return terms.filter((t) => words.some((w) => w === t || (t.length >= 4 && w.startsWith(t)))).length;
};

const short = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const fromMoney = (t: Transaction, base: string) => (t.currency === base ? t.amount : t.amount * (t.fxRate ?? 1));
/** What the user paid after other people's shares, in the base currency. */
const shareOf = (t: Transaction, base: string) => fromMoney({ ...t, amount: t.amount - (t.splits ?? []).reduce((s, x) => s + x.amount, 0) }, base);
const money = (n: number, currency: string) => formatMoney(n, currency);
const FREQ: Record<string, string> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };

/**
 * Up to `max` numbered sources for a question, from the user's own data. `rankedNotes`
 * are the notes retrieval already picked (named first), the same ones the model gets in full.
 */
export function answerSources(data: SourceData, question: string, rankedNotes: Note[], opts: { now?: Date; max?: number } = {}): AnswerSource[] {
  const now = opts.now ?? new Date();
  const max = opts.max ?? 8;
  const q = question.toLowerCase();
  const range = dateRange(q, now);
  const today = ymd(now);
  const base = data.currency;
  const terms = sourceTerms(q);
  const cats = new Set(data.categories.filter((c) => CATEGORY_WORDS[c]?.test(q) || namesCategory(q, c)));
  // "Other" names no category in particular.
  cats.delete("Other");
  const wantsMoney = MONEY.test(q) || cats.size > 0;
  const wantsTasks = TASKS.test(q);
  const wantsNotes = NOTES.test(q);
  const inRange = (day: string | null | undefined) => !range || (!!day && day >= range.from && day <= range.to);

  // Transactions: the category or merchant asked about, within the period; or, for a
  // money question about a period, the biggest ones in it.
  const txs = data.transactions
    .filter((t) => !t.deletedAt && inRange(t.date))
    .map((t) => {
      let score = cats.has(t.category) ? 3 : 0;
      score += 2 * hits(`${t.merchant} ${t.category} ${t.items.map((i) => i.name).join(" ")} ${(t.splits ?? []).map((s) => s.name).join(" ")}`, terms);
      if (!score && range && wantsMoney && !cats.size) score = 1;
      return { t, score, size: Math.abs(shareOf(t, base)) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.size - a.size)
    .slice(0, 4)
    .map(({ t }): Omit<AnswerSource, "n"> => {
      const splits = t.splits ?? [];
      const amount = Math.abs(t.amount);
      const detail = [
        t.date,
        t.category,
        `${t.amount < 0 ? "received" : "spent"} ${money(amount, t.currency)}${t.currency !== base ? ` (${money(Math.abs(fromMoney(t, base)), base)})` : ""}`,
        splits.length ? `your share ${money(shareOf(t, base), base)}` : "",
        splits.length ? `split with ${splits.map((s) => `${s.name} (${s.settled ? "paid back" : "not paid back yet"})`).join(", ")}` : "",
        t.items.length ? `items: ${t.items.slice(0, 6).map((i) => i.name).join(", ")}` : "",
      ].filter(Boolean).join("; ");
      return {
        kind: "transaction",
        id: t.id,
        title: splits.length ? `${t.merchant}, split ${splits.length + 1} ways` : `${t.merchant}, ${money(amount, t.currency)}`,
        detail,
        date: t.date,
      };
    });

  // Budgets: the categories asked about, or all of them when the question is about budgets.
  const month = today.slice(0, 7);
  const budgets = Object.entries(data.budgets)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .filter(([cat]) => cats.has(cat) || (BUDGET.test(q) && !cats.size))
    .map(([cat, limit]) => {
      const spent = data.transactions
        .filter((t) => !t.deletedAt && t.amount > 0 && t.category === cat && t.date.startsWith(month))
        .reduce((s, t) => s + shareOf(t, base), 0);
      return { cat, limit, spent };
    })
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
    .slice(0, 2)
    .map(({ cat, limit, spent }): Omit<AnswerSource, "n"> => ({
      kind: "budget",
      id: cat,
      title: `${cat}, ${money(limit, base)} a month`,
      detail: `monthly budget ${money(limit, base)}; spent so far this month (${month}) ${money(spent, base)}, ${Math.round((spent / limit) * 100)}%`,
    }));

  // Tasks: named in the question, or due in the period it asks about (overdue ones count for today).
  const todos = data.todos
    .filter((t) => !t.deletedAt && (!t.done || DONE.test(q)))
    .map((t) => {
      const due = t.dueAt ? ymd(new Date(t.dueAt)) : null;
      let score = 2 * hits(`${t.title} ${t.notes ?? ""}`, terms);
      if (wantsTasks && range && due && inRange(due)) score += 2;
      if (wantsTasks && range?.from === today && !t.done && due && due < today) score += 1;
      if (wantsTasks && !range && !score && !t.done && ((due && due <= ymd(addDays(now, 7))) || t.priority === "high")) score = 1;
      return { t, due, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, 3)
    .map(({ t, due }): Omit<AnswerSource, "n"> => {
      const when = t.dueAt ? new Date(t.dueAt) : null;
      const freq = t.rrule?.match(/FREQ=(\w+)/i)?.[1]?.toUpperCase();
      const detail = [
        t.done ? "done" : t.doing ? "in progress" : "open",
        when ? `due ${due} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}${!t.done && due! < today ? " (overdue)" : ""}` : "no due date",
        `priority ${t.priority}`,
        freq ? `repeats ${FREQ[freq] ?? freq.toLowerCase()}` : "",
        t.bill ? `bill ${money(t.bill.amount, t.bill.currency || base)}` : "",
        t.notes ? `notes: ${short(t.notes, 140)}` : "",
      ].filter(Boolean).join("; ");
      return { kind: "todo", id: t.id, title: t.title || "Untitled task", detail, date: due ?? undefined };
    });

  // Notes: what retrieval picked, best first.
  const notes = rankedNotes
    .filter((n) => !n.deletedAt)
    .slice(0, 3)
    .map((n): Omit<AnswerSource, "n"> => {
      const quick = n.tags.includes("quick");
      const day = ymd(new Date(quick ? n.createdAt : n.updatedAt));
      return {
        kind: quick ? "quick" : "note",
        id: n.id,
        title: short(n.title || "Untitled", 80),
        detail: [`${quick ? "written" : "edited"} ${day}`, n.tags.filter((t) => t !== "quick").length ? `tags ${n.tags.filter((t) => t !== "quick").join(", ")}` : "", short(n.content, quick ? 300 : 200)].filter(Boolean).join("; "),
        date: day,
      };
    });

  // What the question is mostly about goes first.
  const groups = wantsMoney && !wantsTasks ? [txs, budgets, notes, todos]
    : wantsTasks && !wantsMoney ? [todos, notes, txs, budgets]
    : wantsNotes ? [notes, todos, txs, budgets]
    : [notes, txs, todos, budgets];
  return groups.flat().slice(0, max).map((s, i) => ({ ...s, n: i + 1 }));
}
