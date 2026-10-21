import "server-only";
// Transcribing a piece of a talk (16 kHz WAV, up to two minutes). Two engines, the first
// available wins:
//   stt   — a speech-to-text key (OpenAI Whisper, Groq): accurate, with timestamps, but
//           no telling voices apart; a call's two sides are kept apart by recording them
//           separately instead.
//   audio — an OpenRouter model that listens (OpenRouter asks for $0.50 of credit for
//           audio, even on free models): it also tells the voices apart.
// Without either, the browser's live captions are the transcript (see lib/talks/recorder.ts).
import { ProviderError } from "./errors";
import type { ResolvedKeys } from "./keys";
import { listenPrompt, readSegments, type Channel } from "./listen";

export type { Channel };
export type Segment = { speaker: string; start: number; end: number; text: string };
export type Engine = "stt" | "audio";

/** The free model is used on the shared key and on a free-tier key; a paid-tier key gets a stronger one. */
const AUDIO_FREE = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
const AUDIO_PAID = "google/gemini-3.5-flash-lite";

export function engineFor(keys: ResolvedKeys): Engine | null {
  if (keys.stt.apiKey) return "stt";
  if (keys.openrouter.apiKey) return "audio";
  return null;
}

/** Whose key the engine spends: the user's own, or the app's shared one. */
export const engineSource = (keys: ResolvedKeys, engine: Engine) => (engine === "stt" ? keys.stt.source : keys.openrouter.source);

const lang2 = (lang: string) => lang.split("-")[0].toLowerCase().slice(0, 2);

export async function transcribeChunk(
  file: File,
  keys: ResolvedKeys,
  opts: { channel: Channel; lang: string; known: { id: string; sample: string }[]; paid: boolean },
): Promise<{ engine: Engine; segments: Segment[] }> {
  const engine = engineFor(keys);
  if (!engine) throw new ProviderError("No transcription engine: add a speech-to-text key in Settings → AI & API keys.", 501);
  const segments = engine === "stt" ? await whisper(file, keys.stt, opts) : await listen(file, keys.openrouter, opts);
  return { engine, segments };
}

// ---- Speech-to-text APIs (OpenAI-compatible) ----------------------------------------
async function whisper(file: File, stt: ResolvedKeys["stt"], opts: { channel: Channel; lang: string }): Promise<Segment[]> {
  const body = new FormData();
  body.append("file", file, "chunk.wav");
  body.append("model", stt.model);
  body.append("response_format", "verbose_json");
  body.append("language", lang2(opts.lang));
  const res = await fetch(`${stt.baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${stt.apiKey}` }, body });
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(stt.source === "user" ? "Your speech-to-text key was rejected. Check it in Settings → AI & API keys." : "The transcription key was rejected.", 401);
  }
  if (!res.ok) throw new ProviderError(`Transcription failed (${res.status}).`, res.status === 429 ? 429 : 502);
  const json = (await res.json()) as { text?: string; segments?: { start?: number; end?: number; text?: string }[] };
  const speaker = opts.channel;
  const segs = (json.segments ?? [])
    .map((s) => ({ speaker, start: Number(s.start) || 0, end: Number(s.end) || 0, text: (s.text ?? "").trim() }))
    .filter((s) => s.text);
  return segs.length || !json.text?.trim() ? segs : [{ speaker, start: 0, end: 0, text: json.text.trim() }];
}

// ---- A model that listens (OpenRouter) -----------------------------------------------
async function listen(
  file: File,
  or: ResolvedKeys["openrouter"],
  opts: { channel: Channel; lang: string; known: { id: string; sample: string }[]; paid: boolean },
): Promise<Segment[]> {
  const model = opts.paid && or.source === "user" ? AUDIO_PAID : AUDIO_FREE;
  const prompt = listenPrompt(opts.channel, opts.lang, opts.known);
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${or.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": or.referer, "X-Title": "Four Notes" },
    body: JSON.stringify({
      model,
      max_tokens: 6000,
      reasoning: { exclude: true },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "input_audio", input_audio: { data: Buffer.from(await file.arrayBuffer()).toString("base64"), format: "wav" } },
        ],
      }],
    }),
  });
  if (res.status === 402) {
    throw new ProviderError(
      "OpenRouter only transcribes audio on an account with at least $0.50 of credit, even with free models. Add credit there, or a speech-to-text key in Settings → AI & API keys.",
      402,
    );
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("OpenRouter refused the transcription. Check the key in Settings → AI & API keys.", 401);
  if (!res.ok) throw new ProviderError(`Transcription failed (${res.status}).`, res.status === 429 ? 429 : 502);
  const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const parsed = readJson(raw);
  if (!parsed) throw new ProviderError("The transcription came back unreadable.", 502);
  return readSegments(opts.channel, parsed);
}

function readJson(raw: string): { speaker?: unknown; start?: unknown; end?: unknown; text?: unknown }[] | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  for (const candidate of [text, text.match(/\{[\s\S]*\}/)?.[0] ?? ""]) {
    try {
      const v = JSON.parse(candidate) as { segments?: unknown };
      if (Array.isArray(v.segments)) return v.segments as never;
    } catch { /* try the next */ }
  }
  return null;
}
