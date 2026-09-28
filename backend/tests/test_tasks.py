"""Tests for the TaskRegistry: subscribe/unsubscribe + SSE event broadcast.

Covers the plan Task 5 contract:
- push_phase / mark_done / mark_error each put an (name, payload) tuple on
  every subscriber queue for that task.
- terminal states (done / error) push a None sentinel after the terminal event.
- register() reuses an in-flight task_id for the same normalized keyword.
- in_flight() reflects live running tasks.
"""
import asyncio

import pytest

from app.models import Phase
from app.services.tasks import TaskRegistry


@pytest.fixture()
def registry() -> TaskRegistry:
    # client=None would build a real redis client; use a dummy that no-ops so
    # no network is touched. The registry degrades gracefully (available flag
    # stays True; mirror writes swallow exceptions).
    class _NoopClient:
        async def aclose(self):
            return None
        def set(self, *a, **k):
            # Sync no-op so mirror writes are harmless.
            return None

    return TaskRegistry(client=_NoopClient())


def _phase(order: int = 1) -> Phase:
    return Phase(id=f"p{order}", name=f"Phase {order}", order=order, topics=[])


@pytest.mark.asyncio
async def test_push_phase_broadcasts_to_subscriber(registry):
    task_id = registry.register("rag")
    queue: asyncio.Queue = asyncio.Queue()
    registry.subscribe(task_id, queue)

    registry.push_phase(task_id, _phase(1), index=1, total=2)

    name, payload = queue.get_nowait()
    assert name == "phase"
    assert payload["id"] == "p1"
    assert payload["index"] == 1
    assert payload["total"] == 2
    # No sentinel yet (task still running).
    assert queue.empty()


@pytest.mark.asyncio
async def test_done_broadcasts_full_payload_then_sentinel(registry):
    task_id = registry.register("rag")
    queue: asyncio.Queue = asyncio.Queue()
    registry.subscribe(task_id, queue)

    full_roadmap = {"keyword": "rag", "title": "RAG", "phases": []}
    registry.mark_done(task_id, full_roadmap)

    name, payload = queue.get_nowait()
    assert name == "done"
    assert payload == full_roadmap
    # Sentinel closes the stream.
    assert queue.get_nowait() is None
    assert queue.empty()


@pytest.mark.asyncio
async def test_error_broadcasts_retryable_then_sentinel(registry):
    task_id = registry.register("rag")
    queue: asyncio.Queue = asyncio.Queue()
    registry.subscribe(task_id, queue)

    registry.mark_error(task_id, "llm blew up")

    name, payload = queue.get_nowait()
    assert name == "error"
    assert payload == {"error": "llm blew up", "retryable": True}
    assert queue.get_nowait() is None
    assert queue.empty()


@pytest.mark.asyncio
async def test_broadcast_reaches_all_subscribers(registry):
    task_id = registry.register("rag")
    q1: asyncio.Queue = asyncio.Queue()
    q2: asyncio.Queue = asyncio.Queue()
    registry.subscribe(task_id, q1)
    registry.subscribe(task_id, q2)

    registry.push_phase(task_id, _phase(1), index=1, total=1)

    assert q1.get_nowait() == ("phase", {"id": "p1", "name": "Phase 1", "order": 1, "topics": [], "index": 1, "total": 1})
    assert q2.get_nowait() == ("phase", {"id": "p1", "name": "Phase 1", "order": 1, "topics": [], "index": 1, "total": 1})


@pytest.mark.asyncio
async def test_unsubscribe_stops_receiving(registry):
    task_id = registry.register("rag")
    q1: asyncio.Queue = asyncio.Queue()
    q2: asyncio.Queue = asyncio.Queue()
    registry.subscribe(task_id, q1)
    registry.subscribe(task_id, q2)
    registry.unsubscribe(task_id, q2)

    registry.push_phase(task_id, _phase(1), index=1, total=1)

    assert not q1.empty()
    assert q2.empty()


def test_register_reuses_in_flight_task(registry):
    first = registry.register("rag")
    # Same normalized keyword while the first is still running -> reuse.
    second = registry.register("rag")
    assert first == second


def test_register_new_task_after_done(registry):
    done_id = registry.register("rag")
    registry.mark_done(done_id, {})
    # Same keyword now starts a brand-new task.
    new_id = registry.register("rag")
    assert new_id != done_id


def test_in_flight_counts_running_only(registry):
    assert registry.in_flight() == 0
    a = registry.register("rag")
    b = registry.register("guitar")
    assert registry.in_flight() == 2
    registry.mark_done(a, {})
    assert registry.in_flight() == 1
    registry.mark_error(b, "boom")
    assert registry.in_flight() == 0
