import { useCallback, useEffect, useRef, useState } from "react";

import { Topic } from "../types/roadmap";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

interface TutorDrawerProps {
  open: boolean;
  onClose: () => void;
  keyword: string;
  /** The topic the user is currently looking at; sent with each turn so the tutor can focus on it. */
  activeTopic: Topic | null;
}

const API_BASE = "/api/tutor";
const HISTORY_LIMIT = 10; // keep the last few turns to bound context

/**
 * Right-side drawer hosting the "agent teacher" chat.
 *
 * Each user message POSTs to /api/tutor/{keyword} with the recent
 * history; the response is an SSE stream of `delta` frames that are
 * appended to the in-progress assistant bubble, terminated by `done`.
 * The active topic is passed on every request so the coach can
 * ground its answer in what the user is currently reading.
 */
export function TutorDrawer({ open, onClose, keyword, activeTopic }: TutorDrawerProps) {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  // Keep the newest message visible.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const history = messages.slice(-HISTORY_LIMIT);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setDraft("");
      setBusy(true);
      setError(null);

      // Open a streaming placeholder the user can see fill in.
      const requestNo = ++requestRef.current;
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const appendDelta = (chunk: string) => {
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + chunk };
          }
          return next;
        });
      };

      try {
        const res = await fetch(
          `${API_BASE}/${encodeURIComponent(keyword)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: trimmed,
              active_topic_id: activeTopic?.id ?? null,
              history,
            }),
          },
        );
        if (!res.ok || !res.body) {
          throw new Error(`tutor request failed (${res.status})`);
        }

        // Parse the SSE byte stream manually (EventSource is GET-only).
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are double-newline separated.
          let sep;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            let event = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);
              if (event === "delta") {
                if (requestRef.current === requestNo) appendDelta(parsed.text ?? "");
              } else if (event === "done") {
                // `full` is authoritative; normalize the final bubble.
                setMessages((prev) => {
                  const next = prev.slice();
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant") {
                    next[next.length - 1] = {
                      ...last,
                      content: parsed.full || last.content,
                    };
                  }
                  return next;
                });
                break outer;
              } else if (event === "msg") {
                setError(parsed.error ?? "教师回答失败");
                break outer;
              }
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch (err) {
        if (requestRef.current === requestNo) {
          setError((err as Error).message || "教师回答失败");
          // Drop the empty placeholder bubble on hard failure.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        }
      } finally {
        if (requestRef.current === requestNo) setBusy(false);
      }
    },
    [busy, keyword, activeTopic, messages],
  );

  if (!open) return null;

  return (
    <aside
      data-testid="tutor-drawer"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 340,
        height: "100%",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        zIndex: 15,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#eef2ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          🎓
        </div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>AI 学习教练</div>
        <button
          data-testid="tutor-close"
          onClick={onClose}
          aria-label="关闭教练"
          style={{
            border: "none",
            background: "transparent",
            fontSize: 16,
            cursor: "pointer",
            color: "#6b7280",
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", marginTop: 20 }}>
            问教练任何关于这条路线的问题，
            <br />
            它会结合你正在看的主题辅导你。
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={i}
                data-testid="tutor-msg-user"
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "85%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  background: "#4f46e5",
                  color: "#fff",
                }}
              >
                {m.content || "…"}
              </div>
            ) : (
              <div
                key={i}
                data-testid="tutor-msg-assistant"
                style={{
                  alignSelf: "flex-start",
                  maxWidth: "85%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: "#f3f4f6",
                  color: "#1f2937",
                }}
              >
                {m.content ? (
                  <MarkdownRenderer content={m.content} />
                ) : (
                  <span>…</span>
                )}
              </div>
            ),
          )
        )}
        {error ? (
          <div
            style={{
              fontSize: 12,
              color: "#991b1b",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              padding: "6px 10px",
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <div style={{ padding: 12, borderTop: "1px solid #e5e7eb" }}>
        {activeTopic ? (
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
            正在围绕：{activeTopic.title}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            data-testid="tutor-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder="问点东西…"
            disabled={busy}
            style={{
              flex: 1,
              padding: "8px 10px",
              fontSize: 13,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              outline: "none",
            }}
          />
          <button
            data-testid="tutor-send"
            onClick={() => void send(draft)}
            disabled={busy || !draft.trim()}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              border: "none",
              borderRadius: 6,
              background: "#4f46e5",
              color: "#fff",
              cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
              opacity: busy || !draft.trim() ? 0.6 : 1,
            }}
          >
            发送
          </button>
        </div>
      </div>
    </aside>
  );
}

export default TutorDrawer;
