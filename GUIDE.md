# Four Notes: Build Guide

This guide has three parts:
1. Suggested features — what's built and what's left
2. Choosing a backend for sync, with a plan for the native mobile and Mac apps
3. How to connect a cloud LLM, step by step

---

## What's built

| Feature | Where it lives |
|---|---|
| Split bills | `lib/insights.ts`, `components/SplitEditor.tsx` |
| Budgets per category | `components/BudgetEditor.tsx`, Finance → Set budget |
| Custom categories | `components/CategoryEditor.tsx`, `CategorySelect.tsx` |
| App / receipt notification parsing | `lib/wallet.ts` |
| Recurring tasks & bills | `lib/recurrence.ts` |
| Quick-add everywhere (`⌘K`, `/` commands, share target) | `components/CommandPalette.tsx`, `public/manifest.webmanifest` |
| Daily brief | `app/api/brief`, `components/TodayView.tsx` |
| Search by meaning | `lib/search.ts`, `app/api/embed` (Voyage key optional; BM25 without it) |
| Linked notes / tasks / spending | `lib/store.tsx` |
| Subscription detector | `lib/insights.ts` |
| Offline mode + PWA | `public/sw.js`, `components/PwaSetup.tsx` |
| Multi-currency | `lib/money.ts`, `app/api/fx` |
| Shared spaces | `lib/sync.ts`, `components/cloud.tsx` (needs Supabase) |
| Backup & sync to Google Drive | `lib/gdrive.ts`, `app/api/google/*` |
| Bring your own API key | `lib/byok.ts`, `components/ApiKeysSection.tsx` |
| Free AI by default (OpenRouter) | `lib/ai/openrouter.ts`, `lib/ai/keys.ts`, `lib/ai/shared.ts` |
| Dark / light / system theme | `lib/theme.ts`, `components/AppearanceSection.tsx` |
| First-run setup wizard | `components/Onboarding.tsx` |
| Export / print report | `components/ReportModal.tsx` |
| On-device AI (Chrome's built-in model, no key, works offline) | `lib/ai/onDevice.ts`, `components/OnDeviceRow.tsx` |
| Chat screenshots → plans and tasks | `kind: "chat"` in `lib/ai/tools.ts`, `captureToActions` in `lib/ai/provider.ts` |
| Stuck tasks (pushed back 3 times or a week overdue) | `lib/tasks.ts`, `components/StuckTasks.tsx` |
| Chores that take turns, fairly | `lib/tasks.ts` (`nextInRotation`), task panel → Turns |
| Notes kept current (re-checked on the web, Claude only) | `lib/keepCurrent.ts`, `app/api/ai/recheck` |
| Notes that disagree | `lib/conflicts.ts`, `components/notes/Conflicts.tsx` |
| People pages | `lib/people.ts`, `components/notes/People.tsx` |
| Interview mode (Ask AI → Interview me) | `components/notes/NoteEditor.tsx` |
| The app's own AI jobs, one shape for every provider | `lib/ai/agent.ts`, `app/api/ai/agent` |
| Transcribe: recording talks and calls, speakers, write-up | `lib/talks/*`, `components/TranscribeView.tsx`, `components/talks/TalkPage.tsx` |
| Transcription engines (speech-to-text key, OpenRouter audio) | `lib/ai/transcribe.ts`, `app/api/transcribe` |

Still open: location reminders and widgets (both native-only), tax/annual export, voice assistant mode, and smart reminder timing.

## First run and sample data

A new install creates **nothing** — no demo rows for the user to clean up. `seed()` in `src/lib/store.tsx` returns an empty app, and `localStorage["four-notes:onboarding"] = "pending"` triggers the wizard.

Everything demo-related is opt-in and reversible:

- `src/lib/sample.ts` builds the sample set (a note, three tasks, six transactions, a sticky, two budgets). Every row carries `sample: true`.
- `SampleDataButton` / `RemoveSamplesButton` in `src/components/SampleData.tsx` load and clear it. Clearing removes only tagged rows and only the budgets the sample added.
- `own()` in `src/lib/gdrive.ts` and the push filter in `src/components/cloud.tsx` strip sample rows, so **samples never reach Drive or Supabase**.
- Empty tabs show tappable example prompts (`components/EmptyStart.tsx`).

When adding a feature that writes rows, keep this rule: anything the app invents for teaching gets `sample: true`, so one click can take it back.

---

## 1. Suggested features

Grouped by how much they add for the effort needed.

### Quick wins
| Feature | Why it's worth it | How |
|---|---|---|
| **Split bills** | Common for group meals and trips | After a receipt is scanned, have the AI ask "split with who?" and store a `splits` table |
| **Budgets per category** | A monthly review is more useful with a target to compare against | Add a `budgets` table and show bars in Finance as "Rp 800k / Rp 1jt" |
| **E-wallet & bank notification parsing** | Most spending in Indonesia goes through GoPay, OVO, DANA, QRIS and bank apps | Let users paste or share a screenshot. The OCR route already accepts screenshots |
| **Recurring tasks & bills** | Rent, internet and subscriptions come back every month | Add an `rrule` field on todos (the same format calendars use) |
| **Quick-add everywhere** | People capture more when it takes one step | `/` slash commands in notes, plus a PWA share target so photos can be shared straight into the app |
| **Daily brief** | A reason to open the app every morning | Show today's tasks, yesterday's spending and pinned stickies, with a 3-line AI summary |

### Medium effort
- **Search that understands meaning ("where did I write about the Bali trip?")**: store embeddings in pgvector and let the AI search your own notes before it answers (this is called RAG).
- **Link notes, tasks and spending together**: a meeting note creates its tasks and each task links back to the note. A receipt can link to a note such as "Trip to Bandung".
- **Subscription detector**: the AI spots the same merchant charging a similar amount every month and flags it.
- **Smart reminder timing**: the AI suggests a reminder time based on when you usually finish similar tasks.
- **Offline mode + PWA**: install to the home screen, keep working without internet, and sync when back online.
- **Multi-currency**: add an `fx_rate` field on each transaction for when you travel.

### Bigger features for later
- **Shared spaces**: a household budget or a shared to-do list with a partner or team.
- **Location reminders** (native only): "remind me when I'm at Indomaret".
- **Tax / annual report export** to PDF or Excel.
- **Voice assistant mode**: talk to the app hands-free.
- **Widgets**: iOS and macOS home-screen widgets for stickies and today's tasks.

---

## 2. Backend for sync

### Recommendation: Supabase

You want a web app now and native iOS, Android and Mac apps later. That means one backend that every client talks to. **Supabase** fits this well:

| Need | Supabase gives you |
|---|---|
| Database | Postgres (see `supabase/schema.sql`) |
| Login | Email, Google and Apple sign-in. Apple sign-in is required for iOS apps that offer other social logins |
| Sync between devices | Realtime subscriptions on tables |
| Receipt images & audio | Storage buckets with per-user access rules |
| Server jobs (reminders, month-end) | Edge Functions + `pg_cron` |
| Semantic search | `pgvector` extension |
| SDKs | JavaScript, Swift, Kotlin, Flutter, so every future client is covered |

**Alternatives**

- **Firebase**: similar, with good offline support built in on mobile. It uses a NoSQL database, which makes monthly finance totals harder to query.
- **Your own backend** (Node/NestJS + Postgres + Prisma on Railway or Fly): the most control, but you build login, realtime and storage yourself.
- **Local-first sync** (PowerSync, ElectricSQL, Replicache): the best offline experience. Worth considering once the app is stable, and PowerSync works on top of Supabase.

### Target architecture

```
 ┌──────────── Clients ────────────┐
 │ Web (Next.js)  iOS/Android (Expo)│   Mac (Tauri / Catalyst / SwiftUI)
 └───────┬───────────────┬─────────┘
         │ supabase-js / supabase-swift (data, auth, realtime)
         ▼               ▼
 ┌──────────────── Supabase ───────────────┐
 │ Postgres + RLS │ Auth │ Storage │ Realtime│
 └──────┬──────────────────────────────────┘
        │ webhooks / pg_cron
        ▼
 ┌──────── AI API (Next.js /api or Edge Functions) ────────┐
 │  /chat  /ingest/image  /ingest/audio  /finance/summary  │  → Claude API, Whisper
 │  cron: reminders → push   month-end → summary           │  → Google Calendar API
 └─────────────────────────────────────────────────────────┘
```

**Key rule:** API keys for the AI services stay on the server. The mobile and Mac apps call your `/api/*` routes and send the user's Supabase login token. They never call Anthropic directly.

### Step-by-step migration from localStorage

1. Create a Supabase project, then run `supabase/schema.sql` in the SQL editor.
2. `npm i @supabase/supabase-js @supabase/ssr`
3. Add to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...   # server only (cron jobs)
   ```
4. Write a `supabaseAdapter` that has the same shape as `localAdapter` in `src/lib/store.tsx`:
   ```ts
   // src/lib/supabaseAdapter.ts
   import { createBrowserClient } from "@supabase/ssr";
   const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

   export async function pullChanges(since: string) {
     const [notes, todos, txs] = await Promise.all([
       sb.from("notes").select("*").gt("updated_at", since),
       sb.from("todos").select("*").gt("updated_at", since),
       sb.from("transactions").select("*").gt("updated_at", since),
     ]);
     return { notes: notes.data ?? [], todos: todos.data ?? [], transactions: txs.data ?? [] };
   }

   export async function pushNote(n: Note) {
     await sb.from("notes").upsert({ id: n.id, title: n.title, content: n.content, tags: n.tags,
       source: n.source, deleted_at: n.deletedAt, updated_at: n.updatedAt });
   }

   export function subscribe(onChange: () => void) {
     return sb.channel("sync")
       .on("postgres_changes", { event: "*", schema: "public" }, onChange)
       .subscribe();
   }
   ```
5. **How sync works.** Keep writing to the local store first so the UI stays instant. Queue each change and push it to Supabase in the background. On app start, and whenever realtime reports a change, pull rows with `updated_at > lastSyncedAt`. If two devices edit the same row, the newer `updated_at` wins. Deletions use `deleted_at` (a "soft delete") so the other devices learn that the row is gone. The base app already works this way.
6. **Images and audio.** Upload them to a Storage bucket at `receipts/{user_id}/{id}.jpg` and store only the path. Replace the `imageDataUrl` thumbnails with those paths.
7. **Move background jobs to the server** so they run while the app is closed:
   - **Reminders**: a `pg_cron` job runs every minute and calls an Edge Function. The function finds todos where `remind_at <= now()` and `reminded = false`, then sends a push notification (Web Push, APNs or FCM) using the `devices` table.
   - **Month-end review**: a cron job at `0 1 1 * *` (01:00 on the 1st of each month) loops over users, calls `monthlySummary`, and writes the result to `monthly_summaries`.

### Sync with Google Drive

The lightest option, and the one built in. Data is stored as a single JSON file in Drive's hidden **appDataFolder**: private to this app, invisible in the user's Drive, and it doesn't count against anything they manage. No database and no server to run.

1. In **Google Cloud Console**, create a project and configure the **OAuth consent screen** (External is fine; add yourself as a test user while it's unverified).
2. Enable the **Google Drive API**.
3. Create an **OAuth client ID** of type *Web application*, and add these **Authorized redirect URIs**:
   ```
   http://localhost:3000/api/google/callback
   https://your-site.netlify.app/api/google/callback
   ```
4. Put the credentials in `.env.local` (and in the Netlify UI for production):
   ```
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   # optional: separate secret for encrypting the session cookie
   GOOGLE_TOKEN_SECRET=...
   ```
5. The scope requested is `drive.appdata` plus basic profile, nothing else.

**How it works.** `/api/google/start` redirects to Google with `access_type=offline` and a CSRF `state` cookie. `/api/google/callback` exchanges the code and stores the refresh token in an **AES-256-GCM sealed, httpOnly cookie** — it never reaches the browser's JavaScript. `/api/google/token` mints short-lived access tokens from it. `runDriveSync()` in `src/lib/gdrive.ts` then checks whether the Drive file changed since this device last saw it, downloads and merges if so (newer `updatedAt` wins, deletions are tombstones), and uploads only when the merged result differs — a short FNV-1a signature skips no-op uploads.

This uses the OAuth redirect flow rather than the Google Identity Services button, because GIS `initCodeClient` has no `prompt` option and so can't guarantee a refresh token on every device.

### Google Calendar: full two-way sync

The base app uses a **template link** ("+ Google Calendar"), which needs no setup. For automatic sync:

1. In Google Cloud Console, create a project, enable the **Google Calendar API**, and set up the OAuth consent screen.
2. Sign users in with Supabase's Google provider and request the scope `https://www.googleapis.com/auth/calendar.events`. Save the `provider_refresh_token`.
3. On the server, when a todo with `due_at` is created or updated:
   ```ts
   import { google } from "googleapis";
   const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
   auth.setCredentials({ refresh_token });
   const cal = google.calendar({ version: "v3", auth });
   const ev = await cal.events.insert({
     calendarId: "primary",
     requestBody: {
       summary: todo.title,
       start: { dateTime: todo.due_at }, end: { dateTime: plus30min(todo.due_at) },
       reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
     },
   });
   // save ev.data.id into todos.google_event_id, and use events.patch / events.delete later
   ```
4. To show calendar events in the app, call `events.list` for today and this week. The AI can then use them too: "am I free Thursday afternoon?"
5. On iOS and Mac, use **EventKit** to access Apple Calendar directly.

### Native apps plan

| Option | Code sharing | Good for |
|---|---|---|
| **Expo (React Native)** for iOS + Android, and **Tauri** for the Mac app (wraps the web app) | Highest: TypeScript everywhere, reuse `types.ts`, the AI routes and most logic | **Recommended**, since you already know React |
| Expo for mobile + SwiftUI for Mac | Medium | Best-feeling Mac app |
| SwiftUI for iOS + Mac, Kotlin for Android | Low | Maximum native polish, three codebases |

Suggested repo layout once you start the mobile app (a monorepo managed with Turborepo):
```
apps/web      ← this Next.js app
apps/mobile   ← Expo app (expo-camera, expo-av, expo-notifications, expo-calendar)
apps/desktop  ← Tauri shell around apps/web
packages/core ← types.ts, sync logic, prompts, API client
```
Native-only features to plan for later: share extension (share a receipt from the Photos app), home-screen widgets, Siri/Shortcuts, and location reminders.

---

## 3. Connecting a cloud LLM

### 3.1 How it works

```
Browser ──(text / image / audio + small data context)──► /api/*  (your server, holds the API key)
                                                          │
                                                          ▼
                                             Claude Messages API
                                             (system prompt + tools)
                                                          │
                                   tool_use blocks (create_todo, add_transaction, …)
                                                          ▼
Browser ◄──────────────── { reply, actions[] } ───────────┘
   store.applyActions(actions)  →  item appears in the right tab
```

Three ideas cover most of it:
- **System prompt**: tells the model who it is, today's date and timezone, and the user's data (`systemPrompt()` in `src/lib/ai/provider.ts`).
- **Tools (function calling)**: JSON Schemas that describe the actions the model may take (`src/lib/ai/tools.ts`). The model returns structured `tool_use` blocks instead of free text, so the app can act on them reliably.
- **Forced tool use**: for OCR, `tool_choice: { type: "tool", name: "file_capture" }` makes the model **always** return the classification and extracted fields as JSON. This is what makes auto-sorting reliable.

### 3.2 Which provider answers

`resolveKeys()` in `src/lib/ai/keys.ts` picks the first available source, in this order:

1. **The user's own key**, sent per-request as `x-anthropic-key` / `x-openrouter-key`. Saved in their browser only — excluded from backups and from sync.
2. **`ANTHROPIC_API_KEY`** on the server — best quality.
3. **`OPENROUTER_API_KEY`** on the server — free models from the tested list, shared by all visitors. See "Free models" below.
4. **Demo mode** — rule-based replies in `src/lib/ai/demo.ts`, no OCR.

A shared server key is guarded by `src/lib/ai/shared.ts`: same-site requests only, free models unless `OPENROUTER_ALLOW_PAID=true`, and three daily caps (per IP, per signed-in account, per app). Free OpenRouter models allow roughly 20 requests/minute and 50/day, so keep `SHARED_AI_PER_IP_DAILY` small.

Never commit a key. Put it in `.env.local` locally and in the Netlify UI for production, and set a $0 credit limit on the OpenRouter key so a shared key can never bill you.

#### Free models

Free models differ a lot. Some call tools properly; others write *about* calling a tool ("we need to create_todo…") and nothing gets saved. So Settings only offers models that passed a real test, listed in `src/lib/ai/verified-models.json`.

To refresh the list (do it when a model stops working, or every few weeks):

```bash
npm run dev                                                # in one terminal
read -s OPENROUTER_API_KEY && export OPENROUTER_API_KEY    # in another; paste key, Enter
npm run probe:models                                       # or: -- --only a:free,b:free / --limit 6 / --dry
```

Every free model that claims tool support is sent the app's real prompts through `/api/ai/probe` (dev only, free models only, no fallbacks):

| Test | Pass when |
|---|---|
| chat | "remind me… umbrella… spent 45k on lunch" creates the to-do **and** a 45,000 transaction, with no planning text in the reply |
| capture | a meeting transcript becomes a note through the forced capture tool |
| vision | (photo-capable models) `scripts/probe-receipt.jpg` becomes a 128,500 transaction |

Passing models are written in order (consistent first, then photo-capable, then fastest); the first is the default. A wrong chat answer gets one retry: a model that only passes on retry is marked *inconsistent* and ranked lower. A model whose free provider is busy upstream (OpenRouter 429 with `limit_source: upstream…`, or "overloaded") is reported as **BUSY**, left as it is, and can be re-tested later with `--only`. With `--only`, models you didn't test keep their place. A free account allows about 50 requests a day and each model uses 2–4, so use `--limit` or `--only` if needed. Commit the updated JSON so the deployed app uses the same list.

At runtime, requests still recover on their own: OpenRouter's `models` fallback moves down the tested list and then to `openrouter/free` (with `provider.require_parameters`, so only tool-capable providers), `<think>` blocks are stripped, and a reply that describes a tool call is retried once with `tool_choice: "required"`. Planning text is never shown to the user.

The daily brief and monthly review ask for the answer inside `<answer>` tags with `reasoning.exclude`, then check it (`src/lib/ai/text.ts`): a brief must be three emoji lines, a review must be short and not read like reasoning. If a free model fails that, the app writes the data-only version from `src/lib/ai/local.ts` instead, and a thinking-style brief or review already saved on a device is regenerated automatically.

### 3.3 Get an Anthropic key

1. Go to **console.anthropic.com**, create an account, and add billing.
2. Open **API Keys** and create a key.
3. Put it in `.env.local` (this file is already git-ignored, so the key won't be committed):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-5
   ANTHROPIC_FAST_MODEL=claude-haiku-4-5
   ```
4. Run `npm run dev`. The "(demo mode)" text disappears from replies once the key is picked up.

Check the current model names at docs.claude.com → Models. Use the larger model for OCR and chat, and the fast one for cheap jobs such as the monthly summary.

### 3.4 The smallest possible call

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const res = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 500,
  system: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Halo! Apa kabar?" }],
});
console.log(res.content[0].type === "text" ? res.content[0].text : res.content);
```

### 3.5 Tool calling (how "remind me…" becomes a to-do)

```ts
const res = await client.messages.create({
  model, max_tokens: 1024, system, messages,
  tools: [{
    name: "create_todo",
    description: "Add a task. Convert relative dates to ISO 8601 with timezone.",
    input_schema: { type: "object", properties: {
      title: { type: "string" }, remindAt: { type: ["string", "null"] } }, required: ["title"] },
  }],
});

for (const block of res.content) {
  if (block.type === "tool_use") {
    // block.name === "create_todo", block.input = { title: "pay rent", remindAt: "2026-09-18T09:00:00+07:00" }
  }
}
// If stop_reason === "tool_use", send back a tool_result and call again so the model can finish its reply.
```
The full loop is in `src/lib/ai/anthropic.ts → chat()`.

### 3.6 Vision / OCR (receipt → Finance)

```ts
content: [
  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
  { type: "text", text: "Classify and extract, then call file_capture." },
]
```
Tips:
- Resize images to about 1600px on the longest side before uploading (`resizeImage()` does this). It saves tokens and loads faster.
- Ask for a **number only** for totals, and tell the model that "Rp 25.000" means 25000.
- Keep an "edit" option in the UI, because OCR will sometimes misread something.

### 3.7 Audio (recording → note)

The Claude API reads text and images, not audio. So the pipeline has two steps:
1. **Speech-to-text**: use any OpenAI-compatible Whisper endpoint (OpenAI, Groq and others) via `STT_BASE_URL` / `STT_API_KEY`, or the browser's built-in live transcription (the fallback already built in).
2. **Summarize** the transcript with Claude using the forced `file_capture` tool. You get a note plus a list of action items.

For long meetings (over roughly 30 minutes), split the audio into chunks, transcribe each one, then summarize the combined transcript.

### 3.8 Streaming (optional, feels faster)

```ts
const stream = client.messages.stream({ model, max_tokens, system, messages, tools });
stream.on("text", (delta) => writer.write(delta)); // pipe to the browser via ReadableStream
const final = await stream.finalMessage();          // then extract tool_use blocks
```

### 3.9 Switching or mixing providers

`LLMProvider` in `src/lib/ai/provider.ts` is the only thing the routes depend on. To add OpenAI or Gemini:
1. Create `src/lib/ai/openai.ts` that implements `chat`, `captureImage`, `summarizeRecording` and `monthlySummary`.
2. Change the tool format: OpenAI uses `{ type: "function", function: { name, description, parameters } }`, while Claude uses `{ name, description, input_schema }`. The JSON Schema inside stays the same.
3. Choose the provider in `getProvider()` with an env var such as `LLM_PROVIDER=openai`.

### 3.10 Production checklist

- [ ] **Auth on every `/api` route**: verify the Supabase JWT, and reject requests that don't have one.
- [ ] **Rate limit** per user (for example with Upstash Ratelimit) so nobody can run up your bill.
- [ ] **Limit context size**: send only recent or relevant items. Later, use pgvector search instead of sending everything.
- [ ] **Prompt caching**: mark the long, unchanging system prompt and tool definitions with `cache_control` to reduce cost and latency.
- [ ] **Validate AI output** with `zod` before writing to the database (amounts are numbers, dates are valid).
- [ ] **Log usage** (`res.usage.input_tokens` / `output_tokens`) per user to track costs.
- [ ] **Privacy**: tell users that receipts and recordings are sent to an AI provider, and let them delete their data.
- [ ] **Timeouts & retries**: the SDK retries automatically. Show a clear error in the chat when a request still fails.
