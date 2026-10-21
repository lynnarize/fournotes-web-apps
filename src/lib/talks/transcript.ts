// A talk's transcript: who's who, putting the server's and the browser's pieces together,
// and turning it into text for a note, the assistant and search.
import type { SpeakerId, Talk, TalkSegment } from "../types";

/** The name shown for a speaker: the one given, else a plain default. */
export function speakerName(t: Pick<Talk, "names" | "mode">, id: SpeakerId): string {
  const given = t.names[id]?.trim();
  if (given) return given;
  if (id === "me") return "You";
  if (id === "them") return t.mode === "call" ? "Them" : "Speaker";
  if (id === "room") return "Speaker";
  const letter = id.replace(/^them:/, "");
  return id.startsWith("them:") ? `Caller ${letter}` : `Speaker ${letter}`;
}

/** The speakers in a transcript, in order of first appearance, merged where they share a name. */
export function speakersOf(t: Talk, segments = transcriptOf(t)) {
  const seen = new Map<string, { name: string; ids: SpeakerId[]; seconds: number; lines: number }>();
  for (const s of segments) {
    const name = speakerName(t, s.speaker);
    const key = name.toLowerCase();
    const e = seen.get(key) ?? { name, ids: [], seconds: 0, lines: 0 };
    if (!e.ids.includes(s.speaker)) e.ids.push(s.speaker);
    e.seconds += Math.max(0, s.end - s.start);
    e.lines++;
    seen.set(key, e);
  }
  return [...seen.values()];
}

/**
 * The transcript as it stands: each channel's server pieces where they came back, and the
 * browser's live captions for the stretches they didn't cover. Final once the talk is done.
 */
export function transcriptOf(t: Talk): TalkSegment[] {
  if (t.status === "done" && t.segments.length) return t.segments;
  return mergeTranscript(t);
}

export function mergeTranscript(t: Talk): TalkSegment[] {
  const done = t.chunks.filter((c) => c.status === "done" || c.status === "silent");
  const covered = (s: TalkSegment, channel: string) => {
    const mid = (s.start + s.end) / 2;
    // A piece of the whole room (a file, a talk transcribed again) covers every voice in it.
    return done.some((c) => (c.channel === channel || c.channel === "room") && mid >= c.start && mid < c.end);
  };
  const channelOf = (s: TalkSegment) => (s.speaker === "me" ? "me" : s.speaker === "them" || s.speaker.startsWith("them:") ? "them" : "room");
  const fromServer = done.flatMap((c) => c.segments ?? []);
  const fromLive = t.live.filter((s) => !covered(s, channelOf(s)));
  return [...fromServer, ...fromLive].filter((s) => s.text.trim()).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Lines in a row from the same person read as one turn. */
export function turns(t: Talk, segments = transcriptOf(t)) {
  const out: { speaker: string; name: string; start: number; end: number; text: string }[] = [];
  for (const s of segments) {
    const name = speakerName(t, s.speaker);
    const last = out[out.length - 1];
    // Short pauses join lines into one turn; a long turn is broken up so it stays readable.
    if (last && last.name === name && s.start - last.end < 2 && last.text.length < 400) {
      last.text += ` ${s.text.trim()}`;
      last.end = s.end;
    } else {
      out.push({ speaker: s.speaker, name, start: s.start, end: s.end, text: s.text.trim() });
    }
  }
  return out;
}

/** "[1:15] Andi: …" lines: for the assistant, a note, a copy. */
export const transcriptText = (t: Talk, segments?: TalkSegment[]) =>
  turns(t, segments).map((x) => `[${clock(x.start)}] ${x.name}: ${x.text}`).join("\n");

export const defaultTitle = (startedAt: Date) =>
  `Talk, ${startedAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
export const isDefaultTitle = (title: string) => /^Talk, /.test(title) || /^Recording, /.test(title);

// ---- Search ---------------------------------------------------------------------------
const STOP = new Set(
  ("the and for with that this from have has was were are you your not but all can will just into our out about what when where who how why " +
    "did does say said tell told talk talks call calls meeting there their they them then than yes okay also " +
    "yang dan untuk dengan ini itu dari ada akan bisa juga sudah belum tidak atau karena pada saya aku kamu kita apa siapa kapan bilang").split(" "),
);
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * The parts of talks that best match a question: about a minute of conversation each (and
 * each talk's write-up), scored by the distinct words they share with it, rarer words
 * counting for more. The assistant reads these to answer.
 */
export function talkPassages(all: Talk[], query: string, limit = 3) {
  const q = new Set(words(query));
  if (!q.size) return [];
  const passages: { talk: Talk; text: string; start: number; terms: Set<string> }[] = [];
  for (const t of all) {
    if (t.deletedAt) continue;
    const about = `${t.title} ${t.app ?? ""} ${Object.values(t.names).join(" ")}`;
    if (t.summary) {
      const text = `Summary: ${t.summary.text}\nKey points: ${t.summary.keyPoints.join("; ")}\nAction items: ${t.summary.actionItems.join("; ")}`;
      passages.push({ talk: t, text, start: 0, terms: new Set(words(`${about} ${text}`)) });
    }
    const ts = turns(t);
    for (let i = 0; i < ts.length; ) {
      let j = i;
      let len = 0;
      while (j < ts.length && (len < 900 || j === i)) len += ts[j++].text.length;
      const text = ts.slice(i, j).map((x) => `[${clock(x.start)}] ${x.name}: ${x.text}`).join("\n");
      passages.push({ talk: t, text, start: ts[i].start, terms: new Set(words(`${about} ${text}`)) });
      i = j;
    }
  }
  const df = new Map<string, number>();
  for (const p of passages) for (const w of q) if (p.terms.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = passages.map((p) => ({
    ...p,
    score: [...q].reduce((s, w) => (p.terms.has(w) ? s + Math.log(1 + passages.length / (df.get(w) ?? 1)) : s), 0),
  }));
  return scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ terms: _t, ...p }) => p);
}

/** Does a talk match a search box's words (title, names, summary, transcript)? */
export function matchesTalk(t: Talk, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${t.title} ${t.app ?? ""} ${Object.values(t.names).join(" ")} ${t.summary?.text ?? ""} ${transcriptOf(t).map((s) => s.text).join(" ")}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

// ---- Notes ------------------------------------------------------------------------------
/** The note "Save to Notes" writes: the summary, each person's profile, then the transcript. */
export function talkNote(t: Talk) {
  const when = new Date(t.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const s = t.summary;
  const people = s?.people
    .map((p) => `- **${speakerName(t, p.speaker)}**: ${p.profile}`)
    .filter((_, i, xs) => xs.findIndex((y) => y === xs[i]) === i) ?? [];
  const parts = [
    `**${t.mode === "call" ? "Call" : t.mode === "upload" ? "Recording" : "Talk"}** ${when}, ${clock(t.duration)}${t.app ? `, ${t.app}` : ""}`,
    s?.text ? `## Summary\n${s.text}` : "",
    s?.keyPoints.length ? `## Key points\n${s.keyPoints.map((k) => `- ${k}`).join("\n")}` : "",
    s?.actionItems.length ? `## Action items\n${s.actionItems.map((k) => `☐ ${k}`).join("\n")}` : "",
    people.length ? `## People\n${people.join("\n")}` : "",
    `## Transcript\n${transcriptText(t)}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}
