# Four Notes

Notes, To-Do and Finance in one app, with an AI assistant that files things for you.

Built with Next.js, React and Tailwind v4. It runs with no API keys at all, and gets smarter as you add them.

## What it does

**Capture**
- **Scan anything** — photograph a receipt, handwriting or a checklist and the assistant decides where it belongs: Finance, Notes or To-Do. On phones, Scan asks whether to use the camera or pick a file.
- **App / receipt notification** — paste a payment notification from GoPay, OVO, DANA, QRIS or a bank app and it becomes a transaction.
- **Voice → note** — record a meeting and get a summary, key points and action items, with the action items turned into to-dos.
- **Quick-add everywhere** — `⌘K` / `Ctrl+K` to search or add, `/` commands inside notes, and a PWA share target so you can share a photo straight into the app.

**Organise**
- Four tabs: **Today** (daily brief, due tasks, yesterday's spending), **Notes**, **To-Do** and **Finance**.
- Sticky notes pinned along the top.
- Notes, tasks and transactions link to each other — a meeting note keeps its tasks, a receipt can belong to a trip note.
- Recurring tasks and bills, reminders, and one-tap export to Google Calendar, Apple Calendar or Outlook.

**Money**
- Budgets per category with progress bars, and custom categories you define yourself.
- Split bills — record who owes what and mark them settled.
- Subscription detector — spots the same merchant charging a similar amount each month.
- Multi-currency with automatic exchange rates.
- A monthly review written for you when the month turns over.

**Everywhere**
- Themes: System, Light, Paper (warm paper, ink-brown text) and Dark.
- Installable PWA that works offline and syncs when you're back online.
- Optional backup and sync to your own **Google Drive**, or to **Supabase** with shared spaces for a household budget.

## First run

The app starts **completely empty** — no demo rows to delete. Instead:

- A skippable setup wizard covers theme, AI key, backup and budgets.
- Each empty tab shows example prompts you can tap, so your first item is a real one.
- **"Explore with sample data"** (in the wizard, any empty state, or Settings → Data & privacy) loads a realistic set — a trip note, three tasks, six transactions including a split bill and two months of Netflix, and two budgets.
- Sample rows are tagged, so **Remove** deletes exactly those and nothing you made. They are never uploaded to Drive or Supabase.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3000. Microphone and camera need `localhost` or HTTPS.

## AI: pick as much or as little as you want

The app works without any key. When a request comes in, the first available option wins:

| Order | Source | What you get |
|---|---|---|
| 1 | **User's own key** (Settings → API keys) | Their key, their allowance. Stored only in their browser, never synced or backed up |
| 2 | **`ANTHROPIC_API_KEY`** on the server | Best quality — chat, OCR, summaries |
| 3 | **`OPENROUTER_API_KEY`** on the server | Free models from a tested list (`npm run probe:models`). Shared across visitors, so it's rate-limited (see below) |
| 4 | Nothing set | **Demo mode**: rule-based replies, no OCR. Everything else still works |

**If you put a shared key on the server**, the guards in `src/lib/ai/shared.ts` keep it from costing you money or being abused.

Every option is documented in `.env.example`. Keys live on the server or in the user's browser — never in the bundle, never in a backup, never in sync.

## Project layout

```
src/
  app/
    page.tsx                  App shell: sidebar, sticky bar, views, chat dock
    api/chat                  Chat + tool calling → actions (create todo, add expense…)
    api/ingest/image          OCR + classify + extract (receipt / note / todo list)
    api/ingest/audio          Speech-to-text → summarised note
    api/brief                 Daily brief for the Today tab
    api/finance/summary       Monthly spending review
    api/google/*              OAuth start, callback, token refresh, disconnect
    api/ai/status             Which provider is live (no secrets in the response)
    api/embed, api/fx         Embeddings for search; exchange rates
  lib/
    types.ts                  Shared data model
    store.tsx                 State, persistence, sample data, merge logic
    sample.ts                 The opt-in sample set
    byok.ts                   User-supplied keys (browser only)
    gdrive.ts                 Google Drive appDataFolder sync + merge
    sync.ts                   Supabase sync and shared spaces
    insights.ts               Budgets, subscriptions, split bills
    ai/keys.ts                Provider precedence
    ai/shared.ts              Abuse guards for the shared key
    ai/anthropic.ts           Claude
    ai/openrouter.ts          OpenRouter (free models)
    ai/demo.ts                Offline rule-based fallback
    ai/tools.ts               Tool (function) schemas
    ai/validate.ts            zod validation of every AI action
  components/                 Views, chat dock, settings, onboarding, sync panels
supabase/schema.sql           Database schema for cloud sync
GUIDE.md                      Setup guides, architecture and roadmap
```

## Privacy

Data lives in your browser unless you turn on sync. Google Drive sync uses the hidden **appDataFolder**, so it is private to this app and invisible in your Drive. Receipt thumbnails stay on the device. Photos and recordings are sent to whichever AI provider is configured, and Settings → Data & privacy lets you export everything or delete it.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.
