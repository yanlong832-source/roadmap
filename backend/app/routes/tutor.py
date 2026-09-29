"""SSE route for the roadmap tutor (agent teacher in the side drawer).

Contract:
  POST /api/tutor/{keyword}
      body: {"message": str, "active_topic_id": str | null,
             "history": [{"role": str, "content": str}, ...]}
  -> 200 with `text/event-stream` body:
       event: delta  data: {"text": "..."}   (incremental chunks)
       event: done   data: {"full": "..."}    (final, once)
       event: msg    data: {"error": "..."}   (failure, retryable)

The full reply is computed in one LLM call (tutor answers are short),
then chunked into 8-char deltas so the UI can animate the response.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.keywords import normalize_keyword
from app.models import Phase, Topic
from app.routes.roadmaps import _get_cache, _get_client, _validate_keyword
from app.services.generator import LLMError
from app.services.tutor import build_tutor_system_prompt, tutor_complete

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

# Chunk size for the pseudo-streaming deltas (chars per frame).
_DELTA_CHUNK = 8
_DELTA_INTERVAL = 0.05  # seconds between frames; bounds total latency


class TutorMessage(BaseModel):
    role: str
    content: str


class TutorRequest(BaseModel):
    message: str
    active_topic_id: str | None = None
    history: list[TutorMessage] = []


def _find_topic(phases: list[Phase], topic_id: str) -> Topic | None:
    for phase in phases:
        for topic in phase.topics:
            if topic.id == topic_id:
                return topic
    return None


@router.post("/{keyword}")
async def tutor_stream(
    keyword: str, request: TutorRequest
) -> StreamingResponse:
    norm = _validate_keyword(keyword)
    if not request.message.strip():
        raise HTTPException(status_code=422, detail="message must not be empty")

    roadmap = await _get_cache().get(norm)
    phases = roadmap.phases if roadmap else []
    title = roadmap.title if roadmap else norm
    active = (
        _find_topic(phases, request.active_topic_id)
        if request.active_topic_id
        else None
    )

    system = build_tutor_system_prompt(
        norm, title, phases, active_topic=active
    )
    history = [{"role": m.role, "content": m.content} for m in request.history]

    async def _generate() -> AsyncGenerator[str, None]:
        try:
            full = await tutor_complete(
                _get_client(),
                system,
                history,
                request.message,
            )
        except LLMError as exc:
            yield f'event: msg\ndata: {json.dumps({"error": str(exc), "retryable": True}, ensure_ascii=False)}\n\n'
            return
        except Exception:
            import logging

            logging.getLogger(__name__).exception(
                "tutor stream failed for %s", norm
            )
            yield f'event: msg\ndata: {json.dumps({"error": "tutor failed", "retryable": True}, ensure_ascii=False)}\n\n'
            return

        if not full:
            full = "（本次回答为空，请重试。）"

        # Pseudo-stream: emit the final text in small animated chunks so
        # the drawer feels live without needing a token-streaming LLM.
        for i in range(0, len(full), _DELTA_CHUNK):
            chunk = full[i : i + _DELTA_CHUNK]
            yield f'event: delta\ndata: {json.dumps({"text": chunk}, ensure_ascii=False)}\n\n'
            if i + _DELTA_CHUNK < len(full):
                await asyncio.sleep(_DELTA_INTERVAL)

        yield f'event: done\ndata: {json.dumps({"full": full}, ensure_ascii=False)}\n\n'

    return StreamingResponse(_generate(), media_type="text/event-stream")
