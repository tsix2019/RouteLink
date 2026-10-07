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

  it('reads tables, quotes and rules', () => {
    const blocks = parseMarkdown(
      '| 设备 | 信号 |\n|---|:--:|\n| iPhone | **-71 dBm** |\n| 电视 | -60 dBm |\n\n> 离路由器近一点\n> 会更稳定\n\n---\n3. 第三步',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['table', 'quote', 'rule', 'list']);
    expect(blocks[0]).toEqual({
      kind: 'table',
      header: [[{ text: '设备' }], [{ text: '信号' }]],
      rows: [
        [[{ text: 'iPhone' }], [{ text: '-71 dBm', bold: true }]],
        [[{ text: '电视' }], [{ text: '-60 dBm' }]],
      ],
    });
    expect(blocks[1]).toEqual({ kind: 'quote', inline: [{ text: '离路由器近一点\n会更稳定' }] });
    expect(blocks[3]).toMatchObject({ ordered: true, start: 3 });
  });

  it('leaves a lone pipe in a sentence alone', () => {
    expect(parseMarkdown('用 a | b 连接')).toEqual([{ kind: 'paragraph', inline: [{ text: '用 a | b 连接' }] }]);
  });

  it('keeps a code block that is still streaming', () => {
    expect(parseMarkdown('看这里：\n```\nifstatus wan')).toEqual([
      { kind: 'paragraph', inline: [{ text: '看这里：' }] },
      { kind: 'code', text: 'ifstatus wan' },
    ]);
  });
});
