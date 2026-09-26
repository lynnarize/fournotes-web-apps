import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ProviderError } from "./errors";
import type { KeySource } from "./keys";

/** Turn provider errors into messages a user can act on. Never includes the key. */
export function aiError(e: unknown, label: string, source: KeySource = "server") {
  const whose = source === "user" ? "Your Anthropic API key" : "The server's Anthropic API key";
  const fix = source === "user" ? " Check it in Settings → AI & API keys." : " Add your own key in Settings → AI & API keys.";
  let status = 500;
  let error = e instanceof Error ? e.message : "Something went wrong";

  if (e instanceof ProviderError) {
    // OpenRouter and other non-Anthropic providers already explain themselves.
    status = e.status;
    error = e.message;
  } else if (e instanceof Anthropic.AuthenticationError) {
    status = 401;
    error = `${whose} was rejected.${fix}`;
  } else if (e instanceof Anthropic.PermissionDeniedError) {
    status = 403;
    error = `${whose} doesn't have access to this model.${fix}`;
  } else if (e instanceof Anthropic.NotFoundError) {
    status = 404;
    error = "That model isn't available for this key. Pick another model in Settings → AI & API keys.";
  } else if (e instanceof Anthropic.RateLimitError) {
    status = 429;
    error = "Anthropic rate limit reached. Wait a moment and try again.";
  } else if (e instanceof Anthropic.APIConnectionError) {
    status = 502;
    error = "Couldn't reach Anthropic. Check the connection and try again.";
  } else if (e instanceof Anthropic.APIError) {
    status = e.status ?? 500;
  }

  console.error(`[${label}] ${status}`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error }, { status });
}
