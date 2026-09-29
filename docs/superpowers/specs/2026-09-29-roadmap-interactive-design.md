# Roadmap Interactive Enhancement — Design

Date: 2026-09-29
Status: approved (in-chat design; user confirmed MVP scope: progress echo only, no LLM prompt injection)

## Goal

Make the generated roadmap interactive: collapsible/draggable directory blocks, bottom-center to top-center block chain, topic learning-state colors with persistence, balanced left/right topic layout, and a keyword search entry on the result page.

## Requirements

1. Phase (directory) blocks:
   - Toggle collapse/expand of their topics via a button on the block card (view-local state).
   - Blocks are draggable (React Flow node dragging; positions editable, no relayout after drag).
2. Block chain: solid edge from block bottom-center handle to next block top-center handle.
3. Topics:
   - Draggable.
   - Learning state: not_started / in_progress / done with distinct card colors (gray / amber / green accent + status pill).
   - A small state pill on the card cycles the state and persists via POST; clicking the card body still opens the resource drawer.
4. Persistence (data table storage):
   - fingerprint = first 12 hex chars of sha1(norm_keyword + "|" + phase.name + "|" + topic.title)
   - Redis hash key "progress:{norm_keyword}": fingerprint -> JSON {"status": ..., "updated_at": ...}
   - API: GET /api/progress/{keyword} -> {"statuses": {fingerprint: status}}
          POST /api/progress/{keyword} {"updates": {fingerprint: status}} -> {"ok": true}
   - Graceful degradation when Redis is down (return {} / no-op; same pattern as cache service).
   - Frontend computes fingerprints for all topics after roadmap load (cache fetch or done event) and merges statuses into node data.
   - MVP: echo/display + persist only. LLM prompt is NOT modified.
5. Layout:
   - Topics of a phase split evenly: even index -> left column of the block, odd index -> right column.
   - Each column stacks vertically and centers against the block center.
   - Dynamic row height: rowHeight = max(baseRowHeight, maxSideCount * (TOPIC_NODE_HEIGHT + TOPIC_GAP)) so consecutive phases never overlap.
   - Collapsed phase row uses only the block height (+ gap); topics are hidden (nodes not rendered) and their fan-out edges are removed.
6. Keyword entry on RoadmapView: a small search input in the toolbar; Enter submits a normalized keyword and navigates to /{keyword}.

## Out of scope (MVP)

- Persisted collapsed state, layout position persistence, progress injection into LLM prompts, cross-keyword progress aggregation, multi-worker scaling.
