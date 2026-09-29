"""Progress routes: GET/POST per-topic learning states per keyword.

Contract (spec 2026-09-29-roadmap-interactive-design.md, Requirement 4):
  GET  /api/progress/{keyword}        -> {"statuses": {fingerprint: status}}
  POST /api/progress/{keyword}        body {"updates": {fingerprint: status}}
                                       -> {"ok": true}

Graceful degradation: when Redis is unavailable the store returns {}
and POST is a no-op, so the endpoints never 500 on a redis outage.
"""
from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.keywords import normalize_keyword
from app.services.progress import ProgressStore, VALID_STATUSES

router = APIRouter(prefix="/api/progress", tags=["progress"])

_store: ProgressStore | None = None

# Three fixed learning states; the Literal makes POST validation strict.
Status = Literal["not_started", "in_progress", "done"]


class ProgressUpdate(BaseModel):
    updates: dict[str, Status]


def _get_store() -> ProgressStore:
    global _store
    if _store is None:
        _store = ProgressStore(
            redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0")
        )
    return _store


def _validate_keyword(raw: str) -> str:
    norm = normalize_keyword(raw)
    if not norm:
        raise HTTPException(status_code=422, detail="keyword must not be empty")
    if len(norm) > 100:
        raise HTTPException(
            status_code=422, detail="keyword must be at most 100 characters"
        )
    return norm


@router.get("/{keyword}")
async def get_progress(keyword: str) -> dict:
    """Return {fingerprint: status} for every stored topic under the keyword."""
    norm = _validate_keyword(keyword)
    return {"statuses": await _get_store().get_statuses(norm)}


@router.post("/{keyword}")
async def post_progress(keyword: str, body: ProgressUpdate) -> dict:
    """Merge learning-state updates. No-op when the store is degraded."""
    norm = _validate_keyword(keyword)
    await _get_store().set_statuses(norm, dict(body.updates))
    return {"ok": True}

