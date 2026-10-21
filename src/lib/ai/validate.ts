// Validate model output before it reaches the client store: amounts are numbers,
// dates parse, enums are known. Invalid actions are dropped, not guessed at.
// Shared: the server checks every provider's output, the browser the on-device model's.
import { z } from "zod";
import type { AIAction } from "../types";

const isoOrNull = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
  .nullish();
// Categories are user-editable, so any short name is allowed; the store maps it onto a real one.
const category = z.string().min(1).max(40).catch("Other");
const priority = z.enum(["low", "medium", "high"]).optional().catch("medium");
const rrule = z.string().regex(/^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=\d+)?/i).nullish().catch(null);
const amount = z.coerce.number().refine(Number.isFinite);

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_note"), title: z.string().min(1).max(200), content: z.string(), tags: z.array(z.string()).optional(), ref: z.string().optional() }),
  z.object({
    type: z.literal("create_todo"), title: z.string().min(1).max(300), notes: z.string().optional(),
    dueAt: isoOrNull.catch(null), remindAt: isoOrNull.catch(null), priority, rrule,
    status: z.enum(["todo", "doing"]).optional().catch(undefined),
    bill: z.object({ amount, currency: z.string().length(3).optional(), category }).nullish().catch(null),
    noteRef: z.string().optional(),
    rotation: z.array(z.string().trim().min(1).max(40)).max(10).optional().catch(undefined),
  }),
  z.object({
    type: z.literal("add_transaction"), merchant: z.string().min(1).max(120), amount,
    currency: z.string().length(3).toUpperCase().optional().catch(undefined), category,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), items: z.array(z.object({ name: z.string(), qty: z.number().optional(), price: z.number().optional() })).optional().catch([]),
    splitWith: z.array(z.string().min(1)).optional(), noteRef: z.string().optional(),
  }),
  z.object({ type: z.literal("create_sticky"), text: z.string().min(1).max(300), color: z.enum(["yellow", "pink", "blue", "green"]).optional().catch("yellow") }),
  z.object({ type: z.literal("complete_todo"), titleContains: z.string().min(2) }),
  z.object({ type: z.literal("start_todo"), titleContains: z.string().min(2) }),
  z.object({ type: z.literal("set_budget"), category, amount: amount.refine((n) => n > 0) }),
  z.object({ type: z.literal("split_transaction"), merchantContains: z.string().min(1), people: z.array(z.string().min(1)).min(1), includeMe: z.boolean().optional() }),
]);

export function validateActions(raw: unknown[]): AIAction[] {
  const out: AIAction[] = [];
  for (const a of raw) {
    const r = Action.safeParse(a);
    if (r.success) out.push(r.data as AIAction);
    // Log the action type and the reason only, never its content (it may hold the user's text).
    else console.warn("[ai] dropped invalid action", (a as { type?: unknown })?.type ?? "?", r.error.issues[0]?.message);
  }
  return out;
}
