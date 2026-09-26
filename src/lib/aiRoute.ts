"use client";
// Who answers the assistant, as a short label for the composer ("Your Anthropic key",
// "OpenRouter · free", "Demo mode"), and whether web search is on offer (Claude only).
// Mirrors the order the server uses (src/lib/ai/keys.ts): the user's key, then the server's.
import { useEffect, useState } from "react";
import { activeProvider, useUserKeys } from "./byok";

export type ServerStatus = { anthropic?: boolean; openrouter?: boolean; model?: string; openrouterModel?: string };
type Status = ServerStatus;
let status: Promise<Status> | null = null;
export const serverStatus = () => (status ??= fetch("/api/ai/status").then((r) => r.json()).catch(() => ({})));

export function useAiRoute() {
  const { keys } = useUserKeys();
  const [server, setServer] = useState<Status | null>(null);
  useEffect(() => { serverStatus().then(setServer); }, []);
  const own = activeProvider(keys);
  if (own === "anthropic") return { label: "Your Anthropic key", canSearchWeb: true };
  if (own === "opencode") return { label: "Your OpenCode Go key", canSearchWeb: false };
  if (own === "openrouter") return { label: "Your OpenRouter key", canSearchWeb: false };
  if (!server) return { label: "", canSearchWeb: false };
  if (server.anthropic) return { label: "Claude", canSearchWeb: true };
  if (server.openrouter) return { label: "OpenRouter · free", canSearchWeb: false };
  return { label: "Demo mode", canSearchWeb: false };
}
