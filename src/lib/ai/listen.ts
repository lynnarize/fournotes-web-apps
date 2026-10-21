// The request to a model that listens: transcribe a piece of a talk, telling voices apart.
// Shared by the server (OpenRouter's audio models) and the browser (Chrome's model).
export type Channel = "me" | "them" | "room";
export type Known = { id: string; sample: string };

export function listenPrompt(channel: Channel, lang: string, known: Known[]) {
  const who =
    channel === "me"
      ? "This is one person's microphone: label every line \"me\"."
      : "Different voices are different speakers: label them A, B, C in order of first appearance." +
        (known.length
          ? ` Earlier in the same conversation these speakers were heard: ${known.map((k) => `${k.id} said “${k.sample}”`).join("; ")}. ` +
            "Keep their letter if the same person speaks again; a new voice gets the next free letter."
          : "");
  return (
    `Transcribe this recording exactly, word for word, in the language spoken (expected: ${lang}). Don't translate or summarize. ${who} ` +
    "Reply with JSON only, no other text: {\"segments\":[{\"speaker\":\"A\",\"start\":0.0,\"end\":2.5,\"text\":\"...\"}]}, " +
    "start and end in seconds from the start of this recording. If nobody speaks, reply {\"segments\":[]}."
  );
}

/** The model's label, as the app's speaker id: "me", "them:A", or a letter in person. */
export function speakerId(channel: Channel, label: string) {
  if (channel === "me") return "me";
  const letter = label.trim().toUpperCase().match(/[A-Z]/)?.[0] ?? "A";
  return channel === "them" ? `them:${letter}` : letter;
}

/** Lines from the model, cleaned: times as numbers, speakers as ids, empty lines gone. */
export function readSegments(channel: Channel, raw: { speaker?: unknown; start?: unknown; end?: unknown; text?: unknown }[]) {
  return raw
    .map((s) => ({
      speaker: speakerId(channel, String(s.speaker ?? "")),
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(0, Number(s.end) || 0),
      text: String(s.text ?? "").trim(),
    }))
    .filter((s) => s.text);
}
