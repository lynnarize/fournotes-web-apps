"use client";
// The composer's model picker, as other AI apps have it: which model answers, and a quick
// switch between the ones you can use — each provider you have a key for, or the tested
// free models on the app's shared key. Keys and paid models are managed in Settings.
import { useEffect, useState } from "react";
import { ANTHROPIC_USER_MODELS, OPENCODE_GO_MODELS, OPENROUTER_FREE_MODELS } from "@/lib/ai/models";
import { serverStatus, type ServerStatus } from "@/lib/aiRoute";
import { activeProvider, saveUserKeys, useUserKeys, type AiProvider, type UserKeys } from "@/lib/byok";
import { openSettings } from "@/lib/nav";
import { Dropdown, MenuItem, MenuLabel, MenuSep } from "./notes/Dropdown";
import { Icon } from "./ui";

const claudeName = (id?: string) => ANTHROPIC_USER_MODELS.find((m) => m.id === id)?.label.split(" · ")[0] ?? "Claude";
/**
 * A model's family and version, without its size or variant: "Ling 3.0 Flash VL" → "Ling 3.0",
 * "Gemma 4 31B" → "Gemma 4", "DeepSeek V4 Pro" → "DeepSeek V4". Everything up to the version number.
 */
export function familyName(label: string) {
  const words = label.split(" · ")[0].split(/\s+/);
  const at = words.findIndex((w) => /^[vk]?\d+(\.\d+)*$/i.test(w));
  return at >= 0 ? words.slice(0, at + 1).join(" ") : words.filter((w) => !/^a?\d+(\.\d+)?[bm]$/i.test(w)).join(" ");
}

/**
 * One entry per family, in the list's order of preference. The text model stands for its
 * family: photos switch to a model that can read them on their own (see visionModelFor).
 */
function families<T extends { id: string; label: string; vision: boolean }>(models: T[]) {
  const out = new Map<string, T>();
  for (const m of models) {
    const name = familyName(m.label);
    const seen = out.get(name);
    if (!seen || (seen.vision && !m.vision)) out.set(name, m);
  }
  return [...out].map(([name, m]) => ({ id: m.id, name }));
}

const FREE = families(OPENROUTER_FREE_MODELS);
/**
 * OpenCode Go keeps its Pro and Flash choices apart (they differ in speed and depth); only the
 * vision model is left out, since photos switch to it on their own (opencodeVisionFor).
 */
const GO = OPENCODE_GO_MODELS.filter((m) => !m.vision).map((m) => ({ id: m.id, name: m.label }));
const freeName = (id?: string) =>
  familyName((OPENROUTER_FREE_MODELS.find((m) => m.id === id) ?? OPENROUTER_FREE_MODELS[0])?.label ?? "") || "Free model";
const goName = (id?: string) => (GO.find((m) => m.id === id) ?? GO[0]).name;
/** "google/gemma-4-31b-it" → "gemma-4-it": the provider and the size left out. */
const slugName = (id: string) => (id.split("/").pop() ?? id).replace(/-a?\d+(\.\d+)?b(?=-|:|$)/gi, "").replace(/:free$/, "");

export default function ModelMenu() {
  const { keys, persist } = useUserKeys();
  const [server, setServer] = useState<ServerStatus | null>(null);
  useEffect(() => { serverStatus().then(setServer); }, []);
  const own = activeProvider(keys);
  const save = (patch: Partial<UserKeys>) => saveUserKeys({ ...keys, ...patch }, persist);
  const pick = (provider: AiProvider, patch: Partial<UserKeys>) => save({ ...patch, aiProvider: provider });

  const orPaid = keys.openrouterTier === "paid" && keys.openrouterPaidModel;
  const current =
    own === "anthropic" ? claudeName(keys.anthropicModel)
    : own === "opencode" ? goName(keys.opencodeGoModel)
    : own === "openrouter" ? (orPaid ? slugName(keys.openrouterPaidModel!) : freeName(keys.openrouterModel))
    : !server ? ""
    : server.anthropic ? claudeName(server.model)
    : server.openrouter ? freeName(keys.sharedModel ?? server.openrouterModel)
    : "Demo mode";
  if (!current) return null;

  const hasOwn = Boolean(keys.anthropicKey || keys.opencodeKey || keys.openrouterKey);
  const on = (provider: AiProvider | null, active: boolean) => own === provider && active;

  return (
    <Dropdown
      label="Choose a model"
      title="Choose the model that answers"
      width={290}
      align="right"
      className="flex h-8 max-w-[9rem] items-center sm:max-w-[14rem] gap-1 rounded-lg px-2 text-[13px] text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
      button={<span className="truncate">{current}</span>}
    >
      {(close) => (
        <>
          {keys.anthropicKey && (
            <>
              <MenuLabel>Claude · your key</MenuLabel>
              {ANTHROPIC_USER_MODELS.map((m) => (
                <MenuItem key={m.id} label={m.label} active={on("anthropic", (keys.anthropicModel ?? server?.model ?? "claude-sonnet-5") === m.id)}
                  onSelect={() => { close(); pick("anthropic", { anthropicModel: m.id }); }} />
              ))}
            </>
          )}
          {keys.opencodeKey && (
            <>
              <MenuLabel>OpenCode Go · your key</MenuLabel>
              {GO.map((m) => (
                <MenuItem key={m.id} label={m.name} active={on("opencode", goName(keys.opencodeGoModel) === m.name)}
                  onSelect={() => { close(); pick("opencode", { opencodeGoModel: m.id }); }} />
              ))}
            </>
          )}
          {keys.openrouterKey && (
            <>
              <MenuLabel>OpenRouter · your key</MenuLabel>
              {keys.openrouterPaidModel && (
                <MenuItem label={`${slugName(keys.openrouterPaidModel)} · paid`} active={on("openrouter", Boolean(orPaid))}
                  onSelect={() => { close(); pick("openrouter", { openrouterTier: "paid" }); }} />
              )}
              {FREE.map((m) => (
                <MenuItem key={m.id} label={`${m.name} · free`} active={on("openrouter", !orPaid && freeName(keys.openrouterModel) === m.name)}
                  onSelect={() => { close(); pick("openrouter", { openrouterTier: undefined, openrouterModel: m.id }); }} />
              ))}
            </>
          )}
          {!hasOwn && server?.anthropic && (
            <>
              <MenuLabel>This app&apos;s Claude</MenuLabel>
              <MenuItem label={claudeName(server.model)} active onSelect={close} />
            </>
          )}
          {!hasOwn && !server?.anthropic && server?.openrouter && (
            <>
              <MenuLabel>Free models · limited each day</MenuLabel>
              {FREE.map((m) => (
                <MenuItem key={m.id} label={m.name} active={freeName(keys.sharedModel ?? server.openrouterModel) === m.name}
                  onSelect={() => { close(); save({ sharedModel: m.id }); }} />
              ))}
            </>
          )}
          {!hasOwn && !server?.anthropic && !server?.openrouter && (
            <p className="px-2.5 py-2 text-xs text-[var(--muted)]">No AI key yet: replies are simple and rule-based. Add a free key for the full assistant.</p>
          )}
          <MenuSep />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { close(); openSettings("api"); }}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left hover:bg-[var(--hover)]"
          >
            <Icon name="key" size={17} className="text-[var(--muted)]" />
            <span className="flex-1">{hasOwn ? "Keys and more models…" : "Add your own key…"}</span>
          </button>
        </>
      )}
    </Dropdown>
  );
}
