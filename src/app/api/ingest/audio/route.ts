import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys, type ResolvedKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";
import type { ClientContext } from "@/lib/types";

export const runtime = "nodejs";

// POST multipart/form-data: file=<audio blob> (optional), transcript=<text> (optional), context=<json>
// If a speech-to-text key is available (the user's or the server's) we transcribe
// the audio on the server; otherwise we use the live transcript the browser produced.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "ingest");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const context = JSON.parse(String(form.get("context") ?? "{}")) as ClientContext;
    let transcript = String(form.get("transcript") ?? "").trim();

    if (file instanceof File && file.size > 0 && keys.stt.apiKey) {
      transcript = (await transcribe(file, keys.stt)) || transcript;
    }
    if (!transcript) {
      return NextResponse.json(
        { error: "No speech detected. Add a speech-to-text key in Settings → AI & API keys, or use a browser with live transcription (Chrome/Edge/Safari)." },
        { status: 422 },
      );
    }
    const provider = await getProvider(keys);
    return NextResponse.json({ ...(await provider.summarizeRecording(transcript, context)), transcript });
  } catch (e) {
    return aiError(e, "ingest/audio", activeSource(keys));
  }
}

// Works with any OpenAI-compatible transcription API (OpenAI Whisper, Groq, etc.)
async function transcribe(file: File, stt: ResolvedKeys["stt"]): Promise<string> {
  const body = new FormData();
  body.append("file", file, file.name || "recording.webm");
  body.append("model", stt.model);
  const res = await fetch(`${stt.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stt.apiKey}` },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(stt.source === "user" ? "Your speech-to-text key was rejected. Check it in Settings → AI & API keys." : "Transcription key was rejected.");
  }
  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const json = (await res.json()) as { text?: string };
  return json.text?.trim() ?? "";
}
