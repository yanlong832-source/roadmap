import { describe, expect, it } from "vitest";

import {
  buildChainEdge,
  computeFingerprint,
  layoutPhase,
  rowHeightFor,
  PHASE_CARD_HEIGHT,
  PHASE_GAP,
  TOPIC_GAP,
  TOPIC_NODE_HEIGHT,
  NEXT_STATUS,
} from "../roadmapLayout";
import { FINGERPRINT_VECTORS } from "../fingerprintVectors";

/* ------------------------------------------------------------------ */
/* sha1 + fingerprint                                                  */
/* ------------------------------------------------------------------ */

describe("computeFingerprint", () => {
  it("matches every pinned cross-language vector", () => {
    for (const { input, expected } of FINGERPRINT_VECTORS) {
      const parts = input.split("|");
      expect(parts).toHaveLength(3);
      const [normKeyword, phaseName, topicTitle] = parts;
      expect(
        computeFingerprint(normKeyword, phaseName, topicTitle),
      ).toBe(expected);
    }
  });

  it("is deterministic and 12 hex chars", () => {
    const a = computeFingerprint("rag", "基础", "向量数据库入门");
    const b = computeFingerprint("rag", "基础", "向量数据库入门");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes when the topic title changes", () => {
    const x = computeFingerprint("rag", "基础", "向量数据库入门");
    const y = computeFingerprint("rag", "基础", "向量数据库进阶");
    expect(x).not.toBe(y);
  });
});

/* ------------------------------------------------------------------ */
/* two-column layout                                                   */
/* ------------------------------------------------------------------ */

function topicsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `topic ${i}`,
  }));
}

describe("layoutPhase", () => {
  it("splits 7 topics into left(4) / right(3) and centers each column", () => {
    const topics = topicsOf(7);
    const out = layoutPhase({
      phaseId: "p1",
      phaseName: "phase 1",
      topics,
      blockY: 0,
    });
    const sides = out.map((o) => o.side);
    // Even index -> left, odd index -> right.
    expect(sides).toEqual([
      "left", "right", "left", "right", "left", "right", "left",
    ]);

    // Both columns start at the same Y (centered against the block
    // midline) so the fan looks symmetric even when counts differ.
    const leftYs = out.filter((o) => o.side === "left").map((o) => o.y);
    const rightYs = out.filter((o) => o.side === "right").map((o) => o.y);
    const leftStackH = 4 * TOPIC_NODE_HEIGHT + 3 * TOPIC_GAP;
    const rightStackH = 3 * TOPIC_NODE_HEIGHT + 2 * TOPIC_GAP;
    const expectedLeftStart = PHASE_CARD_HEIGHT / 2 - leftStackH / 2;
    const expectedRightStart = PHASE_CARD_HEIGHT / 2 - rightStackH / 2;
    expect(leftYs[0]).toBeCloseTo(expectedLeftStart, 2);
    expect(rightYs[0]).toBeCloseTo(expectedRightStart, 2);

    // Left column x sits at the block origin; right at +140px.
    const leftX = out[0].x;
    const rightX = out[1].x;
    expect(rightX - leftX).toBe(140);

    // Each column stacks with the TOPIC_GAP step.
    expect(leftYs[1] - leftYs[0]).toBe(TOPIC_NODE_HEIGHT + TOPIC_GAP);
    expect(rightYs[2] - rightYs[1]).toBe(TOPIC_NODE_HEIGHT + TOPIC_GAP);
  });

  it("no-overlap: a 7-topic phase followed by a 3-topic phase stacks", () => {
    // Simulate two consecutive blocks with no collapse.
    const row1 = rowHeightFor(4, false);
    const row2 = rowHeightFor(2, false);
    const block2Y = row1 + row2;

    const out1 = layoutPhase({
      phaseId: "p1",
      phaseName: "phase 1",
      topics: topicsOf(7),
      blockY: 0,
    });
    const out2 = layoutPhase({
      phaseId: "p2",
      phaseName: "phase 2",
      topics: topicsOf(3),
      blockY: block2Y,
    });

    const maxTopicY1 = Math.max(
      ...out1.map((o) => o.y + TOPIC_NODE_HEIGHT),
    );
    const minTopicY2 = Math.min(...out2.map((o) => o.y));
    expect(minTopicY2).toBeGreaterThanOrEqual(
      maxTopicY1 + TOPIC_GAP,
    );
  });

  it("collapsed phases keep their row at BASE_ROW_HEIGHT (250)", () => {
    expect(rowHeightFor(0, true)).toBe(250);
    expect(rowHeightFor(1, true)).toBe(250);
  });

  it("row height grows only when a side exceeds the 250px budget", () => {
    // maxSide=2: 2*(116+56) = 344 -> +130 = 474
    expect(rowHeightFor(2, false)).toBe(474);
    // maxSide=3: 3*(116+56) = 516 -> +130 = 646
    expect(rowHeightFor(3, false)).toBe(646);
  });

  it("empty topics produce an empty layout (block-only row)", () => {
    expect(
      layoutPhase({
        phaseId: "p1",
        phaseName: "phase 1",
        topics: [],
        blockY: 0,
      }),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* status cycle                                                        */
/* ------------------------------------------------------------------ */

describe("NEXT_STATUS", () => {
  it("walks not_started -> in_progress -> done -> not_started", () => {
    let s = NEXT_STATUS.not_started;
    expect(s).toBe("in_progress");
    s = NEXT_STATUS[s];
    expect(s).toBe("done");
    s = NEXT_STATUS[s];
    expect(s).toBe("not_started");
  });
});

/* ------------------------------------------------------------------ */
/* chain edges                                                         */
/* ------------------------------------------------------------------ */

describe("buildChainEdge", () => {
  it("uses bottom-center / top-center named handles", () => {
    const e = buildChainEdge("p1", "p2");
    expect(e.source).toBe("p1");
    expect(e.target).toBe("p2");
    expect(e.sourceHandle).toBe("bottom-center");
    expect(e.targetHandle).toBe("top-center");
    expect(e.style.stroke).toBe("#4f46e5");
    expect(e.style.strokeWidth).toBe(2);
    expect(e.type).toBe("straight");
    expect(e.markerEnd).toBe("arrowclosed");
  });
});
