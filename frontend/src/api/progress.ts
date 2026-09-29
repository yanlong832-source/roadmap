/**
 * Progress API client (plan Task 4, signature fixed by Task 3 Interfaces).
 *
 * - fetchProgress(keyword): GET /api/progress/{encoded keyword} -> statuses
 *   map (fingerprint -> LearningStatus). Network/HTTP failure resolves to
 *   {} (non-throwing, mirrors the backend's graceful degradation).
 * - setProgress(keyword, updates): POST /api/progress/{encoded keyword}
 *   with { updates: { fingerprint: status } }. Failure is a silent no-op.
 */
import { LearningStatus } from "../layout/roadmapLayout";

const API_BASE = "/api/progress";

export type ProgressStatuses = Record<string, LearningStatus>;

export async function fetchProgress(
  keyword: string,
): Promise<ProgressStatuses> {
  if (!keyword) return {};
  try {
    const res = await fetch(
      `${API_BASE}/${encodeURIComponent(keyword)}`,
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { statuses?: Record<string, string> };
    return (data.statuses ?? {}) as ProgressStatuses;
  } catch {
    // Network failure: degrade silently (same pattern as cache.py).
    return {};
  }
}

export async function setProgress(
  keyword: string,
  updates: ProgressStatuses,
): Promise<void> {
  if (!keyword || Object.keys(updates).length === 0) return;
  try {
    await fetch(`${API_BASE}/${encodeURIComponent(keyword)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
  } catch {
    // Silently ignore POST failures; the backend no-ops when Redis is
    // unavailable, and the client must not crash on transient errors.
  }
}
