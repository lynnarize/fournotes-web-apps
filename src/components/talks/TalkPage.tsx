"use client";
// One talk: the recording, who was in it (named by you or the conversation, each with a
// short profile), the write-up, and the transcript, where a time plays from that moment.
import { useEffect, useRef, useState } from "react";
import { downloadFile } from "@/lib/client";
import { openItem, openSettings } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { loadAudio, removeTalk, updateTalk } from "@/lib/talks/db";
import { retranscribe, serverEngine, summarize } from "@/lib/talks/recorder";
import { clock, speakersOf, talkNote, transcriptOf, transcriptText, turns } from "@/lib/talks/transcript";
import type { Talk } from "@/lib/types";
import { Dropdown, MenuItem, MenuSep } from "../notes/Dropdown";
import { Icon, useToast } from "../ui";

const ENGINE: Record<string, string> = {
  stt: "Transcribed with your speech-to-text key",
  audio: "Transcribed by an OpenRouter model",
  device: "Transcribed on this device by Chrome's model",
  browser: "Transcribed by your browser's live captions",
};

export default function TalkPage({ talk, onBack, onDeleted }: { talk: Talk; onBack?: () => void; onDeleted: () => void }) {
  const store = useStore();
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"summary" | "again" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const segments = transcriptOf(talk);
  const people = speakersOf(talk, segments);
  const lines = turns(talk, segments);
  const total = people.reduce((s, p) => s + p.seconds, 0) || 1;
  const note = talk.noteId ? store.notes.find((n) => n.id === talk.noteId && !n.deletedAt) : undefined;
  const pending = talk.chunks.filter((c) => c.status === "queued").length;
  const failed = talk.chunks.filter((c) => c.status === "failed").length;

  useEffect(() => {
    if (!talk.hasAudio) return;
    let url: string | null = null;
    void loadAudio(talk.id).then((b) => { if (b) setAudioUrl((url = URL.createObjectURL(b))); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [talk.id, talk.hasAudio]);

  const play = (at: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = at;
    void a.play();
  };

  const rename = (ids: string[], name: string) => {
    const clean = name.trim().slice(0, 60);
    updateTalk(talk.id, (t) => ({ names: { ...t.names, ...Object.fromEntries(ids.map((id) => [id, clean])) } }));
    setRenaming(null);
  };

  const saveToNotes = () => {
    const content = talkNote(talk);
    if (note) {
      store.updateNote(note.id, { content, html: undefined });
      toast("Updated the note with the latest transcript.", "ok", { label: "Open", run: () => openItem("note", note.id) });
      return;
    }
    const n = store.addNote({ title: talk.title, content, source: "recording", tags: ["talk"] });
    updateTalk(talk.id, { noteId: n.id });
    toast("📝 Saved to Notes", "ok", { label: "Open", run: () => openItem("note", n.id) });
  };

  const addTask = (title: string) => {
    store.addTodo({ title: title.replace(/^(you|me|saya)\s*:\s*/i, ""), noteId: talk.noteId ?? null, source: "recording" });
  };
  const addAllTasks = () => {
    const items = talk.summary?.actionItems ?? [];
    for (const a of items) addTask(a);
    toast(`✅ Added ${items.length === 1 ? "1 task" : `${items.length} tasks`} to To-Do`);
  };

  const writeSummary = async () => {
    setBusy("summary");
    try { await summarize(talk.id); } catch (e) { toast(e instanceof Error ? e.message : "Couldn't write it up right now.", "error"); } finally { setBusy(null); }
  };
  const again = async () => {
    const blob = await loadAudio(talk.id);
    if (!blob) return toast("The recording isn't kept in this browser any more.", "error");
    setBusy("again");
    try { await retranscribe(talk.id, blob); } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't transcribe it again.", "error", { label: "Add a key", run: () => openSettings("api", "stt") });
    } finally { setBusy(null); }
  };
  const del = () => {
    removeTalk(talk.id);
    onDeleted();
    toast("Talk deleted", "ok", { label: "Undo", run: () => updateTalk(talk.id, { deletedAt: null }) });
    onBack?.();
  };

  const meta = [
    new Date(talk.createdAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    clock(talk.duration),
    talk.mode === "call" ? talk.app ?? "Call" : talk.mode === "upload" ? "From a file" : "In person",
  ].join(" · ");

  return (
    <div className="note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 md:pl-5 md:pr-4">
        {onBack && (
          <button className="btn btn-plain h-11 gap-1 pl-2 pr-3 text-[var(--foreground)]" onClick={onBack} aria-label="Back to talks">
            <Icon name="chevronLeft" size={20} /> Talks
          </button>
        )}
        <span className="flex-1" />
        {note ? (
          <button className="btn btn-secondary max-md:h-11" onClick={() => openItem("note", note.id)}><Icon name="note" size={16} /> Open note</button>
        ) : (
          <button className="btn btn-secondary max-md:h-11" onClick={saveToNotes} disabled={!segments.length}><Icon name="noteAdd" size={16} /> Save to Notes</button>
        )}
        <Dropdown label="More actions" button={<Icon name="more" size={18} />} width={250} align="right" chevron={false} className="btn btn-plain btn-icon max-md:h-11 max-md:w-11">
          {(close) => (
            <>
              {note && <MenuItem icon="noteAdd" label="Update the note" onSelect={() => { close(); saveToNotes(); }} />}
              <MenuItem icon="copy" label="Copy transcript" onSelect={() => { close(); void navigator.clipboard.writeText(transcriptText(talk)).then(() => toast("Transcript copied")); }} />
              <MenuItem icon="download" label="Download transcript" onSelect={() => { close(); downloadFile(`${talk.title.replace(/[^\w\- ]+/g, "").trim() || "talk"}.txt`, `${talk.title}\n${meta}\n\n${transcriptText(talk)}\n`); }} />
              <MenuItem icon="sparkle" label={talk.summary ? "Write the summary again" : "Write a summary"} onSelect={() => { close(); void writeSummary(); }} />
              {talk.hasAudio && talk.status === "done" && (
                <MenuItem icon="repeat" label="Transcribe again" onSelect={() => { close(); void serverEngine().then((e) => (e ? again() : toast("Transcribing again needs a speech-to-text key.", "error", { label: "Add a key", run: () => openSettings("api", "stt") }))); }} />
              )}
              <MenuSep />
              <MenuItem icon="trash" label="Delete talk" danger onSelect={() => { close(); del(); }} />
            </>
          )}
        </Dropdown>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[clamp(16px,4vw,40px)] pb-12 pt-8 md:pt-10 max-md:pb-[calc(var(--tabbar-space)+64px)]">
        <article className="fn-note-in mx-auto flex w-full max-w-[680px] flex-col gap-7">
          <header className="flex flex-col gap-1">
            <textarea
              rows={1}
              value={talk.title}
              onChange={(e) => updateTalk(talk.id, { title: e.target.value.replace(/\n/g, " ") })}
              aria-label="Talk name"
              className="input-plain fn-display block w-full resize-none overflow-hidden text-[30px] [field-sizing:content] md:text-[36px]"
            />
            <p className="fn-num text-[13px] text-[var(--text-muted)]">{meta}</p>
          </header>

          {(talk.status !== "done" || busy === "again") && (
            <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
              <Icon name="sparkle" size={15} className="fn-dot text-[var(--accent)]" />
              {talk.status === "recording" ? "Recording…" : pending ? `Transcribing, ${pending === 1 ? "1 part" : `${pending} parts`} to go…` : "Writing it up…"}
            </p>
          )}
          {talk.problem && (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px]">
              <Icon name="info" size={15} className="shrink-0 text-[var(--warning)]" />
              <span className="min-w-0 flex-1 basis-60 text-[var(--text-secondary)]">
                {talk.problem}
                {failed > 0 && talk.live.length > 0 ? " Those parts come from your browser's live captions instead." : ""}
              </span>
              <button className="btn btn-secondary btn-sm max-md:h-11" onClick={() => openSettings("api", "stt")}>Add a key</button>
            </div>
          )}

          {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="w-full" aria-label="Recording" />}

          {people.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h2 className="group-label">People · tap a name to change it</h2>
              <ul className="flex flex-col gap-2">
                {people.map((p) => {
                  const profile = talk.summary?.people.find((x) => p.ids.includes(x.speaker))?.profile;
                  const share = Math.round((p.seconds / total) * 100);
                  return (
                    <li key={p.name} className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] px-3.5 py-3">
                      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-sm font-medium">{p.name[0]?.toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          {renaming === p.name ? (
                            <input
                              autoFocus
                              defaultValue={p.name === "You" ? "" : p.name}
                              placeholder={p.name}
                              aria-label={`Name for ${p.name}`}
                              // Typing replaces the name, rather than adding to it.
                              onFocus={(e) => e.target.select()}
                              onBlur={(e) => (e.target.value.trim() ? rename(p.ids, e.target.value) : setRenaming(null))}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }}
                              className="field h-8 w-48"
                            />
                          ) : (
                            <button className="font-medium hover:underline" onClick={() => setRenaming(p.name)} title="Change the name (the same name as another speaker merges them)">{p.name}</button>
                          )}
                          <span className="fn-num text-xs text-[var(--text-muted)]">{share}% of the talking · {p.lines} {p.lines === 1 ? "line" : "lines"}</span>
                        </div>
                        {profile && <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{profile}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {talk.summary ? (
            <section className="card flex flex-col gap-3 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-medium"><Icon name="sparkle" size={15} className="text-[var(--accent)]" /> Summary</h2>
              <p className="text-[15px] leading-relaxed">{talk.summary.text}</p>
              {talk.summary.keyPoints.length > 0 && (
                <div>
                  <h3 className="group-label mb-1">Key points</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">{talk.summary.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul>
                </div>
              )}
              {talk.summary.actionItems.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="group-label flex-1">Action items</h3>
                    <button className="btn btn-plain btn-sm h-7 px-2 text-xs" onClick={addAllTasks}><Icon name="plus" size={12} /> Add all to To-Do</button>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {talk.summary.actionItems.map((a) => (
                      <li key={a} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">☐ {a}</span>
                        <button className="btn btn-plain btn-sm h-7 shrink-0 px-2 text-xs" onClick={() => { addTask(a); toast(`✅ To-do: ${a}`); }} aria-label={`Add “${a}” to To-Do`}>
                          <Icon name="plus" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : (
            talk.status === "done" && segments.length > 0 && (
              <button className="btn btn-secondary self-start" onClick={writeSummary} disabled={busy === "summary"}>
                <Icon name="sparkle" size={15} className="text-[var(--accent)]" /> {busy === "summary" ? "Writing…" : "Write a summary"}
              </button>
            )
          )}

          <section className="flex flex-col gap-3">
            <h2 className="group-label">
              Transcript{talk.engine && talk.status === "done" ? ` · ${ENGINE[talk.engine]}` : ""}
            </h2>
            {lines.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{talk.status === "done" ? "Nothing was transcribed." : "Nothing yet."}</p>
            ) : (
              lines.map((l) => (
                <p key={`${l.start}-${l.speaker}`} className="text-[15px] leading-relaxed">
                  <button
                    className="fn-num mr-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] disabled:hover:text-[var(--text-muted)]"
                    onClick={() => play(l.start)}
                    disabled={!audioUrl}
                    title={audioUrl ? "Play from here" : undefined}
                  >
                    {clock(l.start)}
                  </button>
                  <span className="font-medium">{l.name}: </span>
                  {l.text}
                </p>
              ))
            )}
          </section>
        </article>
      </div>
    </div>
  );
}

