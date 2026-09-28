import { Handle, NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { Topic } from "../types/roadmap";

/**
 * Fixed-size card so hover states never shift the layout.
 * Exports the stable dimensions so RoadmapFlow can position nodes.
 */
export const TOPIC_NODE_WIDTH = 220;
export const TOPIC_NODE_HEIGHT = 116;

interface TopicNodeData {
  topic?: Topic;
  onTopicClick?: (topic: Topic) => void;
}

/**
 * Custom node card: title + one-line description + resource-count badge.
 * Clicking the card hands the full Topic (with resources) to onTopicClick.
 */
export const TopicNode = memo(function TopicNode(props: NodeProps<TopicNodeData>) {
  const topic = props.data?.topic;
  const onTopicClick = props.data?.onTopicClick;
  const selected = props.selected;

  // Data is optional in the v12 contract; guard instead of throwing.
  if (!topic) return null;
  const count = topic.resources.length;

  return (
    <div
      data-testid={`topic-node-${topic.id}`}
      data-topic-id={topic.id}
      style={{
        width: TOPIC_NODE_WIDTH,
        height: TOPIC_NODE_HEIGHT,
        boxSizing: "border-box",
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${selected ? "#4f46e5" : "#d1d5db"}`,
        borderLeft: "4px solid #4f46e5",
        background: "#ffffff",
        boxShadow: selected ? "0 0 0 2px rgba(79,70,229,0.25)" : "0 1px 2px rgba(0,0,0,0.08)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflow: "hidden",
      }}
      onClick={() => onTopicClick?.(topic)}
    >
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {topic.title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#4b5563",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {topic.description}
      </div>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            background: "#eef2ff",
            color: "#4f46e5",
            borderRadius: 999,
            padding: "1px 8px",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {count} 个资源
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>
          {topic.duration_hint}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

/**
 * Tail placeholder shown while a phase is still streaming in.
 * Fixed size matches TopicNode to prevent hover layout shift.
 */
export const LoadingNode = memo(function LoadingNode() {
  return (
    <div
      data-testid="roadmap-loading-node"
      style={{
        width: TOPIC_NODE_WIDTH,
        height: TOPIC_NODE_HEIGHT,
        boxSizing: "border-box",
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px dashed #c7d2fe",
        background: "#f9fafb",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontSize: 13,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid #c7d2fe",
          borderTopColor: "#4f46e5",
          animation: "roadmap-spin 0.8s linear infinite",
          display: "inline-block",
        }}
      />
      生成中…
    </div>
  );
});

// Spinner keyframe — injected once so it works without a global CSS file.
const styleTag = document?.createElement?.("style");
if (styleTag) {
  styleTag.textContent =
    "@keyframes roadmap-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(styleTag);
}
