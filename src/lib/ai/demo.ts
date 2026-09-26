import "server-only";
import { formatMoney, parseAmount } from "../money";
import { guessCategory, parseWalletNotification } from "../wallet";
import type { AIAction, BriefInput, CaptureResult, ChatMessage, ChatResponse, ClientContext, ExpenseCategory, Transaction } from "../types";
import { EXPENSE_CATEGORIES } from "../types";
import { localBrief, localMonthly } from "./local";
import { ProviderError } from "./errors";
import { OWN_KEY_REQUIRED } from "./guard";
import type { LLMProvider } from "./provider";

// Rule-based stand-in used when no API key is set, so the UI is testable offline.
const DEMO = " (demo mode — add a free OpenRouter key in Settings for real AI)";

function parseWhen(s: string, now: Date): string | null {
  const d = new Date(now);
  let found = false;
  if (/\b(tomorrow|besok)\b/i.test(s)) { d.setDate(d.getDate() + 1); found = true; }
  const inMin = s.match(/in (\d+) ?(min|minute|minutes|hour|hours)/i);
  if (inMin) {
    const n = parseInt(inMin[1]);
    return new Date(now.getTime() + n * (inMin[2].startsWith("h") ? 3_600_000 : 60_000)).toISOString();
  }
  const t = s.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i);
  if (t && (t[3] || t[2] || /\b(at|jam)\b/i.test(s))) {
    let h = parseInt(t[1]);
    if (t[3]?.toLowerCase() === "pm" && h < 12) h += 12;
    if (t[3]?.toLowerCase() === "am" && h === 12) h = 0;
    d.setHours(h, t[2] ? parseInt(t[2]) : 0, 0, 0);
    found = true;
  }
  return found ? d.toISOString() : null;
}

function parseRepeat(s: string): string | null {
  if (/\b(every day|daily|tiap hari|setiap hari)\b/i.test(s)) return "FREQ=DAILY;INTERVAL=1";
  if (/\b(every week|weekly|tiap minggu|setiap minggu)\b/i.test(s)) return "FREQ=WEEKLY;INTERVAL=1";
  if (/\b(every month|monthly|tiap bulan|setiap bulan|bulanan)\b/i.test(s)) return "FREQ=MONTHLY;INTERVAL=1";
  if (/\b(every year|yearly|annually|tiap tahun|tahunan)\b/i.test(s)) return "FREQ=YEARLY;INTERVAL=1";
  return null;
}

const namesAfter = (s: string, re: RegExp) =>
  (s.match(re)?.[1] ?? "").split(/\s*(?:,|\band\b|\bdan\b|&)\s*/i).map((x) => x.trim()).filter((x) => x && x.length < 30);

export class DemoProvider implements LLMProvider {
  async chat(messages: ChatMessage[], ctx: ClientContext): Promise<ChatResponse> {
    const text = messages[messages.length - 1]?.content ?? "";
    const now = new Date(ctx.now);
    const actions: AIAction[] = [];
    const today = ctx.now.slice(0, 10);

    // Pasted e-wallet / bank notification
    const wallet = parseWalletNotification(text);
    if (wallet && !/\b(remind|ingatkan)\b/i.test(text)) {
      actions.push({ type: "add_transaction", merchant: wallet.merchant, amount: wallet.amount, category: wallet.category, date: today });
      return { reply: `Logged ${wallet.wallet ?? "the"} notification in Finance.${DEMO}`, actions, demo: true };
    }

    // "budget makan 1.5jt" / "set food budget to 2jt"
    if (/\b(budget|anggaran)\b/i.test(text)) {
      const amount = parseAmount(text);
      const category: ExpenseCategory = /makan|food|kopi|coffee|lunch|dinner|meal/i.test(text) ? "Food & Drink"
        : EXPENSE_CATEGORIES.find((c) => text.toLowerCase().includes(c.split(" ")[0].toLowerCase())) ?? guessCategory(text);
      if (amount) {
        actions.push({ type: "set_budget", category: category === "Income" ? "Other" : category, amount });
        return { reply: `Budget set for ${category}.${DEMO}`, actions, demo: true };
      }
    }

    // "split the warteg bill with Andi and Budi"
    const splitPeople = namesAfter(text, /\b(?:split|bagi|patungan)\b.*?\b(?:with|dengan|sama)\s+(.+)$/i);
    if (splitPeople.length && !parseAmount(text.replace(/\b(?:with|dengan|sama)\s+.+$/i, ""))) {
      const merchant = text.match(/\b(?:split|bagi)\s+(?:the\s+)?(?:bill\s+)?(?:at\s+|di\s+)?(\w+)/i)?.[1] ?? "";
      actions.push({ type: "split_transaction", merchantContains: merchant === "bill" ? "" : merchant, people: splitPeople });
      return { reply: `Split with ${splitPeople.join(", ")}.${DEMO}`, actions, demo: true };
    }

    if (/\b(remind|ingatkan|todo|to-do|task|tugas|every|tiap|setiap)\b/i.test(text)) {
      const when = parseWhen(text, now);
      const rrule = parseRepeat(text);
      const amount = /\b(bill|bayar|pay|tagihan)\b/i.test(text) ? parseAmount(text.replace(/\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b/gi, "")) : null;
      const title = text
        .replace(/^(please )?(remind me to|ingatkan (saya|aku) (untuk)?|add (a )?(todo|task)( to)?:?)/i, "")
        .replace(/\b(tomorrow|besok|in \d+ ?\w+|at \d{1,2}([:.]\d{2})?\s*(am|pm)?|\d{1,2}([:.]\d{2})?\s*(am|pm)|every (day|week|month|year)|daily|weekly|monthly|yearly|tiap (hari|minggu|bulan|tahun))\b/gi, "")
        .replace(/(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
        .trim();
      actions.push({
        type: "create_todo", title: title || text, dueAt: when, remindAt: when, rrule,
        bill: amount && amount >= 1000 ? { amount, category: guessCategory(text) === "Other" ? "Bills & Utilities" : guessCategory(text) } : null,
      });
      return { reply: `Added to your To-Do${when ? " with a reminder" : ""}${rrule ? ", repeating" : ""}.${DEMO}`, actions, demo: true };
    }

    const amount = parseAmount(text);
    if (amount && /\b(spent|paid|bought|beli|bayar|habis|buy|makan)\b/i.test(text)) {
      const splitWith = namesAfter(text, /\b(?:split with|bagi dengan|patungan (?:sama|dengan))\s+(.+)$/i);
      const clean = text.replace(/\b(?:split with|bagi dengan|patungan (?:sama|dengan))\s+.+$/i, "");
      const merchant = clean.match(/\b(?:at|di)\s+([^,]+?)\s*$/i)?.[1]?.slice(0, 40) ?? clean.replace(/\d[\d.,]*\s*(rb|ribu|k|jt|juta)?/gi, "").replace(/\b(beli|bayar|spent|paid|bought|buy)\b/gi, "").trim().slice(0, 40);
      actions.push({ type: "add_transaction", merchant: merchant || "Expense", amount, category: guessCategory(text), date: today, splitWith: splitWith.length ? splitWith : undefined });
      return { reply: `Logged in Finance.${DEMO}`, actions, demo: true };
    }

    if (/^(note|catat|catatan)\b[:\s]/i.test(text)) {
      const body = text.replace(/^(note|catat|catatan)[:\s]*/i, "");
      actions.push({ type: "create_note", title: body.split(/[.\n]/)[0].slice(0, 50), content: body });
      return { reply: `Saved to Notes.${DEMO}`, actions, demo: true };
    }

    if (ctx.relevantNotes?.length) {
      const n = ctx.relevantNotes[0];
      return { reply: `The closest match is your note “${n.title}”:\n${n.content.slice(0, 280)}${n.content.length > 280 ? "…" : ""}${DEMO}`, actions, demo: true };
    }

    // Demo mode only follows rules; anything that reads like a general question needs a real key.
    if (/\?\s*$|^(what|how|why|who|when|where|which|can|could|should|is|are|do|does|tell me|explain|apa|bagaimana|gimana|kenapa|mengapa|siapa|kapan|dimana|di mana|berapa|jelaskan)\b/i.test(text.trim())) {
      return { reply: OWN_KEY_REQUIRED, actions, demo: true, refused: true };
    }

    const open = ctx.todos.filter((t) => !t.done).length;
    return {
      reply: `You have ${open} open task(s) and ${ctx.notes.length} note(s). Try “remind me to pay rent every month on the 5th 9am”, “spent 25k on coffee at Starbucks split with Andi”, “set my food budget to 1.5M”, or paste an app or receipt notification.${DEMO}`,
      actions,
      demo: true,
    };
  }

  async captureImage(): Promise<CaptureResult> {
    return {
      kind: "other",
      reply: `Image saved to Notes. OCR and auto-sorting need an API key${DEMO}`,
      actions: [{ type: "create_note", title: "Scanned image", content: "Add a free OpenRouter key in Settings → AI & API keys to read images automatically." }],
      demo: true,
    };
  }

  async summarizeRecording(transcript: string): Promise<CaptureResult> {
    const sentences = transcript.split(/(?<=[.!?])\s+/).filter(Boolean);
    return {
      kind: "handwritten_note",
      reply: `Recording saved to Notes${DEMO}`,
      actions: [{
        type: "create_note",
        title: `Voice note ${new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}`,
        content: `**Summary** (first sentences)\n${sentences.slice(0, 2).join(" ") || "(empty)"}\n\n---\nTranscript:\n${transcript}`,
        tags: ["recording"],
      }],
      demo: true,
    };
  }

  async monthlySummary(month: string, txs: Pick<Transaction, "amount" | "category">[], currency: string) {
    return localMonthly(month, txs, currency) + DEMO;
  }

  async dailyBrief(input: BriefInput) {
    return localBrief(input) + DEMO;
  }

  async write(): Promise<string> {
    throw new ProviderError("Writing help needs AI. Add a free OpenRouter key in Settings → AI & API keys.", 501);
  }
}
