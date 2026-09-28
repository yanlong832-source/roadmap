import {
  ReactFlow,
  ReactFlowProvider,
  ReactFlowJsonObject,
  Controls,
  MiniMap,
} from "@xyflow/react";
import { useMemo } from "react";
import "@xyflow/react/dist/style.css";

import { Phase, Topic } from "../types/roadmap";
import {
  LoadingNode,
  TopicNode,
  TOPIC_NODE_WIDTH,
  TOPIC_NODE_HEIGHT,
} from "./TopicNode";

/**
 * A phase as it exists mid-generation: `topics` may be empty or only
 * partially filled while the LLM streams the stage.
 */
export type PartialPhase = Omit<Phase, "topics"> & { topics: Partial<Topic>[] };

export interface RoadmapFlowProps {
  /** Generated phases, in order. May be empty while the first phase is in flight. */
  phases: PartialPhase[];
  /**
   * True while the roadmap is still generating. While true, a loading
   * placeholder is appended to the tail of the in-progress (last) phase.
   */
  generating: boolean;
  /** Called with the full topic object (incl. resources) when a card is clicked. */
  onTopicClick: (topic: Topic) => void;
}

/* ---- layout constants (fixed node size prevents hover jitter) ---- */

const PHASE_GAP = 120; // vertical gap between phase rows
const TOPIC_GAP = 60; // horizontal gap between sibling topics
const ROW_HEIGHT = TOPIC_NODE_HEIGHT + PHASE_GAP;

const NODE_TYPES = {
  topic: TopicNode,
  loading: LoadingNode,
};

function loadingPlaceholderNode(
  key: string,
  position: { x: number; y: number },
) {
  return {
    id: key,
    type: "loading",
    position,
    data: {},
  } as unknown as ReactFlowJsonObject;
}

function topicNode(
  id: string,
  position: { x: number; y: number },
  topic: Topic,
  onTopicClick: (topic: Topic) => void,
) {
  return {
    id,
    type: "topic",
    position,
    data: { topic, onTopicClick },
  } as unknown as ReactFlowJsonObject;
}

/**
 * Vertical layered React Flow layout.
 *
 * - phase i row: y = i * ROW_HEIGHT (never shifts when later phases stream in)
 * - topics within a phase: x evenly distributed starting at x = 0
 * - links: sibling topics chain left-to-right (prereq -> successor) and the
 *   last topic of a phase links down to the first topic of the next phase
 * - `generating` appends a single loading placeholder to the tail of the
 *   last (in-progress) phase
 * - minimap + controls enabled
 */
export function RoadmapFlow({ phases, generating, onTopicClick }: RoadmapFlowProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: ReactFlowJsonObject[] = [];
    const edges: ReactFlowJsonObject[] = [];

    let prevPhaseTail: string | null = null;

    phases.forEach((phase, i) => {
      const rowY = i * ROW_HEIGHT;
      const count = phase.topics.length;

      // Evenly distribute topics horizontally within the row.
      // With `n` topics: x_k = k * (TOPIC_NODE_WIDTH + TOPIC_GAP)
      phase.topics.forEach((t, k) => {
        const topic = t as Topic;
        nodes.push(
          topicNode(
            topic.id,
            { x: k * (TOPIC_NODE_WIDTH + TOPIC_GAP), y: rowY },
            topic,
            onTopicClick,
          ),
        );

        // Within-phase chain: link previous topic to this one.
        if (k > 0) {
          const prev = phase.topics[k - 1] as Topic;
          edges.push({
            id: `${prev.id}->${topic.id}`,
            source: prev.id,
            target: topic.id,
            type: "smooth",
            animated: false,
            markerEnd: "arrowclosed",
          } as unknown as ReactFlowJsonObject);
        }
      });

      // Cross-phase link: tail of previous phase -> head of this phase.
      if (prevPhaseTail && count > 0) {
        const head = phase.topics[0] as Topic;
        edges.push({
          id: `${prevPhaseTail}->${head.id}`,
          source: prevPhaseTail,
          target: head.id,
          type: "smooth",
          animated: false,
          markerEnd: "arrowclosed",
        } as unknown as ReactFlowJsonObject);
      }

      if (count > 0) {
        prevPhaseTail = (phase.topics[count - 1] as Topic).id;
      }
    });

    // Loading placeholder: tail of the last in-progress phase while generating.
    // If no phase yet, placeholder sits on row 0.
    if (generating) {
      const lastPhase = phases[phases.length - 1];
      const rowCount = lastPhase ? lastPhase.topics.length : 0;
      const rowY = lastPhase
        ? (phases.length - 1) * ROW_HEIGHT
        : 0;
      const x = rowCount * (TOPIC_NODE_WIDTH + TOPIC_GAP);
      const key = `loading-${lastPhase?.id ?? "head"}`;
      nodes.push(loadingPlaceholderNode(key, { x, y: rowY }) as never);

      // Link the last real topic (or nothing) to the placeholder.
      const source =
        lastPhase && lastPhase.topics.length > 0
          ? (lastPhase.topics[lastPhase.topics.length - 1] as Topic).id
          : null;
      if (source) {
        edges.push({
          id: `${source}->${key}`,
          source,
          target: key,
          type: "smooth",
          animated: false,
          markerEnd: "arrowclosed",
        } as unknown as ReactFlowJsonObject);
      }
    }

    return { nodes, edges };
  }, [phases, generating, onTopicClick]);

  return (
    <ReactFlowProvider>
      <div
        data-testid="roadmap-flow"
        style={{ width: "100%", height: "100%", position: "relative" }}
      >
        <ReactFlow
          nodes={nodes as never}
          edges={edges as never}
          nodeTypes={NODE_TYPES}
          onlyRenderVisibleElements={false}
          fitView
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          style={{ width: "100%", height: "100%" }}
        >
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
