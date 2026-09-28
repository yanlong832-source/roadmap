"""Roadmap generation routes: read cache, start async task, SSE stream.

All responses that carry a Roadmap return the Roadmap object itself
(no wrapper); all failures use {"error": str, "retryable": bool}.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

from app.keywords import normalize_keyword
from app.models import Phase, Roadmap
from app.services.cache import CacheService
from app.services.generator import LLMClient, LLMError, generate_phases
from app.services.tasks import TaskRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/roadmaps", tags=["roadmaps"])

# Module-level singletons (created on import; tests monkeypatch as needed).
_cache: CacheService | None = None
_registry: TaskRegistry | None = None
_client: LLMClient | None = None

# Background task timeout (spec: 90 s total task budget).
_TASK_TIMEOUT_SECONDS = 90.0


def _get_cache() -> CacheService:
    global _cache
    if _cache is None:
        _cache = CacheService(redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    return _cache


def _get_registry() -> TaskRegistry:
    global _registry
    if _registry is None:
        _registry = TaskRegistry(redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    return _registry


def _get_client() -> LLMClient:
    global _client
    if _client is None:
        _client = LLMClient(
            api_key=os.getenv("LLM_API_KEY", ""),
            base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
            model=os.getenv("LLM_MODEL", "gpt-4"),
        )
    return _client


def _validate_keyword(raw: str) -> str:
    norm = normalize_keyword(raw)
    if not norm:
        raise HTTPException(status_code=422, detail="keyword must not be empty")
    if len(norm) > 100:
        raise HTTPException(status_code=422, detail="keyword must be at most 100 characters")
    return norm


# ------------------------------------------------------------------- #
# GET /api/roadmaps/{keyword}                                         #
# ------------------------------------------------------------------- #


@router.get("/{keyword}")
async def get_roadmap(keyword: str) -> Roadmap:
    """Read cache; 404 if not generated."""
    norm = _validate_keyword(keyword)
    roadmap = await _get_cache().get(norm)
    if roadmap is None:
        raise HTTPException(status_code=404, detail={"error": "not_generated", "retryable": True})
    return roadmap


# ------------------------------------------------------------------- #
# POST /api/roadmaps/{keyword}/generate                               #
# ------------------------------------------------------------------- #


@router.post("/{keyword}/generate", status_code=202)
async def generate_roadmap(keyword: str, force: bool = Query(default=False)) -> Any:
    norm = _validate_keyword(keyword)
    cache = _get_cache()
    registry = _get_registry()

    # Cache-hit shortcut: return Roadmap body directly, no SSE needed.
    # Bump the status to 200 (a completed result, not a new task).
    if not force:
        roadmap = await cache.get(norm)
        if roadmap is not None:
            return JSONResponse(
                content=json.loads(roadmap.model_dump_json()), status_code=200
            )

    # Deduplicate: reuse in-flight task for same keyword.
    if not force:
        existing_task_id = registry.get_task_id(norm)
        if existing_task_id is not None:
            return {
                "task_id": existing_task_id,
                "event_stream": f"/api/roadmaps/{keyword}/events?task_id={existing_task_id}",
            }

    # Register a new task and kick off background generation.
    task_id = registry.register(norm)
    asyncio.create_task(_run_generation(task_id, norm, force))

    return {
        "task_id": task_id,
        "event_stream": f"/api/roadmaps/{keyword}/events?task_id={task_id}",
    }


async def _run_generation(task_id: str, norm: str, force: bool) -> None:
    """Background coroutine: generate phases, push each to the registry,
    then mark done/error."""
    registry = _get_registry()
    cache = _get_cache()
    client = _get_client()

    phases: list[Phase] = []
    try:
        async with asyncio.timeout(_TASK_TIMEOUT_SECONDS):
            total_planned = 0
            async for phase in generate_phases(client, norm):
                phases.append(phase)
                total_planned += 1
                registry.push_phase(task_id, phase, total_planned, total_planned)
    except (LLMError, TimeoutError, Exception) as exc:
        logger.warning("generation task %s failed: %s", task_id, exc)
        registry.mark_error(task_id, str(exc))
        return

    # Build and cache the full roadmap.
    roadmap = Roadmap(
        keyword=norm,
        title=norm,
        summary="",
        total_duration_hint="",
        phases=phases,
    )
    await cache.set(norm, roadmap)
    # Broadcast the full Roadmap on the done event (spec SSE contract).
    registry.mark_done(task_id, roadmap.model_dump())


# ------------------------------------------------------------------- #
# GET /api/roadmaps/{keyword}/events  (SSE)                           #
# ------------------------------------------------------------------- #


@router.get("/{keyword}/events")
async def sse_events(keyword: str, task_id: str = Query(...)) -> StreamingResponse:
    norm = _validate_keyword(keyword)
    registry = _get_registry()

    # Replay already-emitted phases (Redis mirror first, then in-memory).
    replayed_phases = registry.phases(task_id)
    task_status = registry.status(task_id)

    if task_status in ("done", "error") and replayed_phases:
        # Terminal state: emit a one-shot replay then close.
        async def _replay_only() -> AsyncGenerator[str, None]:
            for record in replayed_phases:
                if "error" in record:
                    yield f"event: error\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"
                else:
                    yield f"event: phase\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"
            if task_status == "done":
                roadmap = await _get_cache().get(norm)
                if roadmap:
                    yield f"event: done\ndata: {roadmap.model_dump_json()}\n\n"
        return StreamingResponse(_replay_only(), media_type="text/event-stream")

    # Live streaming: subscribe to new phases via an asyncio queue.
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    registry.subscribe(task_id, queue)

    # If the task already hit a terminal state before any phase was recorded
    # (e.g. the plan call failed), no broadcast will ever reach this late
    # subscriber. Emit the terminal event synchronously then close.
    terminal_status = registry.status(task_id)
    if terminal_status in ("done", "error"):
        registry.unsubscribe(task_id, queue)

        async def _terminal() -> AsyncGenerator[str, None]:
            if terminal_status == "error":
                yield 'event: error\ndata: {"error": "task failed", "retryable": true}\n\n'
            else:
                roadmap = await _get_cache().get(norm)
                if roadmap:
                    yield f"event: done\ndata: {roadmap.model_dump_json()}\n\n"

        return StreamingResponse(_terminal(), media_type="text/event-stream")

    async def _stream() -> AsyncGenerator[str, None]:
        # Replay any phases already in memory/Redis before subscribing.
        for record in replayed_phases:
            if "error" in record:
                yield f"event: error\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"
            else:
                yield f"event: phase\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"

        # Now consume live events.
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                event_name, payload = item
                yield f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                if event_name in ("done", "error"):
                    break
        finally:
            registry.unsubscribe(task_id, queue)

    return StreamingResponse(_stream(), media_type="text/event-stream")
