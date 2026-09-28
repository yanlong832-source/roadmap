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
/**
 * Options controlling auto-reconnect behavior when the EventSource drops
 * on the wire (typical cause: an idle proxy / mobile hotspot closing the
 * TCP connection after a silent period).
 *
 * - maxReconnects: give up after this many attempts. Default 3.
 * - onReconnect:  invoked after a successful reconnect so the caller can
 *                 re-sync from the cache (GET roadmap → render if done).
 */
export interface SubscribeOptions {
  maxReconnects?: number;
  onReconnect?: (attempt: number) => void;
}

export function subscribeRoadmapEvents(
  keyword: string,
  taskId: string,
  onPhase: (event: PhaseEvent) => void,
  onDone: (event: DoneEvent) => void,
  onError: (event: ErrorEvent) => void,
  options: SubscribeOptions = {},
): () => void {
  const maxReconnects = options.maxReconnects ?? 3;
  let reconnectCount = 0;
  let intentionalClose = false;

  const url = `${API_BASE}/${encodeURIComponent(keyword)}/events?task_id=${encodeURIComponent(taskId)}`;
  let source = new EventSource(url);

  // bindAll wires every handler onto a (possibly new) EventSource instance
  // and registers an onerror that either reconnects (bounded by
  // maxReconnects) or gives up.  Reconnection is cheap: the server
  // replays already-emitted phases from the registry, so late
  // subscribers catch up without losing events.
  function bindAll(src: EventSource): void {
    src.addEventListener("phase", (e: MessageEvent) => {
      try {
        onPhase(JSON.parse(e.data) as PhaseEvent);
      } catch {
        /* ignore malformed payload */
      }
    });

    src.addEventListener("done", (e: MessageEvent) => {
      try {
        onDone(JSON.parse(e.data) as DoneEvent);
      } finally {
        src.close();
        intentionalClose = true;
      }
    });

    // Server-sent error frames use the named SSE event "msg" to avoid
    // EventSource's special-cased "error" event (which maps to onerror).
    src.addEventListener("msg", (e: MessageEvent) => {
      if (!e.data) return;
      try {
        const parsed = JSON.parse(e.data) as { error?: string };
        if (parsed && parsed.error !== undefined) {
          onError(parsed as unknown as ErrorEvent);
        }
      } catch {
        onError({ error: "malformed SSE error payload", retryable: true });
      }
      src.close();
      intentionalClose = true;
    });

    src.onerror = () => {
      // Native connection-level error (network drop, server gone, proxy
      // idle-close).  After we close() the source ourselves (done/error
      // terminals), a final onerror may fire; ignore it.
      if (src.readyState === EventSource.CLOSED) return;

      if (!intentionalClose && reconnectCount < maxReconnects) {
        reconnectCount += 1;
        src.close();
        source = new EventSource(url);
        bindAll(source);
        options.onReconnect?.(reconnectCount);
      } else {
        onError({ error: "SSE connection lost", retryable: true });
        src.close();
        intentionalClose = true;
      }
    };
  }

  bindAll(source);

  return () => {
    intentionalClose = true;
    source.close();
  };
}
