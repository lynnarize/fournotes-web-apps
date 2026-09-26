import "server-only";
// Which credentials an AI request uses. A key the user brought (request headers,
// set in Settings → AI & API keys) wins, then the server's own keys, then demo mode.
// OpenRouter's free models are the default when no Anthropic key is present.
// OpenCode Go (a subscription) works only with the user's own key.
import {
  ANTHROPIC_USER_MODELS, DEFAULT_OPENCODE_MODEL, DEFAULT_OPENROUTER_FAST_MODEL, DEFAULT_OPENROUTER_MODEL, DEFAULT_VISION_MODEL,
  isFreeModel, isModelId, OPENCODE_GO_MODELS, opencodeVisionFor, OPENROUTER_FREE_MODELS, visionModelFor,
} from "./models";

export type KeySource = "user" | "server" | "none";
export type ProviderName = "anthropic" | "openrouter" | "opencode" | "demo";

export const USER_MODELS = ANTHROPIC_USER_MODELS.map((m) => m.id);
export const USER_OPENROUTER_MODELS = OPENROUTER_FREE_MODELS.map((m) => m.id);

// Fixed endpoints for user-supplied speech-to-text keys (no arbitrary URLs, so
// the server can't be pointed at internal hosts).
export const STT_PROVIDERS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
} as const;

export interface ResolvedKeys {
  provider: ProviderName;
  anthropic: { apiKey?: string; model: string; fastModel: string; source: KeySource };
  openrouter: { apiKey?: string; model: string; fastModel: string; visionModel: string; source: KeySource; referer: string };
  opencode: { apiKey?: string; model: string; fastModel: string; visionModel: string; source: KeySource };
  voyage: { apiKey?: string; model: string; source: KeySource };
  stt: { apiKey?: string; baseUrl: string; model: string; source: KeySource };
}

const header = (req: Request, name: string) => {
  const v = req.headers.get(name)?.trim();
  return v && /^[\x21-\x7e]{1,400}$/.test(v) ? v : undefined;
};
const allowed = (value: string | undefined, list: string[]) => (value && list.includes(value) ? value : undefined);

const origin = (req: Request) => {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? "https";
  return host ? `${proto}://${host}` : "https://app.fournotes.xyz";
};

export function resolveKeys(req: Request): ResolvedKeys {
  const env = process.env;

  const userAnthropic = header(req, "x-anthropic-key");
  const anthropicKey = userAnthropic || env.ANTHROPIC_API_KEY || undefined;
  const model = (userAnthropic && allowed(header(req, "x-anthropic-model"), USER_MODELS)) || env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const fastModel = (userAnthropic && allowed(header(req, "x-anthropic-fast-model"), USER_MODELS)) || env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5";

  const userOpenRouter = header(req, "x-openrouter-key");
  const openRouterKey = userOpenRouter || env.OPENROUTER_API_KEY || undefined;
  // A user's own key may pick any paid model (billed to them); free ones must be on the tested list.
  const requested = header(req, "x-openrouter-model");
  const userPaid = userOpenRouter && isModelId(requested) && !isFreeModel(requested) ? requested : undefined;
  // Anyone may pick from the tested free list, on their own key or the shared one (the composer's model menu).
  const orModel = userPaid || allowed(requested, USER_OPENROUTER_MODELS) || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  // Paid mode runs the quick jobs on the same model: switching to paid means leaving the free limits behind.
  const orFastModel = userPaid || env.OPENROUTER_FAST_MODEL || DEFAULT_OPENROUTER_FAST_MODEL;
  // The deployment's own key is shared by every visitor: keep it on free
  // models unless the owner opts in, so it can never spend credits.
  const sharedFreeOnly = !userOpenRouter && env.OPENROUTER_ALLOW_PAID !== "true";
  const safeModel = sharedFreeOnly && !isFreeModel(orModel) ? DEFAULT_OPENROUTER_MODEL : orModel;
  const safeFastModel = sharedFreeOnly && !isFreeModel(orFastModel) ? DEFAULT_OPENROUTER_FAST_MODEL : orFastModel;

  const userOpenCode = header(req, "x-opencode-key");
  const ocModel = allowed(header(req, "x-opencode-model"), OPENCODE_GO_MODELS.map((m) => m.id)) || DEFAULT_OPENCODE_MODEL;

  const userVoyage = header(req, "x-voyage-key");
  const userStt = header(req, "x-stt-key");
  const sttProvider = STT_PROVIDERS[header(req, "x-stt-provider") === "groq" ? "groq" : "openai"];

  // With several keys saved, the one picked in Settings wins; otherwise Claude, OpenCode, OpenRouter.
  const userKeys: [ProviderName, string | undefined][] = [["anthropic", userAnthropic], ["opencode", userOpenCode], ["openrouter", userOpenRouter]];
  const preferred = header(req, "x-ai-provider");
  const userProvider = (userKeys.find(([name, key]) => key && name === preferred) ?? userKeys.find(([, key]) => key))?.[0];
  const provider: ProviderName = userProvider ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENROUTER_API_KEY ? "openrouter" : "demo");

  return {
    provider,
    anthropic: { apiKey: anthropicKey, model, fastModel, source: userAnthropic ? "user" : anthropicKey ? "server" : "none" },
    openrouter: {
      apiKey: openRouterKey,
      model: safeModel,
      fastModel: safeFastModel,
      // A text-only paid model hands photos to the tested free vision model.
      visionModel: userPaid && header(req, "x-openrouter-vision") === "0" ? DEFAULT_VISION_MODEL : visionModelFor(safeModel),
      source: userOpenRouter ? "user" : openRouterKey ? "server" : "none",
      referer: origin(req),
    },
    opencode: {
      apiKey: userOpenCode,
      model: ocModel,
      fastModel: ocModel,
      visionModel: opencodeVisionFor(ocModel),
      source: userOpenCode ? "user" : "none",
    },
    voyage: {
      apiKey: userVoyage || env.VOYAGE_API_KEY || undefined,
      model: env.VOYAGE_MODEL || "voyage-3.5-lite",
      source: userVoyage ? "user" : env.VOYAGE_API_KEY ? "server" : "none",
    },
    stt: userStt
      ? { apiKey: userStt, baseUrl: sttProvider.baseUrl, model: sttProvider.model, source: "user" }
      : {
          apiKey: env.STT_API_KEY || undefined,
          baseUrl: env.STT_BASE_URL || STT_PROVIDERS.openai.baseUrl,
          model: env.STT_MODEL || STT_PROVIDERS.openai.model,
          source: env.STT_API_KEY ? "server" : "none",
        },
  };
}

/** Which key a failure should be blamed on, for error messages. */
export const activeSource = (keys: ResolvedKeys): KeySource =>
  keys.provider === "demo" ? "none" : keys[keys.provider].source;
