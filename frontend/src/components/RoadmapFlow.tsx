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
import { LoadingNode, TopicNode, TOPIC_NODE_HEIGHT } from "./TopicNode";
import { PhaseCardNode, PHASE_CARD_WIDTH, PHASE_CARD_HEIGHT } from "./PhaseCard";

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

/* ---- layout constants (fixed node sizes prevent hover jitter) ---- */

const PHASE_GAP = 130; // vertical gap between phase blocks
const PHASE_TO_TOPICS_GAP = 90; // horizontal gap between a block and its topics
const TOPIC_GAP = 56; // vertical gap between sibling topics inside one phase
const ROW_HEIGHT = TOPIC_NODE_HEIGHT + PHASE_GAP;
const BLOCK_X = 0; // phase block column
const TOPICS_X = BLOCK_X + PHASE_CARD_WIDTH + PHASE_TO_TOPICS_GAP;

const NODE_TYPES = {
  topic: TopicNode,
  loading: LoadingNode,
  phaseCard: PhaseCardNode,
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

function phaseCardNode(
  id: string,
  position: { x: number; y: number },
  phase: PartialPhase,
) {
  return {
    id,
    type: "phaseCard",
    position,
    data: { phase, topicCount: phase.topics.length },
  } as unknown as ReactFlowJsonObject;
}

function topicStackTopY(blockRowY: number, count: number): number {
  // Vertically center the topic stack against the block card's center.
  const stackHeight =
    count * TOPIC_NODE_HEIGHT + Math.max(count - 1, 0) * TOPIC_GAP;
  const centered = blockRowY + PHASE_CARD_HEIGHT / 2 - stackHeight / 2;
  return Math.max(0, centered);
}

/**
 * Vertical layered layout, "directory + details" style:
 *
 * - phase i block: x = BLOCK_X, y = i * ROW_HEIGHT
 * - phase i topics: x = TOPICS_X, stacked vertically and centered
 *   against the block so the block reads as a directory spine
 * - each block fans out to its topics with **dashed** edges
 *   (block ->. topic); the progress chain between blocks stays solid
 *   (block i -> block i+1)
 * - `generating` appends a single loading placeholder to the tail of the
 *   last in-progress phase's topic column, dashed-linked from the block
 * - minimap + controls enabled
 */
export function RoadmapFlow({ phases, generating, onTopicClick }: RoadmapFlowProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: ReactFlowJsonObject[] = [];
    const edges: ReactFlowJsonObject[] = [];

    let prevBlockId: string | null = null;

    phases.forEach((phase, i) => {
      const blockY = i * ROW_HEIGHT;
      const count = phase.topics.length;
      const firstTopicY = topicStackTopY(blockY, count);

      phase.topics.forEach((t, k) => {
        const topic = t as Topic;
        const topicY = firstTopicY + k * (TOPIC_NODE_HEIGHT + TOPIC_GAP);
        nodes.push(
          topicNode(
            topic.id,
            { x: TOPICS_X, y: topicY },
            topic,
            onTopicClick,
          ),
        );

        // Dashed fan-out: the block's k-th source handle -> this topic.
        edges.push({
          id: `${phase.id}#t${k}->${topic.id}`,
          source: phase.id,
          sourceHandle: `t${k}`,
          target: topic.id,
          type: "smooth",
          animated: false,
          style: { strokeDasharray: "5 4", stroke: "#9ca3af" },
          markerEnd: "arrowclosed",
        } as unknown as ReactFlowJsonObject);
      });

      // Solid progress link: previous block -> this block.
      if (prevBlockId) {
        edges.push({
          id: `${prevBlockId}->${phase.id}`,
          source: prevBlockId,
          target: phase.id,
          type: "straight",
          animated: false,
          style: { stroke: "#4f46e5", strokeWidth: 2 },
          markerEnd: "arrowclosed",
        } as unknown as ReactFlowJsonObject);
      }

      // The block card itself (topicCount may be 0 mid-stream).
      nodes.push(
        phaseCardNode(
          phase.id,
          { x: BLOCK_X, y: blockY },
          phase,
        ),
      );

      prevBlockId = phase.id;
    });

    // Loading placeholder: tail of the last in-progress phase's topic column.
    if (generating) {
      const lastPhase = phases[phases.length - 1];
      const rowCount = lastPhase ? lastPhase.topics.length : 0;
      const lastBlockY = lastPhase
        ? (phases.length - 1) * ROW_HEIGHT
        : 0;
      const topicY =
        topicStackTopY(lastBlockY, rowCount) +
        rowCount * (TOPIC_NODE_HEIGHT + TOPIC_GAP);
      const key = `loading-${lastPhase?.id ?? "head"}`;
      nodes.push(loadingPlaceholderNode(key, { x: TOPICS_X, y: topicY }) as never);

      // Dashed link from the in-progress block's next free handle.
      if (lastPhase) {
        edges.push({
          id: `${lastPhase.id}#t${rowCount}->${key}`,
          source: lastPhase.id,
          sourceHandle: `t${rowCount}`,
          target: key,
          type: "smooth",
          animated: false,
          style: { strokeDasharray: "5 4", stroke: "#c7d2fe" },
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

