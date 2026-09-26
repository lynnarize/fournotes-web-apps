"use client";
// Bring your own API key. Keys live only in this browser, encrypted (sealed.ts): never
// in AppData, so they are never synced to Supabase or included in backups. They are sent to
// this app's own /api routes as headers on each AI request and used for that
// request only; the server never stores or logs them.
import { useEffect, useState } from "react";
import { isSealed, seal, unseal } from "./sealed";

export type SttProvider = "openai" | "groq";
export type AiProvider = "openrouter" | "opencode" | "anthropic";

export interface UserKeys {
  openrouterKey?: string; // free models, or paid ones billed to the user's credits
  openrouterModel?: string; // chosen free model
  openrouterTier?: "free" | "paid"; // unset = free
  openrouterPaidModel?: string; // any OpenRouter slug; kept while on free so switching back restores it
  openrouterPaidTextOnly?: boolean; // the paid model can't read photos
  opencodeKey?: string; // OpenCode Go subscription (Zen's free tier only works inside OpenCode itself)
  opencodeGoModel?: string;
  anthropicKey?: string;
  anthropicModel?: string; // chat, scans, recordings
  anthropicFastModel?: string; // daily brief, monthly review
  voyageKey?: string; // search by meaning
  sttKey?: string; // server-side transcription
  sttProvider?: SttProvider;
  aiProvider?: AiProvider; // which saved key AI requests use; unset = Claude, then OpenCode, then OpenRouter
  sharedModel?: string; // with no key of your own: which tested free model the app's shared OpenRouter key uses
}

export {
  ANTHROPIC_USER_MODELS as MODEL_OPTIONS, OPENCODE_GO_MODELS, OPENCODE_GO_URL, opencodeLabel,
  OPENROUTER_CREDITS_URL, OPENROUTER_FREE_MODELS, OPENROUTER_KEYS_URL,
} from "./ai/models";

const PROVIDER_KEY = { openrouter: "openrouterKey", opencode: "opencodeKey", anthropic: "anthropicKey" } as const;

/** The provider AI requests will use with these keys (mirrors resolveKeys on the server). */
export function activeProvider(k: UserKeys): AiProvider | null {
  if (k.aiProvider && k[PROVIDER_KEY[k.aiProvider]]) return k.aiProvider;
  return k.anthropicKey ? "anthropic" : k.opencodeKey ? "opencode" : k.openrouterKey ? "openrouter" : null;
}

const STORE = "four-notes:byok";
const EVT = "four-notes:byok-changed";

const clean = (k: UserKeys): UserKeys =>
  Object.fromEntries(Object.entries(k).map(([key, v]) => [key, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v)) as UserKeys;

// Keys are stored encrypted (see sealed.ts), so reading them is async. They are
// decrypted once into memory; getUserKeys() and keyHeaders() read that copy, and
// authHeaders() waits for it so a request made during startup still has the key.
type State = { keys: UserKeys; persist: boolean };
let state: State = { keys: {}, persist: true };
let loading: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();
let generation = 0; // bumped by every save and reload, so a slower, older load can't overwrite newer keys

const announce = () => window.dispatchEvent(new Event(EVT));

async function write(keys: UserKeys, persist: boolean) {
  const target = persist ? localStorage : sessionStorage;
  const other = persist ? sessionStorage : localStorage;
  if (!Object.keys(keys).length) {
    target.removeItem(STORE);
    other.removeItem(STORE);
    return;
  }
  const plain = JSON.stringify(keys);
  let value: string;
  try {
    value = JSON.stringify(await seal(plain));
  } catch {
    // No IndexedDB or WebCrypto here (e.g. some private windows): store as before rather than lose the keys.
    console.warn("[byok] this browser can't encrypt stored keys; saving them unencrypted");
    value = plain;
  }
  target.setItem(STORE, value);
  other.removeItem(STORE);
}

async function load(): Promise<State> {
  const session = sessionStorage.getItem(STORE);
  const raw = session ?? localStorage.getItem(STORE);
  const persist = session === null;
  if (!raw) return { keys: {}, persist: true };
  const parsed: unknown = JSON.parse(raw);
  if (isSealed(parsed)) {
    const plain = await unseal(parsed);
    if (plain === null) {
      // This browser's lock key is gone (site data partly cleared): the keys can't be recovered.
      (persist ? localStorage : sessionStorage).removeItem(STORE);
      return { keys: {}, persist };
    }
    return { keys: JSON.parse(plain) as UserKeys, persist };
  }
  // Saved before encryption: encrypt it now.
  const keys = clean(parsed as UserKeys);
  writing = writing.then(() => write(keys, persist)).catch(() => {});
  return { keys, persist };
}

function reload(): Promise<void> {
  const gen = ++generation;
  loading = load()
    .catch(() => ({ keys: {}, persist: true }))
    .then((s) => {
      if (gen !== generation) return;
      state = s;
      announce();
    });
  return loading;
}

/** Resolves once the stored keys are decrypted. */
export const keysReady = (): Promise<void> => (typeof window === "undefined" ? Promise.resolve() : (loading ??= reload()));

/** The decrypted keys (empty until keysReady() resolves). */
export const getUserKeys = (): UserKeys => {
  void keysReady();
  return state.keys;
};

/** persist=true keeps keys on this device; false forgets them when the tab closes. */
export function saveUserKeys(keys: UserKeys, persist: boolean) {
  const value = clean(keys);
  generation++;
  state = { keys: value, persist };
  loading = Promise.resolve(); // what's in memory is now the truth
  announce();
  writing = writing.then(() => write(value, persist)).catch(() => { /* storage blocked */ });
}

export const clearUserKeys = () => saveUserKeys({}, true);

/** Printable ASCII only (header-safe), no spaces. */
export const isValidKey = (v?: string) => !v || /^[\x21-\x7e]{16,400}$/.test(v.trim());

export function keyHeaders(keys: UserKeys = getUserKeys()): Record<string, string> {
  const k = clean(keys);
  const h: Record<string, string> = {};
  if (k.anthropicKey && isValidKey(k.anthropicKey)) {
    h["x-anthropic-key"] = k.anthropicKey;
    if (k.anthropicModel) h["x-anthropic-model"] = k.anthropicModel;
    if (k.anthropicFastModel) h["x-anthropic-fast-model"] = k.anthropicFastModel;
  }
  if (k.openrouterKey && isValidKey(k.openrouterKey)) {
    h["x-openrouter-key"] = k.openrouterKey;
    if (k.openrouterTier === "paid" && k.openrouterPaidModel) {
      h["x-openrouter-model"] = k.openrouterPaidModel;
      h["x-openrouter-vision"] = k.openrouterPaidTextOnly ? "0" : "1";
    } else if (k.openrouterModel) h["x-openrouter-model"] = k.openrouterModel;
  } else if (k.sharedModel) {
    // The shared key only accepts models from the tested free list (see resolveKeys), so this can't spend credits.
    h["x-openrouter-model"] = k.sharedModel;
  }
  if (k.opencodeKey && isValidKey(k.opencodeKey)) {
    h["x-opencode-key"] = k.opencodeKey;
    if (k.opencodeGoModel) h["x-opencode-model"] = k.opencodeGoModel;
  }
  if (k.aiProvider) h["x-ai-provider"] = k.aiProvider;
  if (k.voyageKey && isValidKey(k.voyageKey)) h["x-voyage-key"] = k.voyageKey;
  if (k.sttKey && isValidKey(k.sttKey)) {
    h["x-stt-key"] = k.sttKey;
    h["x-stt-provider"] = k.sttProvider ?? "openai";
  }
  return h;
}

/** Headers for an AI request, once the stored keys are decrypted. */
export async function authHeaders(): Promise<Record<string, string>> {
  await keysReady();
  return keyHeaders();
}

export function useUserKeys() {
  const [current, setCurrent] = useState<State>({ keys: {}, persist: true });
  useEffect(() => {
    const update = () => setCurrent(state);
    // Another tab saved keys: decrypt its version.
    const onStorage = (e: StorageEvent) => { if (e.key === STORE || e.key === null) void reload(); };
    update();
    void keysReady();
    window.addEventListener(EVT, update);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return current;
}

export const maskKey = (k?: string) => (!k ? "" : k.length > 16 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "••••••••");
