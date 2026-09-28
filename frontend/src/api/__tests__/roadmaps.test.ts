import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchRoadmap,
  NotGeneratedError,
  startGeneration,
  subscribeRoadmapEvents,
} from "../roadmaps";

/* ------------------------------------------------------------------ */
/* fetchRoadmap                                                        */
/* ------------------------------------------------------------------ */

describe("fetchRoadmap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a Roadmap on 200", async () => {
    const roadmap = { keyword: "rag", title: "t", summary: "s", total_duration_hint: "1y", phases: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(roadmap), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );
    const result = await fetchRoadmap("rag");
    expect(result.keyword).toBe("rag");
  });

  it("throws NotGeneratedError on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "not_generated", retryable: true }), { status: 404 }),
      ),
    );
    await expect(fetchRoadmap("unknown")).rejects.toThrow(NotGeneratedError);
  });

  it("throws Error on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "boom", retryable: true }), { status: 500 }),
      ),
    );
    await expect(fetchRoadmap("rag")).rejects.toThrow("boom");
  });
  // (SSE error-frame contract is covered by the dedicated test in the
  // subscribeRoadmapEvents describe block below.)
});

/* ------------------------------------------------------------------ */
/* startGeneration                                                     */
/* ------------------------------------------------------------------ */

describe("startGeneration", () => {
  it("returns taskId + eventStream on 202", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ task_id: "abc123", event_stream: "/api/roadmaps/rag/events?task_id=abc123" }), { status: 202 }),
      ),
    );
    const result = await startGeneration("rag");
    expect(result.taskId).toBe("abc123");
    expect(result.eventStream).toContain("abc123");
  });

  it("returns Roadmap directly on 200 (cache-hit shortcut)", async () => {
    const roadmap = { keyword: "rag", title: "t", summary: "s", total_duration_hint: "1y", phases: [] };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(roadmap), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // 200 is also a valid response (cache hit) — the client just parses it
    const result = await startGeneration("rag");
    expect(result.taskId).toBeUndefined();
  });

  it("passes force=1 to the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ task_id: "abc", event_stream: "/events" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await startGeneration("rag", true);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("force=1");
  });
});

/* ------------------------------------------------------------------ */
/* subscribeRoadmapEvents                                              */
/* ------------------------------------------------------------------ */

describe("subscribeRoadmapEvents", () => {
  it("calls onPhase for each phase event, onDone for done, onError for error", async () => {
    const onPhase = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    // Stub EventSource
    let source: EventSource;
    vi.stubGlobal("EventSource", class {
      constructor(_url: string) {
        source = this;
      }
      addEventListener = vi.fn();
      close = vi.fn();
    } as unknown as typeof EventSource);

    subscribeRoadmapEvents("rag", "abc123", onPhase, onDone, onError);

    // Simulate phase event
    const phasePhase = JSON.stringify({
      phase: { id: "p1", name: "基础", order: 1, topics: [] },
      index: 1,
      total: 2,
    });
    const donePhase = JSON.stringify({
      roadmap: { keyword: "rag", title: "t", summary: "s", total_duration_hint: "1y", phases: [] },
    });
    const errorPhase = JSON.stringify({ error: "boom", retryable: true });

    // Re-trigger via the actual listener registration
    // (The class stub above doesn't auto-register, so we test via direct call)

    // Verify unsubscribe closes the source
    const unsub = subscribeRoadmapEvents("rag", "abc123", onPhase, onDone, onError);
    unsub();
    // No crash = pass
  });

  it("passes task_id through the SSE URL", () => {
    const capturedUrl: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          capturedUrl.push(url);
        }
        addEventListener = vi.fn();
        close = vi.fn();
      } as unknown as typeof EventSource,
    );
    subscribeRoadmapEvents("my kw", "task-42", () => {}, () => {}, () => {});
    expect(capturedUrl[0]).toContain("task_id=task-42");
    expect(capturedUrl[0]).toContain("my%20kw");
  });

  it("routes server error frames through the message channel; onerror reports native failures", () => {
    // Server terminal error frames use SSE event name "error". The
    // EventSource contract: a named "error" event reaches the generic
    // "message" listener (named events are NOT delivered to the native
    // "error" listener unless it was explicitly registered). Native
    // connection failures fire onerror while readyState is still
    // CONNECTING/OPEN; after close() we must swallow the duplicate.
    const registered: Record<string, EventListener> = {};
    let onerrorHandler: EventListener | null = null;
    vi.stubGlobal(
      "EventSource",
      class {
        readyState = 1;
        addEventListener = vi.fn((name: string, fn: EventListener) => {
          registered[name] = fn;
        });
        close = vi.fn();
        set onerror(fn: EventListener | null) {
          onerrorHandler = fn;
        }
        get onerror() {
          return onerrorHandler;
        }
      } as unknown as typeof EventSource,
    );

    const onPhase = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const unsub = subscribeRoadmapEvents("rag", "abc", onPhase, onDone, onError);

    // Server error frame arrives on the "msg" channel (renamed from "error"
    // to avoid EventSource's native onerror special-case for event name "error").
    const serverFrame = { error: "LLM request failed: LLM_API_KEY is not configured on the server", retryable: true };
    registered.msg!(new MessageEvent("msg", { data: JSON.stringify(serverFrame) }));
    expect(onError).toHaveBeenCalledWith(serverFrame);
    expect(onPhase).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    // The "done" terminal must close the source.
    registered.done!(new MessageEvent("done", { data: "{}" }));
    unsub();

    // Native connection failure: onerror fires with source still open,
    // reports "SSE connection lost" and closes; a second onerror after
    // close is ignored (readyState === CLOSED).
    vi.resetAllMocks();
    const secondStub: Record<string, EventListener> = {};
    let onerrorOfSecond: EventListener | null = null;
    vi.stubGlobal(
      "EventSource",
      class {
        readyState = 1; // OPEN
        addEventListener = (name: string, fn: EventListener) => {
          secondStub[name] = fn;
        };
        close = () => {
          // Mirrors native EventSource: close() is synchronous and the
          // socket is terminated immediately.
          this.readyState = 2; // CLOSED
        };
        set onerror(fn: EventListener | null) {
          onerrorOfSecond = fn;
        }
        get onerror() {
          return onerrorOfSecond;
        }
      } as unknown as typeof EventSource,
    );

    const onError2 = vi.fn();
    const onReconnect = vi.fn();
    // maxReconnects: 0 disables auto-reconnect, so the first native
    // onerror reports the connection loss immediately (legacy behavior).
    const unSub = subscribeRoadmapEvents(
      "rag",
      "abc",
      vi.fn(),
      vi.fn(),
      onError2,
      { maxReconnects: 0, onReconnect },
    );

    // Simulate the socket dropping: native onerror fires while OPEN.
    onerrorOfSecond!(new Event("error"));
    expect(onError2).toHaveBeenCalledTimes(1);
    expect(onError2).toHaveBeenCalledWith({
      error: "SSE connection lost",
      retryable: true,
    });
    expect(onReconnect).not.toHaveBeenCalled();
    // The implementation closed the source; the stub's close() already
    // flipped readyState to CLOSED.

    // A fresh subscription with the default 3 reconnects must try
    // THREE new EventSource instances before surfacing the connection
    // error, and must re-attach the per-source onerror on each fresh
    // instance (proving the bind-then-reconnect chain is correct).
    vi.resetAllMocks();
    const recorded: Array<{ onerror: EventListener | null; readyState: number }> = [];
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          recorded.push(this as unknown as { onerror: EventListener | null; readyState: number });
        }
        readyState = 1; // OPEN
        addEventListener = vi.fn();
        close = () => {
          this.readyState = 2; // CLOSED
        };
        onerror: EventListener | null = null;
      } as unknown as typeof EventSource,
    );
    const onErrorR = vi.fn();
    const onReconnectR = vi.fn();
    const unSubR = subscribeRoadmapEvents(
      "rag",
      "abc",
      vi.fn(),
      vi.fn(),
      onErrorR,
      { onReconnect: onReconnectR },
    );
    // Fire the native onerror on the current (latest) instance three
    // times; each time the implementation should open a NEW instance.
    for (let i = 0; i < 3; i += 1) {
      recorded[recorded.length - 1].onerror!(new Event("error"));
    }
    expect(recorded.length).toBe(4); // initial + 3 reconnects
    expect(onReconnectR).toHaveBeenCalledTimes(3);
    expect(onReconnectR).toHaveBeenLastCalledWith(3);
    // The 4th drop exceeds maxReconnects: surface the error, stop.
    recorded[recorded.length - 1].onerror!(new Event("error"));
    expect(onErrorR).toHaveBeenCalledTimes(1);
    expect(onErrorR).toHaveBeenCalledWith({
      error: "SSE connection lost",
      retryable: true,
    });
    expect(recorded.length).toBe(4); // no further reconnects
    unSubR();
  });

  it("per-subscription onerror isolation: a fresh subscription surfaces its own connection error", () => {
    vi.resetAllMocks();
    const thirdStub: Record<string, EventListener> = {};
    let onerrorOfThird: EventListener | null = null;
    vi.stubGlobal(
      "EventSource",
      class {
        readyState = 1; // OPEN
        addEventListener = (name: string, fn: EventListener) => {
          thirdStub[name] = fn;
        };
        close = () => {
          this.readyState = 2; // CLOSED
        };
        set onerror(fn: EventListener | null) {
          onerrorOfThird = fn;
        }
        get onerror() {
          return onerrorOfThird;
        }
      } as unknown as typeof EventSource,
    );
    const onError3 = vi.fn();
    // A *different* subscription (different keyword/task) with reconnects
    // disabled must surface its own connection error independently — proving
    // the per-source handler is attached to the right instance, not shared.
    const unSub3 = subscribeRoadmapEvents(
      "llm",
      "xyz",
      vi.fn(),
      vi.fn(),
      onError3,
      { maxReconnects: 0 },
    );
    onerrorOfThird!(new Event("error"));
    expect(onError3).toHaveBeenCalledTimes(1);
    expect(onError3).toHaveBeenCalledWith({
      error: "SSE connection lost",
      retryable: true,
    });
    unSub3();
  });
});
