/**
 * Roadmap types — mirrors backend/app/models.py field-for-field.
 *
 * Resource / Topic / Phase / Roadmap match the Pydantic schema in the
 * backend; keep both files in sync when the spec changes.
 */

export type ResourceType = "bilibili" | "doc" | "book" | "course" | "project";

export interface Resource {
  title: string;
  url: string;
  type: ResourceType;
  note?: string | null;
}

export interface Topic {
  id: string;
  phase_id: string;
  title: string;
  description: string;
  duration_hint: string;
  resources: Resource[];
}

export interface Phase {
  id: string;
  name: string;
  order: number;
  topics: Topic[];
}

export interface Roadmap {
  keyword: string;
  title: string;
  summary: string;
  total_duration_hint: string;
  phases: Phase[];
}

/* ---- SSE event payloads (spec section 4) ---- */

/** `event: phase` — one generated stage, pushed incrementally. */
export interface PhaseEvent {
  phase: Phase;
  /** 1-based index of this phase within the roadmap. */
  index?: number;
  /** Total planned phases (available after the plan call). */
  total?: number;
}

/** `event: done` — generation finished; carries the full Roadmap. */
export interface DoneEvent {
  roadmap: Roadmap;
}

/** `event: error` — generation failed or timed out. */
export interface ErrorEvent {
  error: string;
  retryable: boolean;
}

/* ---- keyword normalization (must match backend/app/keywords.py) ---- */

/**
 * Lowercase, strip, and collapse internal whitespace to single spaces.
 * All-whitespace input yields "".
 */
export function normalizeKeyword(raw: string): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
