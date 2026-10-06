/** The little Markdown chat answers use: paragraphs, headings, lists, code blocks, bold and inline code. */

export type Inline = { text: string; bold?: boolean; code?: boolean };

export type MdBlock =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string };

/** **bold** and `code`; anything unmatched stays plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const LIST = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', inline: parseInline(heading[1]) });
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const previous = blocks[blocks.length - 1];
      const inline = parseInline(item[3]);
      if (previous?.kind === 'list' && previous.ordered === ordered) previous.items.push(inline);
      else blocks.push({ kind: 'list', ordered, items: [inline] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
