import { NextResponse } from "next/server";
import { agentPrompt, agentResult, agentSchema, isAgentJob } from "@/lib/ai/agent";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { job, input } -> the job's answer (see lib/ai/agent.ts): stuck tasks, the note interview,
// notes that disagree, people in notes.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "agent");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const { job, input } = (await req.json().catch(() => ({}))) as { job?: unknown; input?: unknown };
    if (!isAgentJob(job)) return NextResponse.json({ error: "Unknown job" }, { status: 400 });
    let ask: ReturnType<typeof agentPrompt>;
    try {
      ask = agentPrompt(job, input);
    } catch {
      return NextResponse.json({ error: "That request isn't in the expected shape." }, { status: 400 });
    }
    const provider = await getProvider(keys);
    const out = agentResult(job, await provider.agent(ask.system, ask.prompt, agentSchema(job), ask.fast));
    if (!out) return NextResponse.json({ error: "The AI's answer wasn't usable. Try again." }, { status: 502 });
    return NextResponse.json(out);
  } catch (e) {
    return aiError(e, `ai/agent`, activeSource(keys));
  }
}
