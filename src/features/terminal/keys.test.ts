import { withCtrl } from './keys';

describe('withCtrl', () => {
  it('turns letters and the usual symbols into control characters', () => {
    expect(withCtrl('c')).toBe('\x03');
    expect(withCtrl('C')).toBe('\x03');
    expect(withCtrl('d')).toBe('\x04');
    expect(withCtrl('z')).toBe('\x1a');
    expect(withCtrl('[')).toBe('\x1b');
    expect(withCtrl(' ')).toBe('\x00');
    expect(withCtrl('?')).toBe('\x7f');
  });

  it('leaves what has no control form alone', () => {
    expect(withCtrl('1')).toBe('1');
    expect(withCtrl('é')).toBe('é');
    // A whole word (pasted, or autocorrect): only its first character takes Ctrl.
    expect(withCtrl('ls')).toBe('\x0cs');
    expect(withCtrl('')).toBe('');
  });
});
