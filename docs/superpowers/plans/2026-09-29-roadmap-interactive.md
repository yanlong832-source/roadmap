# Roadmap Interactive Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive roadmap: collapsible/draggable phase blocks, center-connected block chain, topic learning-state persistence with left/right balanced layout, and an in-page keyword search entry.

**Architecture:** A pure frontend layout module computes node positions for a two-column topic layout with dynamic row heights; React Flow nodes stay draggable. Progress state lives in Redis as a hash keyed per normalized keyword, exposed via two new REST endpoints; the frontend computes a stable 12-hex sha1 fingerprint per topic and merges persisted statuses into node data. Collapsed state and user-dragged positions are view-local only.

**Tech Stack:** React 18, @xyflow/react 12, FastAPI, redis.asyncio (existing), vitest, pytest. No new dependencies.

**Spec:** docs/superpowers/specs/2026-09-29-roadmap-interactive-design.md

## Global Constraints

- No new npm/pip dependencies. No vite build config changes.
- Fingerprint algorithm MUST match between backend and frontend: first 12 hex chars of sha1(norm_keyword + "|" + phase.name + "|" + topic.title). Frontend uses a small dependency-free TypeScript sha1; backend uses hashlib.sha1.
- Progress API degrades gracefully when Redis is unavailable (same pattern as app/services/cache.py): GET returns {"statuses": {}}, POST returns {"ok": true} as a no-op.
- Block chain edges connect bottom-center to top-center using named handles "bottom-center" / "top-center" (Position.Bottom / Position.Top, centered via style left: 50%).
- Existing tests must keep passing; update RoadmapFlow.test.tsx coordinate assertions as part of Task 2 (keep their intent).
- Server deploy directory /myserver/roadmap. Frontend-only changes: tar dist + scp, no backend restart. Task 1 changes the backend -> restart the roadmap service after deploy.

## Review Focus

1. Fingerprint drift between backend and frontend (progress never matches) - pinned by Task 2 vector fixtures + Task 4 cross-language test.
2. Layout overlap with many topics - pinned by Task 2 dynamic-row-height test with uneven counts.
3. Collapsed row must recompute subsequent phase positions - pinned by Task 3 rerender test.
4. Drag must not fight fitView - fitView only on mount; manual check in Task 3 step 5 (ledger note).
5. Progress POST while Redis down must not 500 - pinned by Task 1 degradation test.

---

### Task 1: Backend progress store + API

**Files:**
- Create: backend/app/services/progress.py
- Create: backend/app/routes/progress.py
- Modify: backend/app/main.py (include router)
- Test: backend/tests/test_progress.py

**Interfaces:**
- Produces:
  - `compute_fingerprint(norm_keyword, phase_name, topic_title) -> str` in app.services.progress: 12-hex sha1 prefix.
  - `class ProgressStore(redis_url="redis://localhost:6379/0", client=None)` with `async get_statuses(norm_keyword) -> dict[str,str]` and `async set_statuses(norm_keyword, updates: dict[str,str]) -> None`; graceful degradation like CacheService (available flag, swallow exceptions).
  - Routes: GET /api/progress/{keyword} -> {"statuses": {...}}; POST /api/progress/{keyword} body {"updates": {fingerprint: status}} -> {"ok": true}. status in {"not_started","in_progress","done"}; keyword validated like roadmaps routes (422 when empty / >100 chars).
  - Redis hash key `progress:{norm_keyword}`; field = fingerprint; value = JSON {"status","updated_at"}.

- [ ] **Step 1: Write failing tests** backend/tests/test_progress.py (pattern: tests/test_cache.py + tests/test_roadmaps_api.py):
  - fingerprint: deterministic; 12 hex chars; changes when topic title changes; stable across calls.
  - ProgressStore round-trip with a dict-backed fake client: set then get returns statuses; unknown keyword -> {}.
  - ProgressStore with a raising client: available flips False, get_statuses -> {}, set_statuses no-op, no exceptions.
  - API: GET unknown keyword -> 200 {"statuses": {}}; POST valid updates -> 200 then GET echoes; POST with status value "bogus" -> 422.
- [ ] **Step 2: Run** `Set-Location backend; & D:\code\myserver\roadmap\.venv-task0\Scripts\python.exe -m pytest tests/test_progress.py -q` - expected FAIL (module/routes missing).
- [ ] **Step 3: Implement** app/services/progress.py + app/routes/progress.py; register the router in app/main.py; Pydantic request model validating the 3-value status Literal.
- [ ] **Step 4: Run full suite** - same pytest over tests/; expected all pass.
- [ ] **Step 5: Commit** - `git add backend/app/services/progress.py backend/app/routes/progress.py backend/app/main.py backend/tests/test_progress.py` + `git commit -m "feat(progress): per-topic learning-state store + REST API"`.

### Task 2: Frontend layout engine (two-column, dynamic rows, collapse-aware) + shared sha1

**Files:**
- Create: frontend/src/layout/roadmapLayout.ts
- Create: frontend/src/layout/fingerprintVectors.ts (shared test fixture)
- Test: frontend/src/layout/__tests__/roadmapLayout.test.ts
- Modify: frontend/src/components/__tests__/RoadmapFlow.test.tsx (update coordinate assertions)

**Interfaces:**
- Produces:
  - `type LearningStatus = "not_started" | "in_progress" | "done"`
  - `computeFingerprint(normKeyword, phaseName, topicTitle): string` - first 12 hex of sha1 of `normKeyword + "|" + phaseName + "|" + topicTitle` (dependency-free impl).
  - `layoutPhase({ phaseId, phaseName, topics: {id,title}[], blockY }): { topics: Array<{ topicId; x; y; side: "left" | "right" }> }` - even index left, odd index right; each side centered against block center; x offset 140 px from block center.
  - `rowHeightFor(maxSideCount: number, collapsed: boolean): number` - collapsed: `Math.max(250, 96 + 130)`; expanded: `Math.max(250, maxSideCount * (116 + 56) + 130)`. Named constants: TOPIC_NODE_HEIGHT=116, PHASE_CARD_HEIGHT=96, TOPIC_GAP=56, PHASE_GAP=130, BASE_ROW_HEIGHT=250.
  - `buildChainEdge(prevBlockId: string, nextBlockId: string)` - straight edge, sourceHandle "bottom-center", targetHandle "top-center", stroke #4f46e5 width 2.
  - fingerprintVectors.ts exports `Array<{input: string; expected: string}>` with at least 3 vectors (generated once via node crypto, hardcoded).
- [ ] **Step 1: Generate vectors + write failing tests** - roadmapLayout.test.ts: layoutPhase split/centering with 7 topics; rowHeightFor with collapsed true/false and counts 0..5; computeFingerprint against fingerprintVectors (all must pass); no-overlap: two consecutive phases (7 and 3 topics) - assert the second phase blockY >= first phase max topic y + TOPIC_NODE_HEIGHT + TOPIC_GAP.
- [ ] **Step 2: Run** `pnpm test` (filtered to layout tests) - expected FAIL (module missing).
- [ ] **Step 3: Implement** the layout module + sha1; update RoadmapFlow.test.tsx coordinate assertions to the new layout (same intent: stable positions, second phase below first).
- [ ] **Step 4: Run** `pnpm test` - all green.
- [ ] **Step 5: Commit** - `git add -A frontend/src/layout frontend/src/components/__tests__` + `git commit -m "feat(frontend): two-column collapsible roadmap layout engine"`.

### Task 3: Collapse button, draggable blocks, status-colored TopicNode, keyword entry

**Files:**
- Modify: frontend/src/components/PhaseCard.tsx - collapse toggle button (`onToggleCollapse(phaseId)`), named bottom-center/top-center handles, data-testid `phase-collapse-{id}`.
- Modify: frontend/src/components/TopicNode.tsx - props `status: LearningStatus` + `onCycleStatus(topic)`; status pill (not-started / in-progress / done, Chinese labels not started / learning / done) cycles via click with stopPropagation; card colors: not_started gray, in_progress amber left bar, done green left bar + check mark; body click still calls onTopicClick.
- Modify: frontend/src/components/RoadmapFlow.tsx - new props `collapsed: Set<string>`, `statuses: Record<string, LearningStatus>`, `onToggleCollapse`, `onCycleStatus`; use layout module; fan-out edges only for expanded phases; fitView on mount only.
- Modify: frontend/src/components/RoadmapView.tsx - `collapsed` state + toggle; `statuses` record keyed by topic id (merged from progress fetch after load/done); onCycleStatus: optimistic next status (not_started->in_progress->done->not_started) + fire-and-forget setProgress; toolbar keyword input (data-testid `roadmap-search-input`), Enter -> normalizeKeyword + navigate("/"+encodeURIComponent(kw)).
- Test: extend existing component tests: collapsed phase renders 0 topic nodes and no fan-out edges; later phase shifts up; pill click cycles without firing onTopicClick; toolbar Enter navigates (MemoryRouter).

**Interfaces:**
- Consumes: Task 2 layout module; Task 4 client `fetchProgress(keyword): Promise<Record<string,string>>` and `setProgress(keyword, updates): Promise<void>` from frontend/src/api/progress.ts (import these names; if Task 4 has not landed yet, create minimal stubs in this task - signatures are fixed here).

- [ ] **Step 1: Write failing component tests** (as listed above).
- [ ] **Step 2: Run** `pnpm test` - new tests FAIL.
- [ ] **Step 3: Implement** all four component files + minimal api/progress.ts client if missing.
- [ ] **Step 4: Run** `pnpm test` - all green.
- [ ] **Step 5: Manual check** (ledger note, not a test): `pnpm dev` locally - drag a block: edges follow, no refit; collapse: rows shift; cycle a pill: color changes.
- [ ] **Step 6: Commit** - `git add -A frontend/src` + `git commit -m "feat(frontend): collapse/drag blocks, topic learning states, keyword entry"`.

### Task 4: Progress API client + cross-language fingerprint check

**Files:**
- Create/complete: frontend/src/api/progress.ts (if Task 3 stubbed it)
- Test: frontend/src/api/__tests__/progress.test.ts
- Modify: backend/tests/test_progress.py - cross-check test importing the literals from frontend/src/layout/fingerprintVectors.ts (duplication with a comment pinning the source), asserting compute_fingerprint matches each vector.

**Interfaces:**
- Produces: `fetchProgress` / `setProgress` (signatures fixed in Task 3 Interfaces).

- [ ] **Step 1: Write failing tests** - fetchProgress GETs /api/progress/{encoded keyword}; setProgress POSTs updates; network failure resolves to {} / no-op (non-throwing); backend cross-language vectors test.
- [ ] **Step 2: Run** `pnpm test` - new tests FAIL.
- [ ] **Step 3: Implement** full client + backend cross-check test.
- [ ] **Step 4: Run** `pnpm test` green AND backend `pytest tests/test_progress.py -q` green.
- [ ] **Step 5: Commit** - `git add frontend/src/api backend/tests/test_progress.py` + `git commit -m "feat(progress): api client + cross-language fingerprint vectors"`.

---

## Deployment (after all tasks green)

1. Backend changed -> upload new backend files to /myserver/roadmap/backend (tar+scp as before), restart the roadmap service.
2. Frontend: `pnpm exec vite build`, tar dist, replace /myserver/roadmap/frontend/dist.
3. E2E on https://roadmap.yangzx1.xyz/: cycle a topic status and reload (status persists); collapse a block (later blocks shift); drag a block (edges follow); jump to a new keyword via the toolbar input.
4. Push main.
