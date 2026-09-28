import {
  DoneEvent,
  ErrorEvent,
  PhaseEvent,
  Phase,
  Roadmap,
} from "../types/roadmap";

const API_BASE = "/api/roadmaps";

/**
 * Thrown when the cache has no roadmap for the keyword (HTTP 404).
 * Frontend should treat this as "not generated yet" and fall through
 * to the generate flow.
 */
export class NotGeneratedError extends Error {
  keyword: string;

  constructor(keyword: string) {
    super(`roadmap not generated for "${keyword}"`);
    this.name = "NotGeneratedError";
    this.keyword = keyword;
  }
}

/* ------------------------------------------------------------------ */
/* Read cache                                                          */
/* ------------------------------------------------------------------ */

export async function fetchRoadmap(keyword: string): Promise<Roadmap> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(keyword)}`);
  if (res.status === 404) {
    throw new NotGeneratedError(keyword);
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `GET roadmap failed (${res.status})`,
    );
  }
  return res.json() as Promise<Roadmap>;
}

/* ------------------------------------------------------------------ */
/* Start generation                                                    */
/* ------------------------------------------------------------------ */

export interface StartGenerationResult {
  taskId: string;
  eventStream: string;
}

export async function startGeneration(
  keyword: string,
  force = false,
): Promise<StartGenerationResult> {
  const qs = force ? "?force=1" : "";
  const res = await fetch(
    `${API_BASE}/${encodeURIComponent(keyword)}/generate${qs}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `POST generate failed (${res.status})`,
    );
  }
  const data = await res.json();
  return { taskId: data.task_id, eventStream: data.event_stream } as StartGenerationResult;
}

/* ------------------------------------------------------------------ */
/* SSE event stream                                                    */
/* ------------------------------------------------------------------ */

/**
 * Subscribe to the SSE event stream for a roadmap generation task.
 *
 * @param keyword   original keyword (used to build the SSE URL)
 * @param taskId    task_id returned by startGeneration
 * @param onPhase   called for each `phase` event (incremental stage)
 * @param onDone    called once when `done` arrives with the full Roadmap
 * @param onError   called when `error` arrives or the connection fails
 *
 * Returns an unsubscribe function that closes the underlying EventSource.
 *
 * Deduplication: the caller is responsible for deduplicating by
 * `phase.id` — this layer emits every `phase` event as-is.
 */
export function subscribeRoadmapEvents(
  keyword: string,
  taskId: string,
  onPhase: (event: PhaseEvent) => void,
  onDone: (event: DoneEvent) => void,
  onError: (event: ErrorEvent) => void,
): () => void {
  const url = `${API_BASE}/${encodeURIComponent(keyword)}/events?task_id=${encodeURIComponent(taskId)}`;
  const source = new EventSource(url);

  source.addEventListener("phase", (e: MessageEvent) => {
    try {
      onPhase(JSON.parse(e.data) as PhaseEvent);
    } catch {
      /* ignore malformed payload */
    }
  });

  source.addEventListener("done", (e: MessageEvent) => {
    try {
      onDone(JSON.parse(e.data) as DoneEvent);
    } finally {
      source.close();
    }
  });

  // Server-sent "error" event. The native EventSource "error" event
  // (connection failure) always has empty data and fires the same
  // listener with no payload, so server-side error frames are
  // delivered through the "message" channel (generic listener for
  // named events) to keep the two cases distinguishable.
  source.addEventListener("message", (e: MessageEvent) => {
    if (!e.data) return;
    try {
      const parsed = JSON.parse(e.data) as { error?: string };
      if (parsed && parsed.error !== undefined) {
        onError(parsed as unknown as ErrorEvent);
      }
    } catch {
      onError({ error: "malformed SSE error payload", retryable: true });
    }
    source.close();
  });

  source.onerror = () => {
    // Native connection-level error (network drop, server gone).
    // After we close() the source ourselves (done/error terminals),
    // a final onerror may fire — readyState CLOSED means we already
    // handled a terminal event; ignore it.
    if (source.readyState === EventSource.CLOSED) return;
    onError({ error: "SSE connection lost", retryable: true });
    source.close();
  };

  return () => {
    source.close();
  };
}
