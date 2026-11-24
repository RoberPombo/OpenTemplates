/** Una pestaña de terminal: monta xterm, vuelca el buffer y reenvía entrada. */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
  tabId: string;
  getBuffer: (id: string) => string;
  subscribe: (id: string, listener: (text: string) => void) => () => void;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, size: { cols: number; rows: number }) => void;
};

const RESIZE_DEBOUNCE_MS = 140;

export function TerminalPane({ tabId, getBuffer, subscribe, onInput, onResize }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: "#0b0e12",
        foreground: "#e7edf4",
        cursor: "#3ddc97",
        selectionBackground: "#26463a",
        black: "#0b0e12",
        red: "#ff6b6b",
        green: "#3ddc97",
        yellow: "#f5c451",
        blue: "#6aa8ff",
        magenta: "#c792ea",
        cyan: "#5ad4e6",
        white: "#e7edf4",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let disposed = false;
    let timer = 0;

    const applyFit = () => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (terminal.cols > 0 && terminal.rows > 0) {
        onResize(tabId, { cols: terminal.cols, rows: terminal.rows });
      }
    };

    const scheduleFit = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(applyFit, RESIZE_DEBOUNCE_MS);
    };

    const unsubscribe = subscribe(tabId, (chunk) => terminal.write(chunk));
    terminal.write(getBuffer(tabId));
    const input = terminal.onData((data) => onInput(tabId, data));
    const first = window.setTimeout(applyFit, 0);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleFit());
    observer?.observe(element);
    window.addEventListener("resize", scheduleFit);
    terminal.focus();

    return () => {
      disposed = true;
      unsubscribe();
      input.dispose();
      observer?.disconnect();
      window.removeEventListener("resize", scheduleFit);
      window.clearTimeout(timer);
      window.clearTimeout(first);
      terminal.dispose();
    };
  }, [getBuffer, onInput, onResize, subscribe, tabId]);

  return <div className="terminal-pane" ref={container} />;
}
