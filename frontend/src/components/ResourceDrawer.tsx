import { Resource, ResourceType, Topic } from "../types/roadmap";

/**
 * Right-side resource drawer. Opens for the selected topic, lists its
 * resources with a type icon + external link.
 *
 * Resource types are limited to the five from the spec:
 * bilibili / doc / book / course / project.
 */
const TYPE_STYLE: Record<
  ResourceType,
  { icon: string; label: string; bg: string; fg: string }
> = {
  bilibili: { icon: "B", label: "Bilibili", bg: "#ffecf5", fg: "#db2777" },
  doc: { icon: "文", label: "文档", bg: "#f0f9ff", fg: "#0369a1" },
  book: { icon: "书", label: "书籍", bg: "#fef9c3", fg: "#a16207" },
  course: { icon: "课", label: "课程", bg: "#f3e8ff", fg: "#7c3aed" },
  project: { icon: "码", label: "项目", bg: "#dcfce7", fg: "#15803d" },
};

function ResourceIcon({ type }: { type: ResourceType }) {
  const s = TYPE_STYLE[type];
  return (
    <span
      data-testid={`resource-type-${type}`}
      title={s.label}
      aria-label={s.label}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        borderRadius: 6,
        background: s.bg,
        color: s.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {s.icon}
    </span>
  );
}

function ResourceRow({ resource }: { resource: Resource }) {
  return (
    <li style={{ margin: 0, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ResourceIcon type={resource.type} />
        <div style={{ minWidth: 0 }}>
          <a
            href={resource.url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#111827",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            {resource.title}
          </a>
          {resource.note ? (
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              {resource.note}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

interface ResourceDrawerProps {
  /** Topic whose resources are shown; `null` keeps the drawer closed. */
  topic: Topic | null;
  onClose: () => void;
}

export default function ResourceDrawer({ topic, onClose }: ResourceDrawerProps) {
  if (!topic) return null;

  return (
    <aside
      data-testid="resource-drawer"
      role="dialog"
      aria-label={`资源面板：${topic.title}`}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        maxWidth: "90%",
        background: "#ffffff",
        borderLeft: "1px solid #e5e7eb",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
        padding: "16px 20px",
        boxSizing: "border-box",
        overflowY: "auto",
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>{topic.title}</h2>
        <button
          onClick={onClose}
          aria-label="关闭资源面板"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            color: "#6b7280",
          }}
        >
          ×
        </button>
      </div>

      <p style={{ fontSize: 13, color: "#4b5563", margin: "4px 0 12px" }}>
        {topic.description}
      </p>

      {topic.resources.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {topic.resources.map((r) => (
            <ResourceRow key={r.url} resource={r} />
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: 13, color: "#9ca3af" }}>暂无资源</p>
      )}
    </aside>
  );
}
