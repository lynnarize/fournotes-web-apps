// What a scan becomes: the forced `file_capture` answer (receipt, ticket, chat, note, list)
// turned into the app's actions. Shared by the server (every provider) and the browser
// (Chrome's on-device model), so a photo files the same way whichever model read it.
import { parseAmount } from "../money";
import type { AIAction, CaptureResult, ClientContext } from "../types";
import { validateActions } from "./validate";

type CaptureReceipt = { merchant?: string; total?: unknown; amount?: unknown; currency?: string; date?: string; category?: string; items?: unknown[] };

/** Totals arrive as numbers, or as text like "128.500" / "Rp 128.500" (which Number() would read as 128.5). */
const toAmount = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseAmount(v);
  return null;
};

/** The receipt's fields, from `receipt` or, for models that flatten the object, from the top level. */
export function receiptFields(input: Record<string, unknown>) {
  const r = { ...(input as CaptureReceipt), ...((input.receipt as CaptureReceipt | undefined) ?? {}) };
  const total = toAmount(r.total ?? r.amount);
  return { merchant: r.merchant?.trim(), total, currency: r.currency, date: r.date, category: r.category, items: Array.isArray(r.items) ? r.items : [] };
}

/** A receipt the app can file: it has a merchant and a non-zero total. */
export const isCompleteReceipt = (input: Record<string, unknown>) => {
  const r = receiptFields(input);
  return Boolean(r.merchant && r.total);
};

// Convert the forced `file_capture` tool output into app actions.
/**
 * Models sometimes repeat the same task (once with a time, once without). Keep one per
 * title, preferring the copy that has a date.
 */
function dedupeTodos<T extends { title?: string; dueAt?: string | null }>(todos: T[]): T[] {
  const byTitle = new Map<string, T>();
  for (const t of todos) {
    const key = (t.title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) continue;
    const seen = byTitle.get(key);
    if (!seen || (!seen.dueAt && t.dueAt)) byTitle.set(key, t);
  }
  return [...byTitle.values()];
}

/** `iso` minus `h` hours, keeping it a valid ISO string; null when there is no time. */
function hoursBefore(iso: string | null | undefined, h: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t - h * 3_600_000).toISOString();
}

export function captureToActions(input: Record<string, unknown>, ctx: ClientContext): CaptureResult {
  const kind = (input.kind as CaptureResult["kind"]) ?? "other";
  const actions: unknown[] = [];
  const note = input.note as { title: string; content: string; tags?: string[] } | undefined;
  const todos = (input.todos as { title: string; dueAt?: string | null; priority?: string; rrule?: string | null }[]) ?? [];
  let reply = String(input.reply ?? "Filed it.");

  if (kind === "receipt") {
    const r = receiptFields(input);
    if (r.merchant && r.total) {
      actions.push({
        type: "add_transaction",
        merchant: r.merchant,
        amount: r.total,
        currency: r.currency || ctx.currency,
        category: r.category || "Other",
        date: /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") ? r.date : ctx.now.slice(0, 10),
        items: r.items,
      });
    } else {
      reply = "I could read this receipt but not its total, so nothing was saved. Try a clearer photo, or type the amount in the chat.";
    }
    // Receipts have line items, not tasks: some models put the items in `todos`.
    return { kind, reply, actions: validateActions(actions) as AIAction[] };
  }

  if (note) {
    const tags = kind === "chat" ? [...new Set([...(note.tags ?? []), "chat"])] : note.tags;
    actions.push({ type: "create_note", title: note.title, content: note.content, tags, ref: "capture" });
  }
  for (const t of dedupeTodos(todos)) {
    // Tickets: remind a couple of hours before departure, not at departure. Plans from a chat: an hour before.
    const remindAt = kind === "ticket" ? hoursBefore(t.dueAt, 2) : kind === "chat" ? hoursBefore(t.dueAt, 1) : t.dueAt ?? null;
    actions.push({
      type: "create_todo", title: t.title, dueAt: t.dueAt ?? null, remindAt, priority: kind === "ticket" ? "high" : t.priority,
      rrule: t.rrule ?? null, noteRef: note ? "capture" : undefined,
    });
  }
  return { kind, reply, actions: validateActions(actions) as AIAction[] };
}

