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
from app.models import Phase, Roadmap, Resource
from app.services.cache import CacheService
from app.services.generator import LLMClient, LLMError, generate_phases
from app.services.tasks import TaskRegistry
from app.services.verify import verify_phase_resources
from app.services.websearch import enrich_resources_with_search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/roadmaps", tags=["roadmaps"])

# Module-level singletons (created on import; tests monkeypatch as needed).
_cache: CacheService | None = None
_registry: TaskRegistry | None = None
_client: LLMClient | None = None

# Background task timeout.
# Per-call budget defaults to 90 s (see generator._CALL_TIMEOUT_SECONDS);
# 8-phase generations through a slow gateway can legitimately exceed
# the original 90 s spec budget, so the total-task default is raised
# to 300 s. Override via env LLM_TASK_TIMEOUT (seconds) when deploying.
_TASK_TIMEOUT_SECONDS: float = float(os.getenv("LLM_TASK_TIMEOUT", "300"))

# Idle keepalive interval for live SSE connections: send a comment
# frame (": keepalive\n\n") every N seconds of silence so intermediate
# proxies / load-balancers do not drop the TCP connection while the
# LLM call is in flight (which can take up to LLM_CALL_TIMEOUT per
# phase and LLM_TASK_TIMEOUT in total).  Override via SSE_KEEPALIVE.
_SSE_KEEPALIVE_SECONDS: float = float(os.getenv("SSE_KEEPALIVE", "5"))


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
                # Post-LLM pass: probe every resource URL and drop the
                # ones the model hallucinated (404 / dead Bilibili page).
                phase = await verify_phase_resources(phase)
                # Second post-LLM pass: corroborate surviving resources
                # against a live web search; anything uncorroborated
                # is downgraded to a guaranteed-valid search link.
                phase = _enrich_phase_resources(phase)
                phases.append(phase)
                total_planned += 1
                registry.push_phase(task_id, phase, total_planned, total_planned)
    except TimeoutError:
        reason = (
            f"generation exceeded the {_TASK_TIMEOUT_SECONDS:.0f}s task budget"
        )
        logger.warning("generation task %s timed out", task_id)
        registry.mark_error(task_id, reason)
        return
    except LLMError as exc:
        reason = str(exc) or "LLM generation failed"
        logger.warning("generation task %s failed: %s", task_id, reason)
        registry.mark_error(task_id, reason)
        return
    except Exception:
        logger.exception("generation task %s failed unexpectedly", task_id)
        registry.mark_error(task_id, "internal error during generation")
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
                    yield f"event: msg\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"
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
                yield 'event: msg\ndata: {"error": "task failed", "retryable": true}\n\n'
            else:
                roadmap = await _get_cache().get(norm)
                if roadmap:
                    yield f"event: done\ndata: {roadmap.model_dump_json()}\n\n"

        return StreamingResponse(_terminal(), media_type="text/event-stream")

    async def _stream() -> AsyncGenerator[str, None]:
        # Replay any phases already in memory/Redis before subscribing.
        for record in replayed_phases:
            if "error" in record:
                yield f"event: msg\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"
            else:
                yield f"event: phase\ndata: {json.dumps(record, ensure_ascii=False)}\n\n"

        # Now consume live events.
        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_SSE_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    # No real event yet; nudge the connection with a
                    # comment frame so proxies keep the TCP socket open.
                    yield ": keepalive\n\n"
                    continue

                if item is None:
                    break
                event_name, payload = item
                # The "error" frame is renamed to "msg" in the SSE stream to avoid
                # EventSource's special-cased "error" native event name.
                sse_name = "msg" if event_name == "error" else event_name
                yield f"event: {sse_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                if event_name in ("done", "error"):
                    break
        finally:
            registry.unsubscribe(task_id, queue)

    return StreamingResponse(_stream(), media_type="text/event-stream")

def _enrich_phase_resources(phase: Phase) -> Phase:
    """Corroborate each topic's resources against a live web search.

    The enrichment is best-effort and synchronous; a failure degrades
    to the LLM-picked URLs unchanged (the URL-probe pass has already
    dropped the dead ones, so we never regress below that guarantee).
    """
    for topic in phase.topics:
        if not topic.resources:
            continue
        try:
            raw = [
                {"title": r.title, "url": r.url, "type": r.type, "note": r.note}
                for r in topic.resources
            ]
            enriched = enrich_resources_with_search(topic.title, raw)
            topic.resources = [
                Resource(
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    type=r.get("type", "doc"),
                    note=r.get("note"),
                )
                for r in enriched
            ]
        except Exception:
            logger.warning(
                "websearch enrichment failed for topic %s; keeping LLM URLs",
                topic.id,
                exc_info=True,
            )
    return phase

