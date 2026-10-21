import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { title, content, since } -> { changed, summary, changes, sources } : a "keep current" note, checked against the web.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "recheck");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const { title, content, since } = (await req.json()) as { title?: unknown; content?: unknown; since?: unknown };
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "Note content required" }, { status: 400 });
    const provider = await getProvider(keys);
    if (!provider.recheck) {
      return NextResponse.json({ error: "Checking the web needs Claude. Add an Anthropic key in Settings → AI & API keys." }, { status: 400 });
    }
    const when = typeof since === "string" && !Number.isNaN(Date.parse(since)) ? since : new Date().toISOString();
    return NextResponse.json(await provider.recheck(typeof title === "string" ? title.slice(0, 200) : "", content, when));
  } catch (e) {
    return aiError(e, "ai/recheck", activeSource(keys));
  }
}
