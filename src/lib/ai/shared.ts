import "server-only";
// Protection for the deployment's own ("shared") AI key.
//
// The key itself never reaches the browser, so visitors can't take it. What they
// can do is use up its free daily allowance through this app, so requests that
// run on the shared key must:
//   1. come from this site (Origin/Referer check), and
//   2. stay under a per-visitor and per-day request cap.
//
// Caveat: the counters live in memory, so a serverless platform that starts a new
// instance starts a new count. The hard guarantee is on the provider side — give
// the key a $0 credit limit in OpenRouter so it can never cost money.
import { NextResponse } from "next/server";
import { TOKEN_COOKIE, unseal, type GoogleSession } from "../google-server";
import type { ResolvedKeys } from "./keys";

const today = () => new Date().toISOString().slice(0, 10);
let day = today();
let dayTotal = 0;
const perVisitor = new Map<string, number>();

const dailyLimit = () => Number(process.env.SHARED_AI_DAILY_LIMIT || 200);
const anonLimit = () => Number(process.env.SHARED_AI_PER_IP_DAILY || 10);
const signedInLimit = () => Number(process.env.SHARED_AI_PER_USER_DAILY || 40);
const requireSignIn = () => process.env.SHARED_AI_REQUIRE_SIGNIN === "true";

/** Google-signed-in visitors are counted per account, which is far harder to fake than an IP. */
function signedInAs(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const raw = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${TOKEN_COOKIE}=`));
  const session = unseal<GoogleSession>(raw?.slice(TOKEN_COOKIE.length + 1));
  return session?.email ?? (session ? "google-user" : null);
}

const hostOf = (value: string | null) => {
  try {
    return value ? new URL(value).host : null;
  } catch {
    return null;
  }
};

function allowedHosts(req: Request) {
  const configured = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length) return configured.map((o) => hostOf(o) ?? o);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? [host] : [];
}

const visitorKey = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

/** Returns a response to send back when the shared key may not be used. */
export function guardSharedKey(req: Request, keys: ResolvedKeys): NextResponse | null {
  if (keys.provider === "demo") return null;
  const source = keys[keys.provider].source;
  if (source !== "server") return null; // the user brought their own key: no limits from us

  const from = hostOf(req.headers.get("origin")) ?? hostOf(req.headers.get("referer"));
  const hosts = allowedHosts(req);
  if (hosts.length && (!from || !hosts.includes(from))) {
    return NextResponse.json(
      { error: "The shared AI key only works inside the app. Add your own free key in Settings → AI & API keys." },
      { status: 403 },
    );
  }

  const account = signedInAs(req);
  if (!account && requireSignIn()) {
    return NextResponse.json(
      { error: "Sign in with Google to use the app's shared AI, or add your own free key in Settings → AI & API keys." },
      { status: 401 },
    );
  }

  if (day !== today()) {
    day = today();
    dayTotal = 0;
    perVisitor.clear();
  }
  const visitor = account ? `user:${account}` : `ip:${visitorKey(req)}`;
  const used = perVisitor.get(visitor) ?? 0;
  if (dayTotal >= dailyLimit() || used >= (account ? signedInLimit() : anonLimit())) {
    return NextResponse.json(
      {
        error: account
          ? "The app's shared free AI allowance is used up for today. Add your own free OpenRouter key in Settings → AI & API keys — it takes a minute and gives you your own allowance."
          : "Today's shared AI allowance for visitors is used up. Sign in with Google for a bigger allowance, or add your own free key in Settings → AI & API keys.",
      },
      { status: 429 },
    );
  }
  dayTotal += 1;
  perVisitor.set(visitor, used + 1);
  return null;
}

export const sharedKeyUsage = () => ({
  day,
  dayTotal,
  dailyLimit: dailyLimit(),
  anonLimit: anonLimit(),
  signedInLimit: signedInLimit(),
  requireSignIn: requireSignIn(),
});
