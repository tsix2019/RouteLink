import { parseInline, parseMarkdown } from './markdown';

describe('chat markdown', () => {
  it('reads bold and inline code', () => {
    expect(parseInline('现在有 **13 台设备**在线，用 `logread` 看')).toEqual([
      { text: '现在有 ' },
      { text: '13 台设备', bold: true },
      { text: '在线，用 ' },
      { text: 'logread', code: true },
      { text: ' 看' },
    ]);
    expect(parseInline('a ** b')).toEqual([{ text: 'a ** b' }]);
  });

  it('splits paragraphs, headings, lists and code blocks', () => {
    const blocks = parseMarkdown(
      '## 状态\n第一段\n接着\n\n- 外网：正常\n- 设备：13 台\n1. 先这样\n2. 再那样\n```\nuci show\n```',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'code']);
    expect(blocks[1]).toEqual({ kind: 'paragraph', inline: [{ text: '第一段\n接着' }] });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: '外网：正常' }], [{ text: '设备：13 台' }]] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toEqual({ kind: 'code', text: 'uci show' });
  });

  it('keeps a code block that is still streaming', () => {
    expect(parseMarkdown('看这里：\n```\nifstatus wan')).toEqual([
      { kind: 'paragraph', inline: [{ text: '看这里：' }] },
      { kind: 'code', text: 'ifstatus wan' },
    ]);
  });
});
