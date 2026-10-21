// Converts between a note's two forms:
//   content — plain text with light markdown ("☐ task", "• item", "# Heading"). Search,
//             the assistant, the daily brief and older notes all use this.
//   html    — rich text from the editor (TipTap). Only the editor reads it.
// Notes created by the assistant or by older versions only have `content`; the
// editor converts it on first open, and every edit writes both forms.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** **bold**, *italic* and [web links](https://…), the only inline markdown the assistant writes. */
const inline = (s: string) =>
  esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");

type Block = { kind: "ul" | "ol" | "task"; items: { text: string; checked?: boolean }[] };

export function plainToHtml(text: string): string {
  const out: string[] = [];
  let list: Block | null = null;
  const flush = () => {
    if (!list) return;
    if (list.kind === "task") {
      out.push(
        `<ul data-type="taskList">${list.items
          .map((i) => `<li data-type="taskItem" data-checked="${i.checked ? "true" : "false"}"><p>${inline(i.text)}</p></li>`)
          .join("")}</ul>`,
      );
    } else {
      out.push(`<${list.kind}>${list.items.map((i) => `<li><p>${inline(i.text)}</p></li>`).join("")}</${list.kind}>`);
    }
    list = null;
  };
  const add = (kind: Block["kind"], item: Block["items"][number]) => {
    if (list?.kind !== kind) flush();
    if (!list) list = { kind, items: [] };
    list.items.push(item);
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*(☐|☑|\[ \]|\[x\])\s*(.*)$/i))) add("task", { text: m[2], checked: m[1] === "☑" || /x/i.test(m[1]) });
    // A bare "-" or "1." is an empty list item (templates use them as blanks to fill in).
    else if ((m = line.match(/^\s*[-•*](?:\s+(.*))?$/)) && !/^\s*[-*]{2,}/.test(line)) add("ul", { text: m[1] ?? "" });
    else if ((m = line.match(/^\s*\d+[.)](?:\s+(.*))?$/))) add("ol", { text: m[1] ?? "" });
    else {
      flush();
      if (!line.trim()) continue;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      else if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) out.push("<hr>");
      else if ((m = line.match(/^>\s?(.*)$/))) out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`);
      else out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

// ---- Editor document (TipTap JSON) -> plain text -------------------------------------
export type DocNode = { type: string; text?: string; attrs?: Record<string, unknown>; content?: DocNode[] };

const inlineText = (n: DocNode): string =>
  n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(inlineText).join("");

function blockToLines(n: DocNode, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  const children = n.content ?? [];
  switch (n.type) {
    case "doc":
      return children.flatMap((c) => blockToLines(c, depth));
    case "paragraph":
      return [pad + inlineText(n)];
    case "heading":
      return [`${"#".repeat(Math.min(Number(n.attrs?.level) || 1, 3))} ${inlineText(n)}`];
    case "blockquote":
      return children.flatMap((c) => blockToLines(c, depth)).map((l) => `> ${l}`);
    case "horizontalRule":
      return ["---"];
    case "codeBlock":
      return inlineText(n).split("\n").map((l) => pad + l);
    case "bulletList":
    case "orderedList":
    case "taskList":
      return children.flatMap((item, i) => {
        const [first, ...rest] = item.content ?? [];
        const marker =
          n.type === "taskList" ? (item.attrs?.checked ? "☑ " : "☐ ") : n.type === "orderedList" ? `${i + 1}. ` : "• ";
        const head = first ? inlineText(first) : "";
        return [pad + marker + head, ...rest.flatMap((c) => blockToLines(c, depth + 1))];
      });
    default:
      return children.length ? children.flatMap((c) => blockToLines(c, depth)) : [];
  }
}

/** The plain-text form of an editor document, for search, the assistant and the brief. */
export function docToPlain(doc: DocNode): string {
  return blockToLines(doc)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The checklist items in a document, to keep linked to-dos in step when boxes are ticked. */
export function taskStates(doc: DocNode): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const walk = (n: DocNode) => {
    if (n.type === "taskItem") {
      const title = inlineText(n.content?.[0] ?? { type: "text", text: "" }).replace(/⏰/g, "").trim();
      if (title) out.set(title, Boolean(n.attrs?.checked));
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

/** A short preview line for the note list. */
export const snippet = (content: string, max = 140) =>
  content
    .replace(/^#+\s*/gm, "")
    .replace(/[☐☑•>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
