import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { resolveKeys, type ResolvedKeys } from "@/lib/ai/keys";
import { guardSharedKey } from "@/lib/ai/shared";
import { engineFor, engineSource, transcribeChunk, type Channel, type Engine } from "@/lib/ai/transcribe";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** The shared-key allowance applies to whichever engine spends the app's own key. */
const guard = (req: Request, keys: ResolvedKeys, engine: Engine) =>
  engineSource(keys, engine) === "server"
    ? guardSharedKey(req, { ...keys, provider: "openrouter", openrouter: { ...keys.openrouter, source: "server" } })
    : null;

// GET -> { engine }: which engine would transcribe ("stt", "audio", or null: the browser's captions only).
export async function GET(req: Request) {
  return NextResponse.json({ engine: engineFor(resolveKeys(req)) });
}

// POST multipart: file=<16 kHz WAV>, channel=me|them|room, lang, known=<json [{id, sample}]>, paid=1
// -> { engine, segments: [{ speaker, start, end, text }] }, times in seconds from the start of the file.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "transcribe");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const engine = engineFor(keys);
  if (!engine) return NextResponse.json({ error: "No transcription engine is set up.", code: "no-engine" }, { status: 501 });
  const blocked = guard(req, keys, engine);
  if (blocked) return blocked;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Audio required" }, { status: 400 });
    if (file.size > 4.4 * 1024 * 1024) return NextResponse.json({ error: "That piece of audio is too long." }, { status: 413 });
    const channel = (["me", "them", "room"].includes(String(form.get("channel"))) ? form.get("channel") : "room") as Channel;
    const lang = /^[a-z]{2}(-[A-Z]{2})?$/.test(String(form.get("lang"))) ? String(form.get("lang")) : "en-US";
    let known: { id: string; sample: string }[] = [];
    try {
      known = (JSON.parse(String(form.get("known") ?? "[]")) as { id?: unknown; sample?: unknown }[])
        .slice(0, 6)
        .map((k) => ({ id: String(k.id ?? "").slice(0, 8), sample: String(k.sample ?? "").slice(0, 160) }))
        .filter((k) => k.id && k.sample);
    } catch { /* none */ }
    return NextResponse.json(await transcribeChunk(file, keys, { channel, lang, known, paid: form.get("paid") === "1" }));
  } catch (e) {
    return aiError(e, "transcribe", engineSource(keys, engine));
  }
}
