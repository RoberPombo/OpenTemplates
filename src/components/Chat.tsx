import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "../types";
import type { WorkspaceClient } from "../opencode";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  created: number;
};

type StreamPart = {
  id: string;
  text: string;
};

type Props = {
  client: WorkspaceClient;
  workspace: Workspace;
};

function toChatMessages(raw: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (item.type === "user") {
      messages.push({
        id: item.id,
        role: "user",
        text: item.text ?? "",
        tools: [],
        created: item.time?.created ?? 0,
      });
      continue;
    }
    if (item.type === "assistant") {
      const content: any[] = item.content ?? [];
      const text = content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n\n")
        .trim();
      const tools = [
        ...new Set(
          content
            .filter((part) => part.type === "tool")
            .map((part) => part.name as string)
            .filter(Boolean),
        ),
      ];
      if (!text && tools.length === 0) continue;
      messages.push({
        id: item.id,
        role: "assistant",
        text,
        tools,
        created: item.time?.created ?? 0,
      });
    }
  }
  return messages.sort((a, b) => a.created - b.created);
}

function errorText(error: unknown): string {
  if (!error) return "Error desconocido";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function Chat({ client, workspace }: Props) {
  const storageKey = `openconf:session:${workspace.id}`;
  const [sessionId, setSessionId] = useState<string | null>(() =>
    localStorage.getItem(storageKey),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamPart[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await client.message.list({
        sessionID: sessionId,
        limit: 200,
        order: "asc",
      });
      setMessages(toChatMessages(response.data as any[]));
    } catch (err) {
      localStorage.removeItem(storageKey);
      setSessionId(null);
      setMessages([]);
      setError(errorText(err));
    }
  }, [client, sessionId, storageKey]);

  useEffect(() => {
    setSessionId(localStorage.getItem(storageKey));
    setMessages([]);
    setStreaming([]);
    setError(null);
    setBusy(false);
  }, [storageKey]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    void reload();
  }, [sessionId, reload]);

  useEffect(() => {
    if (sessionId) return;
    let alive = true;
    (async () => {
      try {
        const session = await client.session.create({
          location: { directory: workspace.projectPath },
          title: `Chat · ${workspace.name}`,
        });
        if (!alive) return;
        setSessionId(session.id);
        localStorage.setItem(storageKey, session.id);
      } catch (err) {
        if (alive) setError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, sessionId, storageKey, workspace.name, workspace.projectPath]);

  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    (async () => {
      try {
        for await (const event of client.event.subscribe({
          signal: abort.signal,
        })) {
          if (!alive) break;
          const type = event.type;
          const data: any = (event as any).data ?? {};
          if (!sessionId || data.sessionID !== sessionId) continue;

          if (type === "session.text.started") {
            const id = data.assistantMessageID ?? "stream";
            setStreaming((prev) =>
              prev.some((part) => part.id === id)
                ? prev
                : [...prev, { id, text: "" }],
            );
          } else if (type === "session.text.delta") {
            const id = data.assistantMessageID ?? "stream";
            const delta = data.delta ?? "";
            setStreaming((prev) => {
              const index = prev.findIndex((part) => part.id === id);
              if (index === -1) return [...prev, { id, text: delta }];
              const next = prev.slice();
              next[index] = { ...next[index], text: next[index].text + delta };
              return next;
            });
          } else if (type === "session.execution.started") {
            setBusy(true);
          } else if (
            type === "session.idle" ||
            type === "session.execution.succeeded" ||
            type === "session.execution.interrupted"
          ) {
            setBusy(false);
            void reload().finally(() => setStreaming([]));
          } else if (type === "session.execution.failed") {
            setBusy(false);
            const message =
              data.error?.message ?? data.error?.name ?? "La ejecución falló";
            setError(message);
            void reload().finally(() => setStreaming([]));
          }
        }
      } catch (err) {
        if (alive && !abort.signal.aborted) {
          setError(errorText(err));
        }
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [client, sessionId, reload]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming, busy]);

  async function send() {
    const text = input.trim();
    if (!text || sending || busy || !sessionId) return;
    setSending(true);
    setError(null);
    setInput("");
    try {
      const id = sessionId;
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: "user",
          text,
          tools: [],
          created: Date.now(),
        },
      ]);
      setBusy(true);
      await client.session.prompt({ sessionID: id, text });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    try {
      await client.session.interrupt({ sessionID: sessionId });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function newConversation() {
    localStorage.removeItem(storageKey);
    setSessionId(null);
    setMessages([]);
    setStreaming([]);
    setError(null);
    setBusy(false);
  }

  const projectName = useMemo(
    () => workspace.projectPath.split("/").filter(Boolean).pop() ?? workspace.projectPath,
    [workspace.projectPath],
  );

  return (
    <section className="chat">
      <header className="chat-head">
        <div>
          <strong>Chat</strong>
          <span className="muted"> · {projectName}</span>
        </div>
        <button className="ghost small" onClick={newConversation} disabled={busy}>
          Nueva conversación
        </button>
      </header>

      <div className="messages">
        {messages.length === 0 && streaming.length === 0 && (
          <div className="empty-chat">
            <p>Escribe el primer mensaje de este workspace.</p>
            <p className="muted">
              MCPs y skills aplicados: {workspace.mcpNames.length} ·{" "}
              {workspace.skills.length}
            </p>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            {message.text && <p>{message.text}</p>}
            {message.tools.length > 0 && (
              <div className="tool-row">
                {message.tools.map((tool) => (
                  <span className="tool-chip" key={tool}>
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
        {streaming.map((part) => (
          <article key={`stream-${part.id}`} className="bubble assistant streaming">
            <p>{part.text || "…"}</p>
          </article>
        ))}
        {busy && streaming.length === 0 && (
          <article className="bubble assistant streaming">
            <p>Pensando…</p>
          </article>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="inline-error">{error}</div>}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          rows={2}
          placeholder={
            sessionId
              ? "Escribe un mensaje… (Enter para enviar)"
              : "Preparando sesión…"
          }
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="danger" onClick={() => void stop()}>
            Parar
          </button>
        ) : (
          <button
            type="submit"
            className="primary"
            disabled={sending || !input.trim() || !sessionId}
          >
            {sending ? "…" : "Enviar"}
          </button>
        )}
      </form>
    </section>
  );
}
