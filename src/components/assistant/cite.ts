// Citations in an answer: the model ends a sentence with [n] for a numbered source it was
// given (see answerSources in lib/search.ts). Here they are read back: numbers it wasn't
// given are dropped, the rest are renumbered 1…n in the order they are first cited, and
// each marker is tied to the sentence it ends so the two can light up together.
import type { AnswerSource, SourceKind } from "@/lib/types";

/** A run of adjacent markers: [2], [1][3], [1, 3], [source 2]. Never a Markdown link ([text](url)). */
const GROUP = /(?:\[\s*(?:sources?\s*)?\d{1,2}(?:\s*[,;]\s*(?:sources?\s*)?\d{1,2})*\s*\](?!\())+/gi;
const numbersIn = (group: string) => [...group.matchAll(/\d{1,2}/g)].map((m) => Number(m[0]));

export type Cited = AnswerSource & { shown: number };
export type Citations = { list: Cited[]; shownOf: Map<number, number>; checked: boolean };

/**
 * The sources a reply cites, numbered 1…n in the order it first cites them. `checked` is
 * false when the reply was given no sources at all: its text is then left exactly as written.
 */
export function citations(text: string, sources?: AnswerSource[]): Citations {
  const shownOf = new Map<number, number>();
  const list: Cited[] = [];
  if (!sources?.length) return { list, shownOf, checked: false };
  const byN = new Map(sources.map((s) => [s.n, s]));
  for (const m of text.matchAll(GROUP)) {
    for (const n of numbersIn(m[0])) {
      const s = byN.get(n);
      if (!s || shownOf.has(n)) continue;
      shownOf.set(n, list.length + 1);
      list.push({ ...s, shown: list.length + 1 });
    }
  }
  return { list, shownOf, checked: true };
}

/** A run of text, and the sources its last sentence cites (shown numbers). */
export type Segment = { text: string; cites?: number[] };

/** Where the sentence ending at the end of `text` starts. */
function sentenceStart(text: string) {
  const body = text.replace(/\s+$/, "");
  let start = 0;
  for (const b of body.matchAll(/[.!?…]["”’)\]]*\s+/g)) start = b.index! + b[0].length;
  return start;
}

/**
 * One line of the answer cut at its citations: each marker becomes `cites` on the
 * sentence it ends. Markers for numbers that weren't given are removed.
 */
export function segment(line: string, c: Citations): Segment[] {
  if (!c.checked) return [{ text: line }];
  const out: Segment[] = [];
  const plain = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && !last.cites) last.text += text;
    else out.push({ text });
  };
  let cursor = 0;
  for (const m of line.matchAll(GROUP)) {
    const at = m.index!;
    const pre = line.slice(cursor, at);
    cursor = at + m[0].length;
    const cites = [...new Set(numbersIn(m[0]).map((n) => c.shownOf.get(n)).filter((x): x is number => x != null))];
    if (!cites.length) {
      plain(pre.replace(/\s+$/, ""));
      continue;
    }
    const start = sentenceStart(pre);
    plain(pre.slice(0, start));
    out.push({ text: pre.slice(start), cites });
  }
  plain(line.slice(cursor));
  return out;
}

/** The answer as plain text: markers renumbered as shown ([1]), unknown ones removed. */
export function renumbered(text: string, c: Citations) {
  if (!c.checked) return text;
  return text.replace(new RegExp(`([ \\t]*)(${GROUP.source})`, "gi"), (_all, space: string, group: string) => {
    const shown = [...new Set(numbersIn(group).map((n) => c.shownOf.get(n)).filter((x): x is number => x != null))];
    return shown.length ? `${space}${shown.map((n) => `[${n}]`).join("")}` : "";
  });
}

/** The answer with every citation marker removed: for titles and for reading aloud. */
export const withoutCitations = (text: string) => text.replace(new RegExp(`[ \\t]*(${GROUP.source})`, "gi"), "");

const KIND_NAME: Record<SourceKind, string> = { note: "Note", quick: "Quick note", todo: "To-Do", transaction: "Finance", budget: "Budgets" };

const shortDate = (day?: string) => {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const d = new Date(`${day}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

/** "Finance, Oct 21", "Budgets", "Quick note, Oct 18". */
export function sourceLabel(s: Pick<AnswerSource, "kind" | "date">) {
  const day = s.kind === "budget" ? "" : shortDate(s.date);
  return day ? `${KIND_NAME[s.kind]}, ${day}` : KIND_NAME[s.kind];
}

/** The cited sources as a short list under the text, for a copy or a saved note. */
export function sourcesText(list: Cited[]) {
  if (!list.length) return "";
  return `Sources\n${list.map((s) => `${s.shown}. ${s.title} (${sourceLabel(s)})`).join("\n")}`;
}

/** What Copy puts on the clipboard: the answer with its references, then what they refer to. */
export function plainAnswer(text: string, sources?: AnswerSource[]) {
  const c = citations(text, sources);
  const list = sourcesText(c.list);
  return `${renumbered(text, c).trim()}${list ? `\n\n${list}` : ""}`;
}
