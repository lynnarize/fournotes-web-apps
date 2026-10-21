"use client";
// The composer's model picker, as other AI apps have it: which model answers, and a quick
// switch between the ones you can use — each provider you have a key for, or the tested
// free models on the app's shared key. Keys and paid models are managed in Settings.
// Also names models for the conversation: the line above a reply says which one wrote it.
import { useEffect, useState } from "react";
import { ANTHROPIC_USER_MODELS, OPENCODE_GO_MODELS, OPENROUTER_FREE_MODELS } from "@/lib/ai/models";
import { serverStatus, type ServerStatus } from "@/lib/aiRoute";
import { activeProvider, saveUserKeys, useUserKeys, type AiProvider, type UserKeys } from "@/lib/byok";
import { ON_DEVICE_MODEL, onDeviceInUse, useOnDevice } from "@/lib/ai/onDevice";
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

/** The model the composer will use: its short name, and a word for its tier ("Free", "Paid", "Go"). */
export type ModelChoice = { name: string; tier: string };

export function pickedModel(keys: UserKeys, server: ServerStatus | null): ModelChoice | null {
  const own = activeProvider(keys);
  const claude = (id?: string) => ({ name: "Claude", tier: claudeName(id).replace(/^Claude\s*/, "") });
  if (own === "anthropic") return claude(keys.anthropicModel ?? server?.model);
  if (own === "opencode") return { name: goName(keys.opencodeGoModel), tier: "Go" };
  if (own === "openrouter") {
    return keys.openrouterTier === "paid" && keys.openrouterPaidModel
      ? { name: slugName(keys.openrouterPaidModel), tier: "Paid" }
      : { name: freeName(keys.openrouterModel), tier: "Free" };
  }
  if (!server) return null;
  if (server.anthropic) return claude(server.model);
  if (server.openrouter) return { name: freeName(keys.sharedModel ?? server.openrouterModel), tier: "Free" };
  if (onDeviceInUse()) return { name: "On this device", tier: "" };
  return { name: "Demo mode", tier: "" };
}

/** "Claude Sonnet 5", "Ling 3.0": what the line above a reply calls the model. */
export const choiceName = (c: ModelChoice | null) => (!c ? "" : c.name === "Claude" ? `Claude ${c.tier}`.trim() : c.name);

/** The name for a model id a reply came back with (OpenRouter may have answered with a fallback). */
export function modelDisplayName(id: string) {
  if (id === ON_DEVICE_MODEL) return "On this device";
  if (ANTHROPIC_USER_MODELS.some((m) => m.id === id)) return claudeName(id);
  if (/^claude/i.test(id)) return "Claude";
  const free = OPENROUTER_FREE_MODELS.find((m) => m.id === id);
  if (free) return familyName(free.label);
  const go = OPENCODE_GO_MODELS.find((m) => m.id === id);
  if (go) return go.label;
  return slugName(id);
}

/** The model the composer will use, kept current as keys and choices change. */
export function useModelChoice() {
  const { keys } = useUserKeys();
  const [server, setServer] = useState<ServerStatus | null>(null);
  useEffect(() => { serverStatus().then(setServer); }, []);
  useOnDevice(); // re-picks once the on-device check is done
  return pickedModel(keys, server);
}

/** The small four-point mark that stands for "a model" next to its name. */
export function ModelMark({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`shrink-0 ${className}`}>
      <path fill="currentColor" d="M12 1.5l2.6 7.9L22.5 12l-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z" />
    </svg>
  );
}

const CHIP =
  "flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-[14px] text-[var(--foreground)] transition-colors hover:bg-[var(--hover)] sm:h-9 sm:w-auto sm:max-w-[15rem] sm:pl-3 sm:pr-2.5";

export default function ModelMenu() {
  const { keys, persist } = useUserKeys();
  const [server, setServer] = useState<ServerStatus | null>(null);
  useEffect(() => { serverStatus().then(setServer); }, []);
  const onDevice = useOnDevice();
  const own = activeProvider(keys);
  const save = (patch: Partial<UserKeys>) => saveUserKeys({ ...keys, ...patch }, persist);
  const pick = (provider: AiProvider, patch: Partial<UserKeys>) => save({ ...patch, aiProvider: provider });

  const choice = pickedModel(keys, server);
  if (!choice) return null;
  const orPaid = keys.openrouterTier === "paid" && keys.openrouterPaidModel;
  const hasOwn = Boolean(keys.anthropicKey || keys.opencodeKey || keys.openrouterKey);
  const on = (provider: AiProvider | null, active: boolean) => own === provider && active;

  return (
    <Dropdown
      label={`Model: ${choice.name}${choice.tier ? `, ${choice.tier}` : ""}`}
      title="Choose the model that answers"
      width={290}
      align="right"
      chevron={false}
      className={CHIP}
      button={
        <>
          <ModelMark size={14} />
          <span className="hidden min-w-0 truncate font-medium sm:inline">{choice.name}</span>
          {choice.tier && <span className="hidden shrink-0 text-[var(--text-muted)] sm:inline">{choice.tier}</span>}
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="hidden shrink-0 text-[var(--text-muted)] sm:block">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </>
      }
    >
      {(close) => (
        <>
          {keys.anthropicKey && (
            <>
              <MenuLabel>Claude, your key</MenuLabel>
              {ANTHROPIC_USER_MODELS.map((m) => (
                <MenuItem key={m.id} label={m.label} active={on("anthropic", (keys.anthropicModel ?? server?.model ?? "claude-sonnet-5") === m.id)}
                  onSelect={() => { close(); pick("anthropic", { anthropicModel: m.id }); }} />
              ))}
            </>
          )}
          {keys.opencodeKey && (
            <>
              <MenuLabel>OpenCode Go, your key</MenuLabel>
              {GO.map((m) => (
                <MenuItem key={m.id} label={m.name} active={on("opencode", goName(keys.opencodeGoModel) === m.name)}
                  onSelect={() => { close(); pick("opencode", { opencodeGoModel: m.id }); }} />
              ))}
            </>
          )}
          {keys.openrouterKey && (
            <>
              <MenuLabel>OpenRouter, your key</MenuLabel>
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
              <MenuLabel>Free models, limited each day</MenuLabel>
              {FREE.map((m) => (
                <MenuItem key={m.id} label={m.name} active={freeName(keys.sharedModel ?? server.openrouterModel) === m.name}
                  onSelect={() => { close(); save({ sharedModel: m.id }); }} />
              ))}
            </>
          )}
          {!hasOwn && !server?.anthropic && !server?.openrouter && (
            <p className="px-2.5 py-2 text-xs text-[var(--text-secondary)]">
              {onDevice.inUse
                ? "No AI key yet: Chrome's built-in model answers, on this device. Add a free key for a stronger model and photo reading."
                : "No AI key yet: replies are simple and rule-based. Add a free key for the full assistant."}
            </p>
          )}
          <MenuSep />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { close(); openSettings("api"); }}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left hover:bg-[var(--hover)]"
          >
            <Icon name="key" size={17} className="text-[var(--text-secondary)]" />
            <span className="flex-1">{hasOwn ? "Keys and more models…" : "Add your own key…"}</span>
          </button>
        </>
      )}
    </Dropdown>
  );
}
