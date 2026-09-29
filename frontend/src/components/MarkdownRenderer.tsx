import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import katex from "katex";
import "katex/dist/katex.min.css";

type Segment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string };

const DISPLAY_MATH = /\$\$([\s\S]+?)\$\$/g;

function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of content.matchAll(DISPLAY_MATH)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ kind: "text", value: content.slice(last, idx) });
    segments.push({ kind: "math", value: m[1].trim() });
    last = idx + m[0].length;
  }
  if (last < content.length) segments.push({ kind: "text", value: content.slice(last) });
  return segments;
}

function renderLatex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: true });
  } catch {
    return katex.renderToString("\\text{(" + tex + ")}", { throwOnError: false });
  }
}

function MathBlock({ tex }: { tex: string }) {
  const html = useMemo(() => renderLatex(tex), [tex]);
  return (
    <div
      data-testid="tutor-math"
      style={{ margin: "8px 0", padding: "4px 8px", overflowX: "auto", textAlign: "center" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  const segments = useMemo(() => splitSegments(content), [content]);
  return (
    <div data-testid="markdown-renderer">
      {segments.map((seg, i) =>
        seg.kind === "math" ? (
          <MathBlock key={i} tex={seg.value} />
        ) : seg.value.trim() ? (
          <MarkdownChunk key={i} text={seg.value} />
        ) : null,
      )}
    </div>
  );
}

function MarkdownChunk({ text }: { text: string }) {
  return (
    <div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "8px 0 4px" }}>{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: "6px 0 4px" }}>{children}</h4>
          ),
          p: ({ children }) => <p style={{ margin: "4px 0" }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: "2px 0" }}>{children}</li>,
          pre: ({ children }) => (
            <pre style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", overflowX: "auto", fontSize: 12, margin: "6px 0" }}>{children}</pre>
          ),
          code: ({ children }) => (
            <code style={{ background: "#f3f4f6", borderRadius: 3, padding: "1px 4px", fontSize: 12 }}>{children}</code>
          ),
          table: ({ children }) => (
            <table style={{ borderCollapse: "collapse", margin: "6px 0", fontSize: 12, width: "100%" }}>{children}</table>
          ),
          th: ({ children }) => (
            <th style={{ border: "1px solid #e5e7eb", padding: "4px 6px", background: "#f9fafb", textAlign: "left" }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>{children}</td>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: "#4f46e5", textDecoration: "underline" }}>{children}</a>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: "3px solid #e5e7eb", margin: "6px 0", padding: "2px 10px", color: "#6b7280" }}>{children}</blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
