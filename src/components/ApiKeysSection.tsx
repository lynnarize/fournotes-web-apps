"use client";
// Settings → AI & API keys.
// One tab per provider keeps the section short. OpenRouter's free models come
// first: one free key and the app is fully working. The same key can switch to
// paid models; OpenCode Zen and Claude are the alternatives.
import { useEffect, useState } from "react";
import { isModelId, MODELS_CHECKED_AT, perMillion, type PaidModel } from "@/lib/ai/models";
import { SETTINGS_FIELD_KEY, useOpenSettings } from "@/lib/nav";
import {
  activeProvider, clearUserKeys, isValidKey, keyHeaders, maskKey, MODEL_OPTIONS, OPENCODE_GO_MODELS, OPENCODE_GO_URL, opencodeLabel, OPENROUTER_CREDITS_URL,
  OPENROUTER_FREE_MODELS, OPENROUTER_KEYS_URL, saveUserKeys, useUserKeys, type AiProvider, type SttProvider, type UserKeys,
} from "@/lib/byok";
import SecretInput from "./SecretInput";
import { inputBox, useToast } from "./ui";

type Service = AiProvider | "voyage" | "stt";
type Tab = AiProvider | "more";
type ServerStatus = {
  anthropic: boolean; openrouter: boolean; voyage: boolean; stt: boolean;
  provider: "anthropic" | "openrouter" | "demo";
  model: string; fastModel: string; openrouterModel: string;
  shared?: boolean; sharedPerVisitorDaily?: number; sharedSignedInDaily?: number; sharedDailyLimit?: number; sharedRequiresSignIn?: boolean;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "opencode", label: "OpenCode" },
  { id: "anthropic", label: "Claude" },
  { id: "more", label: "More" },
];
const PROVIDER_NAME: Record<AiProvider, string> = { openrouter: "OpenRouter", opencode: "OpenCode Go", anthropic: "Claude" };

const normalized = (k: UserKeys) => JSON.stringify(Object.entries(k).filter(([, v]) => v).sort());
const modelLabel = (id: string) => OPENROUTER_FREE_MODELS.find((m) => m.id === id)?.label ?? id;
const hint = "text-xs leading-relaxed text-[var(--muted)]";
const link = "text-[var(--accent)]";

export default function ApiKeysSection() {
  const toast = useToast();
  const { keys, persist } = useUserKeys();
  const [draft, setDraft] = useState<UserKeys>({});
  const [keep, setKeep] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [tab, setTab] = useState<Tab>("openrouter");
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [testing, setTesting] = useState<Service | null>(null);
  const [results, setResults] = useState<Partial<Record<Service, { ok: boolean; message: string }>>>({});
  const [paidModels, setPaidModels] = useState<PaidModel[] | null>(null);
  const [paidError, setPaidError] = useState(false);

  useEffect(() => {
    setDraft(keys);
    setKeep(persist);
  }, [keys, persist]);

  // Open on the provider in use, once the saved keys have loaded.
  const savedActive = activeProvider(keys);
  useEffect(() => {
    if (savedActive) setTab(savedActive);
  }, [savedActive]);

  // Opened from "Add a key" on a speech error: show the transcription key field,
  // whether Settings opens now (flag read on mount) or was already open (event).
  const revealField = (field?: string | null) => {
    if (field !== "stt") return;
    setTab("more");
    try { sessionStorage.removeItem(SETTINGS_FIELD_KEY); } catch { /* storage blocked */ }
  };
  useEffect(() => {
    try { revealField(sessionStorage.getItem(SETTINGS_FIELD_KEY)); } catch { /* storage blocked */ }
  }, []);
  useOpenSettings(({ field }) => revealField(field));

  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
  }, []);

  const paid = draft.openrouterTier === "paid";
  // The paid list is long and changes often: load it live, only once Paid is picked.
  useEffect(() => {
    if (!paid || paidModels) return;
    fetch("/api/ai/openrouter-models")
      .then((r) => r.json() as Promise<{ models?: PaidModel[] }>)
      .then((d) => (d.models?.length ? setPaidModels(d.models) : setPaidError(true)))
      .catch(() => setPaidError(true));
  }, [paid, paidModels]);
  const paidInfo = paidModels?.find((m) => m.id === draft.openrouterPaidModel);

  const set = (p: Partial<UserKeys>) => {
    setDraft((d) => ({ ...d, ...p }));
    setResults((r) => {
      const next = { ...r };
      if ("openrouterKey" in p || "openrouterModel" in p || "openrouterTier" in p || "openrouterPaidModel" in p) delete next.openrouter;
      if ("opencodeKey" in p || "opencodeGoModel" in p) delete next.opencode;
      if ("anthropicKey" in p || "anthropicModel" in p || "anthropicFastModel" in p) delete next.anthropic;
      if ("voyageKey" in p) delete next.voyage;
      if ("sttKey" in p || "sttProvider" in p) delete next.stt;
      return next;
    });
  };

  const invalid = [draft.openrouterKey, draft.opencodeKey, draft.anthropicKey, draft.voyageKey, draft.sttKey].some((k) => !isValidKey(k));
  const paidMissing = paid && Boolean(draft.openrouterKey) && !isModelId(draft.openrouterPaidModel);
  const dirty = normalized(draft) !== normalized(keys) || keep !== persist;
  const hasSaved = Object.values(keys).some(Boolean);
  const draftActive = activeProvider(draft);
  const providerKeys = [draft.openrouterKey, draft.opencodeKey, draft.anthropicKey].filter(Boolean).length;

  const test = async (service: Service) => {
    setTesting(service);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders(draft) },
        body: JSON.stringify({ service }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      setResults((r) => ({ ...r, [service]: { ok: Boolean(res.ok && data.ok), message: data.message ?? data.error ?? "Test failed" } }));
    } catch {
      setResults((r) => ({ ...r, [service]: { ok: false, message: "Couldn't run the test. Are you online?" } }));
    } finally {
      setTesting(null);
    }
  };

  const save = () => {
    saveUserKeys(draft, keep);
    const which = draftActive === "openrouter" && paid ? "OpenRouter (paid)" : draftActive === "opencode" ? "OpenCode Go" : draftActive ? PROVIDER_NAME[draftActive] : null;
    toast(which ? `🔑 Key saved. AI requests now use your ${which} key.` : "API key settings saved.");
  };

  const remove = () => {
    if (!window.confirm("Remove your API keys from this browser?")) return;
    clearUserKeys();
    setResults({});
    toast(server?.provider === "demo" ? "Keys removed. The app is back in demo mode." : "Keys removed. The app will use the server's key.");
  };

  const using =
    savedActive === "anthropic"
      ? { label: "Your Claude key", detail: `${maskKey(keys.anthropicKey)} · ${keys.anthropicModel ?? server?.model ?? "default model"}`, tone: "var(--ok)" }
      : savedActive === "opencode"
        ? { label: "Your OpenCode Go key", detail: `${maskKey(keys.opencodeKey)} · ${opencodeLabel(keys.opencodeGoModel)}`, tone: "var(--ok)" }
        : savedActive === "openrouter"
          ? keys.openrouterTier === "paid" && keys.openrouterPaidModel
            ? { label: "Your OpenRouter key (paid)", detail: `${maskKey(keys.openrouterKey)} · ${keys.openrouterPaidModel}`, tone: "var(--ok)" }
            : { label: "Your OpenRouter key", detail: `${maskKey(keys.openrouterKey)} · ${modelLabel(keys.openrouterModel ?? server?.openrouterModel ?? "")}`, tone: "var(--ok)" }
          : server?.anthropic
            ? { label: "Shared key (Claude)", detail: server.model, tone: "var(--accent)" }
            : server?.openrouter
              ? { label: "Shared free key", detail: `${modelLabel(server.openrouterModel)} · limited each day`, tone: "var(--accent)" }
              : { label: "Demo mode", detail: "rule-based replies, no photo reading", tone: "#d9730d" };

  const keyInput = (value: string | undefined, onChange: (v: string) => void, placeholder: string, label: string) => (
    <SecretInput
      reveal={reveal}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className={`${inputBox} min-w-0 flex-1 font-mono text-xs ${value && !isValidKey(value) ? "border-[var(--danger)]" : ""}`}
    />
  );

  const testButton = (service: Service, value: string | undefined) => (
    <button
      type="button"
      className="btn-ghost border border-[var(--line)] text-xs"
      disabled={!value || !isValidKey(value) || testing !== null}
      onClick={() => test(service)}
    >
      {testing === service ? "Testing…" : "Test"}
    </button>
  );

  const keyRow = (service: Service, value: string | undefined, onChange: (v: string) => void, placeholder: string, label: string) => (
    <div className="flex gap-2">
      {keyInput(value, onChange, placeholder, label)}
      <button type="button" className="btn-ghost text-xs" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>{reveal ? "Hide" : "Show"}</button>
      {testButton(service, value)}
    </div>
  );

  const resultLine = (service: Service) => {
    const r = results[service];
    return r ? (
      <p className="text-xs" style={{ color: r.ok ? "var(--ok)" : "var(--danger)" }} role="status">
        {r.ok ? "✓" : "✗"} {r.message}
      </p>
    ) : null;
  };

  const header = (title: React.ReactNode, href: string, linkText: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
      <span className="flex items-center gap-1.5">{title}</span>
      <a href={href} target="_blank" rel="noreferrer" className={link}>{linkText} ↗</a>
    </div>
  );

  const badge = (text: string, color: string) => (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" style={{ background: color }}>{text}</span>
  );

  const tierSwitch = (label: string, value: "free" | "paid", disabled: boolean, onPick: (tier: "free" | "paid") => void) => (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-md border border-[var(--line)] p-0.5 text-xs">
      {(["free", "paid"] as const).map((tier) => (
        <button
          key={tier}
          type="button"
          role="radio"
          aria-checked={value === tier}
          disabled={disabled}
          onClick={() => onPick(tier)}
          className={`min-h-8 rounded px-3 disabled:opacity-40 ${value === tier ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
        >
          {tier === "free" ? "Free" : "Paid"}
        </button>
      ))}
    </div>
  );

  // Only worth showing once there's a choice to make.
  const useForAi = (p: AiProvider, value: string | undefined) =>
    value && providerKeys > 1 ? (
      draftActive === p ? (
        <p className="text-xs text-[var(--ok)]">✓ AI requests use this key</p>
      ) : (
        <button type="button" className={`text-xs ${link}`} onClick={() => set({ aiProvider: p })}>Use this key for AI instead of {draftActive && PROVIDER_NAME[draftActive]}</button>
      )
    ) : null;

  const panels: Record<Tab, React.ReactNode> = {
    openrouter: (
      <>
        {header(
          <>{badge(paid ? "Paid" : "Free", paid ? "var(--accent)" : "var(--ok)")} OpenRouter key {server?.openrouter && !draft.openrouterKey ? "· server key in use" : ""}</>,
          paid ? OPENROUTER_CREDITS_URL : OPENROUTER_KEYS_URL,
          paid ? "Add credits" : "Get a free key",
        )}
        {keyRow("openrouter", draft.openrouterKey, (v) => set({ openrouterKey: v }), "sk-or-v1-…", "OpenRouter API key")}
        {resultLine("openrouter")}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {tierSwitch("OpenRouter models", paid ? "paid" : "free", !draft.openrouterKey, (tier) => set({ openrouterTier: tier === "paid" ? "paid" : undefined }))}
          {paid ? (
            <>
              <input
                list="openrouter-paid-models"
                value={draft.openrouterPaidModel ?? ""}
                disabled={!draft.openrouterKey}
                onChange={(e) => {
                  const id = e.target.value.trim();
                  const m = paidModels?.find((x) => x.id === id);
                  set({ openrouterPaidModel: id || undefined, openrouterPaidTextOnly: m ? !m.vision : undefined });
                }}
                placeholder={paidModels ? "Search, e.g. claude, gpt, gemini" : paidError ? "Model ID, e.g. provider/model" : "Loading models…"}
                aria-label="Paid model"
                autoComplete="off"
                spellCheck={false}
                className={`${inputBox} min-w-0 flex-1 font-mono text-xs ${paidMissing && draft.openrouterPaidModel ? "border-[var(--danger)]" : ""}`}
              />
              <datalist id="openrouter-paid-models">
                {paidModels?.map((m) => (
                  <option key={m.id} value={m.id}>{`${m.name} · ${perMillion(m.prompt)} in / ${perMillion(m.completion)} out${m.vision ? " · reads photos" : ""}`}</option>
                ))}
              </datalist>
            </>
          ) : (
            <select
              value={OPENROUTER_FREE_MODELS.some((m) => m.id === draft.openrouterModel) ? draft.openrouterModel : ""}
              disabled={!draft.openrouterKey}
              onChange={(e) => set({ openrouterModel: e.target.value || undefined })}
              aria-label="Free model"
              className={`${inputBox} min-w-0 flex-1`}
            >
              <option value="">Default{server ? ` (${modelLabel(server.openrouterModel)})` : ""}</option>
              {OPENROUTER_FREE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
        </div>
        {paid ? (
          <p className={hint}>
            {paidInfo && (
              <>{paidInfo.name}: {perMillion(paidInfo.prompt)} / {perMillion(paidInfo.completion)} per 1M tokens in / out
                {paidInfo.context ? `, ${Math.round(paidInfo.context / 1000)}K context` : ""}{paidInfo.vision ? ", reads photos" : ", text only"}. </>
            )}
            Billed to your OpenRouter credits, no daily limit. Used for every AI feature
            {paidInfo && !paidInfo.vision ? " except photos, which go to a free model that reads them" : ""}.
          </p>
        ) : (
          <p className={hint}>
            Free, with daily limits. Only models that correctly file to-dos and transactions are listed
            {MODELS_CHECKED_AT ? ` (tested ${new Date(MODELS_CHECKED_AT).toLocaleDateString()})` : ""}; if one is busy, the next is tried.
          </p>
        )}
        {useForAi("openrouter", draft.openrouterKey)}
      </>
    ),

    opencode: (
      <>
        {header(<>{badge("Go", "var(--accent)")} OpenCode Go key</>, OPENCODE_GO_URL, "Subscribe to Go")}
        {keyRow("opencode", draft.opencodeKey, (v) => set({ opencodeKey: v }), "sk-…", "OpenCode API key")}
        {resultLine("opencode")}
        <select
          // A model no longer listed shows as the default the server uses.
          value={OPENCODE_GO_MODELS.some((m) => m.id === draft.opencodeGoModel) ? draft.opencodeGoModel : ""}
          disabled={!draft.opencodeKey}
          onChange={(e) => set({ opencodeGoModel: e.target.value || undefined })}
          aria-label="OpenCode Go model"
          className={`${inputBox} mt-1 w-full`}
        >
          <option value="">Default ({opencodeLabel()})</option>
          {OPENCODE_GO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}{m.vision ? " · reads photos" : ""}</option>)}
        </select>
        <p className={hint}>
          Uses your OpenCode Go subscription ($10/month) with its 5-hour, weekly and monthly limits. Photos go to DeepSeek V4 Flash Vision,
          included in Go. OpenCode&apos;s free models only work inside OpenCode itself, so they can&apos;t be used here — for free AI, use an OpenRouter key.
        </p>
        {useForAi("opencode", draft.opencodeKey)}
      </>
    ),

    anthropic: (
      <>
        {header(
          <>{badge("Paid", "var(--accent)")} Anthropic key · best quality {server?.anthropic && !draft.anthropicKey ? "· server key in use" : ""}</>,
          "https://console.anthropic.com/settings/keys",
          "Get a key",
        )}
        {keyRow("anthropic", draft.anthropicKey, (v) => set({ anthropicKey: v }), "sk-ant-api03-…", "Anthropic API key")}
        {resultLine("anthropic")}
        <div className="grid gap-2 pt-1 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Main model
            <select value={draft.anthropicModel ?? ""} disabled={!draft.anthropicKey} onChange={(e) => set({ anthropicModel: e.target.value || undefined })} className={inputBox}>
              <option value="">Default{server ? ` (${server.model})` : ""}</option>
              {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Quick jobs model
            <select value={draft.anthropicFastModel ?? ""} disabled={!draft.anthropicKey} onChange={(e) => set({ anthropicFastModel: e.target.value || undefined })} className={inputBox}>
              <option value="">Default{server ? ` (${server.fastModel})` : ""}</option>
              {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
        <p className={hint}>Needed for “Ideas from the web”.</p>
        {useForAi("anthropic", draft.anthropicKey)}
      </>
    ),

    more: (
      <>
        <div className="space-y-1">
          {header(
            <>Voyage AI key · search notes by meaning{server?.voyage && !draft.voyageKey ? " · server key in use" : ""}</>,
            "https://dashboard.voyageai.com/api-keys",
            "Get a key",
          )}
          {keyRow("voyage", draft.voyageKey, (v) => set({ voyageKey: v }), "pa-…", "Voyage API key")}
          {resultLine("voyage")}
        </div>
        <div id="settings-field-stt" className="scroll-mt-20 space-y-1 border-t border-[var(--line)] pt-3">
          <div className="text-xs text-[var(--muted)]">
            Speech-to-text key · more accurate recordings{server?.stt && !draft.sttKey ? " · server key in use" : ""}
          </div>
          <div className="flex gap-2">
            <select value={draft.sttProvider ?? "openai"} onChange={(e) => set({ sttProvider: e.target.value as SttProvider })} aria-label="Speech-to-text provider" className={`${inputBox} text-xs`}>
              <option value="openai">OpenAI Whisper</option>
              <option value="groq">Groq Whisper</option>
            </select>
            {keyInput(draft.sttKey, (v) => set({ sttKey: v }), draft.sttProvider === "groq" ? "gsk_…" : "sk-…", "Speech-to-text API key")}
            {testButton("stt", draft.sttKey)}
          </div>
          {resultLine("stt")}
        </div>
      </>
    ),
  };

  const tabHasKey: Record<Tab, boolean> = {
    openrouter: Boolean(draft.openrouterKey),
    opencode: Boolean(draft.opencodeKey),
    anthropic: Boolean(draft.anthropicKey),
    more: Boolean(draft.voyageKey || draft.sttKey),
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-[var(--hover)] px-3 py-2">
        <span className="h-2 w-2 rounded-full" style={{ background: using.tone }} />
        <span>AI is using: <b>{using.label}</b></span>
        <span className="text-xs text-[var(--muted)]">{using.detail}</span>
      </div>

      {server?.shared && !savedActive && (
        <p className={hint}>
          Shared free key: about {server.sharedPerVisitorDaily ?? 10} AI requests a day ({server.sharedSignedInDaily ?? 40} signed in).
          Add your own free key for your own allowance.
        </p>
      )}

      <div role="tablist" aria-label="AI providers" className="flex gap-1 overflow-x-auto border-b border-[var(--line)] text-xs">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`ai-tab-${t.id}`}
              aria-selected={on}
              aria-controls="ai-tab-panel"
              onClick={() => setTab(t.id)}
              className={`-mb-px flex min-h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 ${on ? "border-[var(--text)] font-medium text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              {t.label}
              {tabHasKey[t.id] && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: t.id === draftActive ? "var(--ok)" : "var(--muted)" }}
                  title={t.id === draftActive ? "Key saved · used for AI" : "Key saved"}
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="ai-tab-panel" aria-labelledby={`ai-tab-${tab}`} className="space-y-1.5">
        {panels[tab]}
      </div>

      <div className="space-y-2 border-t border-[var(--line)] pt-3">
        <label className="flex flex-wrap items-center gap-x-2">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Remember keys on this device
          <span className="text-xs text-[var(--muted)]">(off: forgotten when this tab closes)</span>
        </label>
        <p className={hint}>
          Keys stay in this browser, encrypted, and are sent only with each AI request. Never stored on the server, synced or backed up; usage is
          billed to your provider account. Don&apos;t save keys on a shared computer.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md bg-[var(--text)] px-3 py-1 text-sm text-[var(--bg)] disabled:opacity-30" disabled={!dirty || invalid || paidMissing} onClick={save}>
            Save keys
          </button>
          {dirty && <button type="button" className="btn-ghost text-xs" onClick={() => { setDraft(keys); setKeep(persist); setResults({}); }}>Discard changes</button>}
          {invalid && <span className="text-xs text-[var(--danger)]">A key looks incomplete or has spaces.</span>}
          {!invalid && paidMissing && <span className="text-xs text-[var(--danger)]">Pick a paid OpenRouter model, or switch back to free.</span>}
          {hasSaved && <button type="button" className="btn-ghost ml-auto text-xs text-[var(--danger)]" onClick={remove}>Remove keys</button>}
        </div>
      </div>
    </section>
  );
}
