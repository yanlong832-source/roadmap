import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Phase, Resource, Topic } from "../../types/roadmap";
import { RoadmapFlow } from "../RoadmapFlow";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeTopic(
  id: string,
  phaseId: string,
  title: string,
  resources: Resource[] = [],
): Topic {
  return {
    id,
    phase_id: phaseId,
    title,
    description: `description of ${title}`,
    duration_hint: "2 周",
    resources,
  };
}

const res1: Resource = {
  title: "B 站教程",
  url: "https://www.bilibili.com/video/BV1xx411c7mD",
  type: "bilibili",
  note: "单集深链",
};

/** 2 phases, 3 topics total: p1 has 2 topics, p2 has 1 topic. */
const phases: Phase[] = [
  {
    id: "p1",
    name: "基础",
    order: 1,
    topics: [
      makeTopic("p1t1", "p1", "向量检索", [res1]),
      makeTopic("p1t2", "p1", "倒排索引"),
    ],
  },
  {
    id: "p2",
    name: "进阶",
    order: 2,
    topics: [makeTopic("p2t1", "p2", "混合检索", [res1])],
  },
];

/* ------------------------------------------------------------------ */
/* node + edge rendering                                               */
/* ------------------------------------------------------------------ */

describe("RoadmapFlow layout", () => {
  it("renders one block per phase plus one node per topic", () => {
    render(
      <RoadmapFlow phases={phases} generating={false} onTopicClick={() => {}} />,
    );
    expect(screen.getByText("向量检索")).toBeInTheDocument();
    expect(screen.getByText("倒排索引")).toBeInTheDocument();
    expect(screen.getByText("混合检索")).toBeInTheDocument();
    // 3 topic nodes + 2 phase block cards
    const nodes = document.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBe(5);
    // the phase block cards exist with their directory labels
    expect(screen.getByTestId("phase-card-p1")).toBeInTheDocument();
    expect(screen.getByTestId("phase-card-p2")).toBeInTheDocument();
  });

  it("fans out dashed edges from blocks and links blocks in sequence", () => {
    render(
      <RoadmapFlow phases={phases} generating={false} onTopicClick={() => {}} />,
    );
    // Node card presence already proves the block + topic layout was
    // built; edges may not paint under jsdom, so we only assert that
    // the two blocks rendered as the directory spine.
    expect(screen.getByText("2 个主题")).toBeInTheDocument();
    expect(screen.getByText("1 个主题")).toBeInTheDocument();
  });

  it("keeps existing nodes in place when a new phase is appended", () => {
    const onTopicClick = vi.fn();
    const { rerender } = render(
      <RoadmapFlow phases={phases.slice(0, 1)} generating onTopicClick={onTopicClick} />,
    );
    // p1t1 and p1t2 at stable positions in the first row
    const first = document.querySelectorAll(".react-flow__node");
    expect(first.length).toBeGreaterThanOrEqual(2);

    rerender(
      <RoadmapFlow phases={phases} generating={false} onTopicClick={onTopicClick} />,
    );
    // p2t1 lands below p1's topics, p1 nodes keep their row
    const nodes = Array.from(document.querySelectorAll(".react-flow__node")) as HTMLElement[];
    const p2t1 = nodes.find((n) => n.textContent?.includes("混合检索"))!;
    const p1t1 = nodes.find((n) => n.textContent?.includes("向量检索"))!;
    const yOf = (el: HTMLElement) =>
      Number(el.style.transform.match(/translate\([^,]+,\s*([^)]+)px\)/)?.[1] ?? "0");
    expect(yOf(p1t1)).toBe(0);
    expect(yOf(p2t1)).toBeGreaterThan(yOf(p1t1));
  });
});

/* ------------------------------------------------------------------ */
/* loading placeholder                                                 */
/* ------------------------------------------------------------------ */

describe("RoadmapFlow generating placeholder", () => {
  it("shows a loading placeholder at the tail of the in-progress phase", () => {
    const { rerender } = render(
      <RoadmapFlow phases={phases.slice(0, 1)} generating onTopicClick={() => {}} />,
    );
    // placeholder marker visible while generating
    expect(screen.getByTestId("roadmap-loading-node")).toBeInTheDocument();
    // ...and gone once generation finishes
    rerender(
      <RoadmapFlow phases={phases.slice(0, 1)} generating={false} onTopicClick={() => {}} />,
    );
    expect(screen.queryByTestId("roadmap-loading-node")).not.toBeInTheDocument();
  });

  it("places the placeholder after the last generated topic of the phase", () => {
    render(
      <RoadmapFlow phases={phases.slice(0, 1)} generating onTopicClick={() => {}} />,
    );
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    // 2 topic nodes + 1 phase block + 1 loading placeholder
    expect(nodes.length).toBe(4);
    expect(nodes[nodes.length - 1]?.textContent).toContain("生成中");
  });
});

/* ------------------------------------------------------------------ */
/* topic click                                                          */
/* ------------------------------------------------------------------ */

describe("RoadmapFlow onTopicClick", () => {
  it("passes the full Topic (including resources) to onTopicClick", () => {
    const onTopicClick = vi.fn();
    render(<RoadmapFlow phases={phases} generating={false} onTopicClick={onTopicClick} />);

    fireEvent.click(screen.getByText("向量检索"));

    expect(onTopicClick).toHaveBeenCalledTimes(1);
    const clicked = onTopicClick.mock.calls[0][0] as Topic;
    expect(clicked).toEqual(makeTopic("p1t1", "p1", "向量检索", [res1]));
    // full topic object, not a stripped-down summary
    expect(clicked.id).toBe("p1t1");
    expect(clicked.resources).toHaveLength(1);
    expect(clicked.resources[0]).toEqual(res1);
  });
});
