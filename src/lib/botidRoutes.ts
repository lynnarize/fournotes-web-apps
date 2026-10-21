// The routes Vercel BotID guards: the ones that spend the AI allowance.
// The browser (instrumentation-client.ts) attaches a challenge to these
// requests and each route checks it with blockBots() before doing any work.
// A route listed here must call blockBots(), and the other way round.
export const BOTID_ROUTES = [
  "/api/chat",
  "/api/brief",
  "/api/embed",
  "/api/finance/summary",
  "/api/ai/write",
  "/api/ai/web-ideas",
  "/api/ai/recheck",
  "/api/ai/agent",
  "/api/ingest/image",
  "/api/ingest/audio",
  "/api/transcribe",
].map((path) => ({ path, method: "POST" }));
