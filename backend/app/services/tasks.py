"""Task registry for roadmap generation.

Tracks in-flight roadmap generation tasks so the health endpoint can report
a live count and the SSE layer can deduplicate concurrent requests for the
same keyword. State and completed phases are mirrored to Redis
(`task:{norm}`) for cross-worker reconnect replay; when Redis is
unavailable the registry still works in-memory for the current stream
(spec section 6 degradation rule).
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import redis.asyncio as aioredis

from app.models import Phase

logger = logging.getLogger(__name__)

_TASK_PREFIX = "task:"


@dataclass
class TaskState:
    task_id: str
    norm_keyword: str
    status: str = "running"  # running | done | error
    phases: list[dict] = field(default_factory=list)


class TaskRegistry:
    """In-memory task store with optional Redis mirroring.

    The registry is the source of truth for in-flight tasks within one
    process; Redis mirrors status + phases so an SSE client that reconnects
    can replay already-emitted phases even if the task was started by a
    different worker (or after a restart, residual `running` tasks surface
    as `error` per spec).
    """

    def __init__(
        self,
        redis_url: str = "redis://localhost:6379/0",
        client: Any | None = None,
    ) -> None:
        self._client = client if client is not None else aioredis.from_url(
            redis_url, decode_responses=True
        )
        self._available = True
        self._tasks: dict[str, TaskState] = {}
        self._by_keyword: dict[str, str] = {}  # norm_keyword -> task_id

    # -- lifecycle --------------------------------------------------------

    def register(self, norm_keyword: str) -> str:
        """Register (or reuse) a task for the given normalized keyword.

        If a task for this keyword is still running, its task_id is reused
        (spec: deduplicate concurrent requests, avoid duplicate LLM spend).
        """
        existing = self._by_keyword.get(norm_keyword)
        if existing and self._tasks[existing].status == "running":
            return existing
        task_id = uuid.uuid4().hex[:12]
        state = TaskState(task_id=task_id, norm_keyword=norm_keyword)
        self._tasks[task_id] = state
        self._by_keyword[norm_keyword] = task_id
        self._mirror_status(state)
        return task_id

    def push_phase(
        self,
        task_id: str,
        phase: Phase,
        index: int,
        total: int,
    ) -> None:
        state = self._get(task_id)
        if state is None or state.status != "running":
            return
        record = phase.model_dump()
        record["index"] = index
        record["total"] = total
        state.phases.append(record)
        self._mirror_phases(state)

    def mark_done(self, task_id: str) -> None:
        state = self._get(task_id)
        if state is None:
            return
        state.status = "done"
        self._mirror_status(state)

    def mark_error(self, task_id: str, error: str) -> None:
        state = self._get(task_id)
        if state is None:
            return
        state.status = "error"
        state.phases.append({"error": error, "retryable": True})
        self._mirror_status(state)

    # -- queries ----------------------------------------------------------

    def in_flight(self) -> int:
        """Count of tasks still in the running state."""
        return sum(1 for t in self._tasks.values() if t.status == "running")

    def get_task_id(self, norm_keyword: str) -> str | None:
        task_id = self._by_keyword.get(norm_keyword)
        if task_id and self._tasks[task_id].status != "running":
            return None
        return task_id

    def state(self, task_id: str) -> TaskState | None:
        return self._get(task_id)

    def phases(self, task_id: str) -> list[dict]:
        state = self._get(task_id)
        return list(state.phases) if state else []

    def status(self, task_id: str) -> str | None:
        state = self._get(task_id)
        return state.status if state else None

    # -- internals ---------------------------------------------------------

    def _get(self, task_id: str) -> TaskState | None:
        return self._tasks.get(task_id)

    def _mirror_status(self, state: TaskState) -> None:
        if not self._available:
            return
        payload = json.dumps(
            {"status": state.status, "phases": state.phases},
            ensure_ascii=False,
        )
        try:
            self._client.set(_TASK_PREFIX + state.norm_keyword, payload)
        except Exception:
            logger.warning(
                "task mirror write failed; degrading (in-memory only)",
                exc_info=True,
            )
            self._available = False

    def _mirror_phases(self, state: TaskState) -> None:
        self._mirror_status(state)

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass
