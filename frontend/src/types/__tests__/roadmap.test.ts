import { describe, expect, it } from "vitest";

import { normalizeKeyword, PhaseEvent, DoneEvent, ErrorEvent, Roadmap } from "../roadmap";

describe("normalizeKeyword", () => {
  it("matches backend normalize cases", () => {
    // 与 backend/tests/test_keywords.py 用例一一对应
    expect(normalizeKeyword("RAG")).toBe("rag");
    expect(normalizeKeyword(" rag ")).toBe("rag");
    expect(normalizeKeyword("  RAG    x  ")).toBe("rag x");
    expect(normalizeKeyword("   ")).toBe("");
    expect(normalizeKeyword("")).toBe("");
    expect(normalizeKeyword("A  B\nC")).toBe("a b c");
  });

  it("preserves non-ASCII", () => {
    expect(normalizeKeyword("  大模型 LLM  ")).toBe("大模型 llm");
  });
});

describe("SSE event payload types", () => {
  it("PhaseEvent is instantiable with a minimal phase", () => {
    const ev: PhaseEvent = {
      phase: { id: "p1", name: "基础", order: 1, topics: [] },
      index: 1,
      total: 4,
    };
    expect(ev.phase.order).toBe(1);
  });

  it("DoneEvent carries a full Roadmap", () => {
    const roadmap: Roadmap = {
      keyword: "rag",
      title: "RAG 路线",
      summary: "s",
      total_duration_hint: "1 年",
      phases: [{ id: "p1", name: "基础", order: 1, topics: [] }],
    };
    const ev: DoneEvent = { roadmap };
    expect(ev.roadmap.keyword).toBe("rag");
  });

  it("ErrorEvent has error + retryable", () => {
    const ev: ErrorEvent = { error: "boom", retryable: true };
    expect(ev.retryable).toBe(true);
  });
});
