import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { DARK_THEME, LIGHT_THEME, terminalHtml, type TerminalKey, type TerminalMessage } from './html';

export interface TerminalHandle {
  /** Output of the shell, base64. */
  write(data: string): void;
  /** A line from the app itself, e.g. "[disconnected]". */
  print(text: string): void;
  /** A key of the key bar; xterm picks the sequence for the current cursor-key mode. */
  key(name: TerminalKey): void;
  /** Text as xterm pastes it (bracketed paste when the shell asks for it). */
  paste(text: string): void;
  /** Asks for the selection: it arrives through onCopy. */
  copy(): void;
  focus(): void;
  setFontSize(size: number): void;
}

interface Props {
  ref?: Ref<TerminalHandle>;
  dark: boolean;
  fontSize: number;
  onReady(size: { cols: number; rows: number }): void;
  onInput(data: string): void;
  onResize(size: { cols: number; rows: number }): void;
  onCopy(text: string): void;
  testID?: string;
}

/** xterm.js in a WebView (design §17), driven through the page's `window.rl`. */
export function TerminalView({ ref, dark, fontSize, onReady, onInput, onResize, onCopy, testID }: Props) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<string[]>([]);
  const output = useRef<string[]>([]);
  const flushing = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Built once: later font and colour changes go through window.rl instead of reloading the page.
  const [html] = useState(() => terminalHtml({ fontSize, theme: dark ? DARK_THEME : LIGHT_THEME }));

  const run = (js: string) => {
    if (ready.current) web.current?.injectJavaScript(`${js};true;`);
    else queue.current.push(js);
  };

  useImperativeHandle(ref, () => ({
    // Output comes in small pieces; one injection per frame keeps fast output (top, logread -f) smooth.
    write: (data) => {
      output.current.push(data);
      flushing.current ??= setTimeout(() => {
        flushing.current = null;
        const chunks = output.current.splice(0);
        run(`${JSON.stringify(chunks)}.forEach(rl.write)`);
      }, 16);
    },
    print: (text) => run(`rl.text(${JSON.stringify(text)})`),
    key: (name) => run(`rl.key(${JSON.stringify(name)})`),
    paste: (text) => run(`rl.paste(${JSON.stringify(text)})`),
    copy: () => run('rl.copy()'),
    focus: () => {
      web.current?.requestFocus();
      run('rl.focus()');
    },
    setFontSize: (size) => run(`rl.fontSize(${size})`),
  }));

  const theme = dark ? DARK_THEME : LIGHT_THEME;
  useEffect(() => {
    if (ready.current) web.current?.injectJavaScript(`rl.theme(${JSON.stringify(theme)});true;`);
  }, [theme]);
  useEffect(
    () => () => {
      if (flushing.current) clearTimeout(flushing.current);
    },
    [],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    let message: TerminalMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as TerminalMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'ready':
        ready.current = true;
        for (const js of queue.current.splice(0)) web.current?.injectJavaScript(`${js};true;`);
        onReady({ cols: message.cols, rows: message.rows });
        break;
      case 'input':
        onInput(message.data);
        break;
      case 'resize':
        onResize({ cols: message.cols, rows: message.rows });
        break;
      case 'copy':
        onCopy(message.text);
        break;
    }
  };

  return (
    <WebView
      ref={web}
      source={{ html }}
      originWhitelist={['*']}
      onMessage={onMessage}
      javaScriptEnabled
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      automaticallyAdjustContentInsets={false}
      setSupportMultipleWindows={false}
      style={[styles.web, { backgroundColor: theme.background }]}
      containerStyle={{ backgroundColor: theme.background }}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1 },
});
