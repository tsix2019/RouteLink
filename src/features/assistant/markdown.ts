/** The little Markdown chat answers use: paragraphs, headings, lists, quotes, tables, rules, code, bold and inline code. */

export type Inline = { text: string; bold?: boolean; code?: boolean };

export type MdBlock =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }
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
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
/** The line under a table's header: |---|:--:|. */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()));

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
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const header = cells(line);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]];
      for (let next = QUOTE.exec(lines[i + 1] ?? ''); next; next = QUOTE.exec(lines[i + 1] ?? '')) {
        body.push(next[1]);
        i++;
      }
      blocks.push({ kind: 'quote', inline: parseInline(body.join('\n')) });
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const previous = blocks[blocks.length - 1];
      const inline = parseInline(item[3]);
      if (previous?.kind === 'list' && previous.ordered === ordered) previous.items.push(inline);
      else blocks.push({ kind: 'list', ordered, start: ordered ? Number(item[2]) : 1, items: [inline] });
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
