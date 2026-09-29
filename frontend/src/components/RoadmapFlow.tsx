
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
import { LoadingNode, TopicNode, TOPIC_NODE_HEIGHT, TOPIC_GAP } from "./TopicNode";
import { PhaseCardNode, PHASE_CARD_HEIGHT } from "./PhaseCard";
import {
  LearningStatus,
  buildChainEdge,
  layoutPhase,
  rowHeightFor,
} from "../layout/roadmapLayout";

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
  /** Phase ids whose topic nodes are hidden (collapsed directory blocks). */
  collapsed?: Set<string>;
  /** Learning state per topic id; missing keys read as "not_started". */
  statuses?: Record<string, LearningStatus>;
  /** Toggle a phase block collapsed/expanded. */
  onToggleCollapse?: (phaseId: string) => void;
  /** Cycle one topic's learning state. */
  onCycleStatus?: (topic: Topic) => void;
}

/* ---- layout constants (fixed node sizes prevent hover jitter) ---- */

const BLOCK_X = 0; // phase block column
const RIGHT_COLUMN_OFFSET = 140; // topic x offset, block-relative (layoutPhase)

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
  status?: LearningStatus,
  onCycleStatus?: (topic: Topic) => void,
) {
  return {
    id,
    type: "topic",
    position,
    data: {
      topic,
      onTopicClick,
      ...(status ? { status } : {}),
      ...(onCycleStatus ? { onCycleStatus } : {}),
    },
  } as unknown as ReactFlowJsonObject;
}

function phaseCardNode(
  id: string,
  position: { x: number; y: number },
  phase: PartialPhase,
  collapsed: boolean,
  onToggleCollapse?: (phaseId: string) => void,
  statuses?: Record<string, LearningStatus>,
) {
  return {
    id,
    type: "phaseCard",
    position,
    data: {
      phase,
      topicCount: phase.topics.length,
      collapsed,
      onToggleCollapse,
      ...(statuses ? { statuses } : {}),
    },
  } as unknown as ReactFlowJsonObject;
}

/**
 * Vertical layered layout, "directory + details" style:
 *
 * - phase block: x = BLOCK_X; block y accumulates via rowHeightFor, which
 *   grows with per-side topic counts and shrinks for collapsed phases,
 *   so the blocks below slide up when you fold a dense phase
 * - topics: two columns, even index left / odd right, each column centered
 *   against the block card's midline (layoutPhase owns the math)
 * - each expanded block fans out to its topics with **dashed** edges;
 *   the progress chain between blocks stays **solid** via the named
 *   bottom-center / top-center handles
 * - `generating` appends one loading placeholder at the tail of the
 *   in-progress phase's right column, dashed-linked from the block
 * - fitView runs on mount only, so a manual drag never gets yanked back
 */
export function RoadmapFlow({
  phases,
  generating,
  onTopicClick,
  collapsed,
  statuses,
  onToggleCollapse,
  onCycleStatus,
}: RoadmapFlowProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: ReactFlowJsonObject[] = [];
    const edges: ReactFlowJsonObject[] = [];

    let blockY = 0;
    let prevBlockId: string | null = null;

    phases.forEach((phase) => {
      const isCollapsed = collapsed?.has(phase.id) ?? false;
      // Collapsed phases render zero topic nodes; the row height then
      // collapses to the base so later blocks shift up (plan Review #3).
      const topics = isCollapsed ? [] : phase.topics;

      // Statuses for this phase's cards (keyed by topic id, as RoadmapView
      // maintains them; missing entries default to not_started).
      const phaseStatuses: Record<string, LearningStatus> | undefined =
        statuses
          ? Object.fromEntries(
              phase.topics.map((t) => [
                t.id ?? "",
                statuses[t.id ?? ""] ?? "not_started",
              ]),
            )
          : undefined;

      // The block card itself (topicCount shows the real size even collapsed).
      nodes.push(
        phaseCardNode(
          phase.id,
          { x: BLOCK_X, y: blockY },
          phase,
          isCollapsed,
          onToggleCollapse,
          phaseStatuses,
        ),
      );

      // Two-column placement, block-relative; translate to absolute x.
      // Partial<Topic> may have undefined id/title mid-stream; fall back
      // to placeholders so the layout engine still gets clean strings.
      const placed = layoutPhase({
        phaseId: phase.id,
        phaseName: phase.name,
        topics: topics.map((t, i) => ({
          id: t.id ?? `${phase.id}-partial-${i}`,
          title: t.title ?? "",
        })),
        blockY,
      });

      placed.forEach((p, k) => {
        const topic = topics[k] as Topic;
        const topicId = topic.id ?? `${phase.id}-partial-${k}`;
        nodes.push(
          topicNode(
            topicId,
            { x: BLOCK_X + p.x, y: p.y },
            topic,
            onTopicClick,
            statuses ? statuses[topicId] ?? "not_started" : undefined,
            onCycleStatus,
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

      // Solid progress link: previous block -> this block (named handles).
      if (prevBlockId) {
        edges.push({
          ...buildChainEdge(prevBlockId, phase.id),
          animated: false,
        } as unknown as ReactFlowJsonObject);
      }

      const maxSideCount = isCollapsed
        ? 0
        : Math.ceil(phase.topics.length / 2);
      blockY += rowHeightFor(maxSideCount, isCollapsed);
      prevBlockId = phase.id;
    });

    // Loading placeholder: tail of the last in-progress phase's right column.
    if (generating && phases.length > 0) {
      const lastPhase = phases[phases.length - 1];
      const lastIsCollapsed = collapsed?.has(lastPhase.id) ?? false;
      const lastBlockY =
        blockY -
        rowHeightFor(
          lastIsCollapsed ? 0 : Math.ceil(lastPhase.topics.length / 2),
          lastIsCollapsed,
        );
      // Right column stack (odd-indexed topics) of the last phase.
      const rightCount = Math.floor(lastPhase.topics.length / 2);
      const rightStackHeight =
        rightCount * TOPIC_NODE_HEIGHT +
        Math.max(rightCount - 1, 0) * TOPIC_GAP;
      const topicY = Math.max(
        0,
        lastBlockY +
          PHASE_CARD_HEIGHT / 2 -
          rightStackHeight / 2 +
          rightCount * (TOPIC_NODE_HEIGHT + TOPIC_GAP),
      );
      const key = `loading-${lastPhase.id}`;
      nodes.push(
        loadingPlaceholderNode(key, {
          x: BLOCK_X + RIGHT_COLUMN_OFFSET,
          y: topicY,
        }) as never,
      );

      // Dashed link from the in-progress block's next free handle.
      edges.push({
        id: `${lastPhase.id}#t${lastPhase.topics.length}->${key}`,
        source: lastPhase.id,
        sourceHandle: `t${lastPhase.topics.length}`,
        target: key,
        type: "smooth",
        animated: false,
        style: { strokeDasharray: "5 4", stroke: "#c7d2fe" },
        markerEnd: "arrowclosed",
      } as unknown as ReactFlowJsonObject);
    }

    return { nodes, edges };
  }, [
    phases,
    generating,
    onTopicClick,
    collapsed,
    statuses,
    onToggleCollapse,
    onCycleStatus,
  ]);

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
          fitViewOptions={{ padding: 0.1 }}
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
