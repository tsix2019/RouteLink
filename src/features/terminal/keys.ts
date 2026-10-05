const CONTROL: Record<string, string> = {
  ' ': '\x00',
  '@': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  _: '\x1f',
  '?': '\x7f',
};

/** What the latched Ctrl key of the key bar does to the next typed character. */
export function withCtrl(data: string): string {
  if (!data) return data;
  const first = data[0];
  const rest = data.slice(1);
  if (/[a-z]/i.test(first)) return String.fromCharCode(first.toUpperCase().charCodeAt(0) & 0x1f) + rest;
  return (CONTROL[first] ?? first) + rest;
}
