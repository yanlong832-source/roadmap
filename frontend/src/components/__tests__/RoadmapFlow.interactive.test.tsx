import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Phase, Topic } from "../../types/roadmap";
import { RoadmapFlow } from "../RoadmapFlow";
import { RoadmapView } from "../RoadmapView";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeTopic(id: string, phaseId: string, title: string): Topic {
  return {
    id,
    phase_id: phaseId,
    title,
    description: `${title} 的一句话说明`,
    duration_hint: "1 周",
    resources: [],
  };
}

const phase1: Phase = {
  id: "p1",
  name: "基础",
  order: 1,
  topics: [
    makeTopic("p1t1", "p1", "向量检索"),
    makeTopic("p1t2", "p1", "倒排索引"),
    makeTopic("p1t3", "p1", "混合检索"),
  ],
};

const phase2: Phase = {
  id: "p2",
  name: "进阶",
  order: 2,
  topics: [makeTopic("p2t1", "p2", "Rerank 模型")],
};

/* ------------------------------------------------------------------ */
/* collapse: zero topic nodes + later phase shifts up                  */
/* ------------------------------------------------------------------ */

describe("RoadmapFlow collapse", () => {
  it("renders 0 topic nodes when a phase is collapsed", () => {
    render(
      <RoadmapFlow
        phases={[phase1, phase2]}
        generating={false}
        onTopicClick={() => {}}
        collapsed={new Set(["p1"])}
      />,
    );
    // p1's topics are hidden; only p2's 1 topic node + 2 block cards remain
    const nodes = document.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBe(3); // p1 block, p2 block, p2t1
    expect(
      screen.queryByText("向量检索"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Rerank 模型")).toBeInTheDocument();
  });

  it("later phase shifts up when earlier phase is collapsed", () => {
    const { rerender } = render(
      <RoadmapFlow
        phases={[phase1, phase2]}
        generating={false}
        onTopicClick={() => {}}
      />,
    );

    // Collect p2 block y before and after collapse
    const yOfNode = (text: string) => {
      const nodes = Array.from(
        document.querySelectorAll(".react-flow__node"),
      ) as HTMLElement[];
      const el = nodes.find((n) => n.textContent?.includes(text));
      if (!el) return 0;
      const match = el.style.transform.match(
        /translate\([^,]+,\s*([^)]+)px\)/,
      );
      return Number(match?.[1] ?? "0");
    };

    const p2yBefore = yOfNode("进阶");

    rerender(
      <RoadmapFlow
        phases={[phase1, phase2]}
        generating={false}
        onTopicClick={() => {}}
        collapsed={new Set(["p1"])}
      />,
    );

    const p2yAfter = yOfNode("进阶");
    // Collapsing p1 (3 topics → 0) must shrink row 1 and pull p2 up
    expect(p2yAfter).toBeLessThan(p2yBefore);
  });
});

/* ------------------------------------------------------------------ */
/* status pill: cycles without firing onTopicClick                     */
/* ------------------------------------------------------------------ */

describe("RoadmapFlow status pill", () => {
  it("pill click calls onCycleStatus and does NOT fire onTopicClick", () => {
    const onTopicClick = vi.fn();
    const onCycleStatus = vi.fn();
    render(
      <RoadmapFlow
        phases={[phase1]}
        generating={false}
        onTopicClick={onTopicClick}
        onCycleStatus={onCycleStatus}
        statuses={{ p1t1: "not_started" }}
      />,
    );

    const pill = screen.getByTestId("topic-status-p1t1");
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toContain("未开始");

    fireEvent.click(pill);

    expect(onCycleStatus).toHaveBeenCalledTimes(1);
    const calledWith = onCycleStatus.mock.calls[0][0] as Topic;
    expect(calledWith.id).toBe("p1t1");
    // Card body click handler must NOT fire
    expect(onTopicClick).not.toHaveBeenCalled();
  });

  it("pill shows the correct label per status", () => {
    render(
      <RoadmapFlow
        phases={[phase1]}
        generating={false}
        onTopicClick={() => {}}
        onCycleStatus={() => {}}
        statuses={{ p1t1: "in_progress", p1t2: "done" }}
      />,
    );
    expect(screen.getByTestId("topic-status-p1t1").textContent).toContain("学习中");
    expect(screen.getByTestId("topic-status-p1t2").textContent).toContain("已完成");
  });
});

/* ------------------------------------------------------------------ */
/* keyword toolbar: Enter navigates via MemoryRouter                   */
/* ------------------------------------------------------------------ */

// Mock fetchProgress / setProgress so the view test doesn't hit the network.
vi.mock("../../api/progress", () => ({
  fetchProgress: vi.fn(async () => ({})),
  setProgress: vi.fn(async () => {}),
}));

/**
 * Tiny probe component that exposes the current location inside a
 * MemoryRouter, so we can assert that RoadmapView's toolbar navigated.
 */

describe("RoadmapView keyword toolbar", () => {
  // We need to mock the roadmaps API too so RoadmapView renders without
  // hitting the network.
  vi.mock("../../api/roadmaps", () => ({
    fetchRoadmap: vi.fn(async () => ({
      keyword: "rag",
      title: "RAG",
      summary: "s",
      total_duration_hint: "4 周",
      phases: [phase1],
    })),
    startGeneration: vi.fn(),
    subscribeRoadmapEvents: vi.fn(),
    NotGeneratedError: class NotGeneratedError extends Error {},
  }));

  it("pressing Enter in the toolbar input navigates to /{encoded-keyword}", async () => {
    // Render RoadmapView inside a MemoryRouter and read the location via
    // a probe. Use act() to flush async effects.
    // Use a simple render + act approach without the TDZ closure issue.
    let currentPath = "/rag";
    const Wrapper = () => {
      const loc = useLocation();
      currentPath = loc.pathname;
      return (
        <div data-testid="loc" data-path={loc.pathname}>
          <RoadmapView />
        </div>
      );
    };
    const { unmount } = render(
      <MemoryRouter initialEntries={["/rag"]}>
        <Wrapper />
      </MemoryRouter>,
    );
    // Let the async load settle so the toolbar renders
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const input = screen.getByTestId("roadmap-search-input");
    fireEvent.change(input, { target: { value: "  新  关键词 " } });
    // Submit the form (Enter in the input triggers this in a real browser)
    const form = input.closest("form")!;
    fireEvent.submit(form);

    // After Enter the input is cleared and the router navigates
    expect(currentPath).toBe("/" + encodeURIComponent("新 关键词"));
    expect((input as HTMLInputElement).value).toBe("");
    unmount();
  });
});
