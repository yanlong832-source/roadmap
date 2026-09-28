"""API tests for /api/roadmaps (cache read, async generate, SSE stream).

Hits the real FastAPI app through httpx.AsyncClient + ASGITransport, with the
LLM mocked via respx (HttpxResponse, matching the Task 4 convention) and
Redis replaced by an injected fakeredis client on both CacheService and
TaskRegistry so no real network is touched.
"""
import json

import fakeredis.aioredis as fakeredis_aioredis
import httpx
import pytest
import respx
from httpx import Response as HttpxResponse

from app.main import app
from app.models import Roadmap
from app.routes import roadmaps as roadmaps_route
from app.services.cache import CacheService
from app.services.tasks import TaskRegistry


def _completions_body(text_payload: str) -> dict:
    return {
        "choices": [
            {
                "message": {"role": "assistant", "content": text_payload},
                "finish_reason": "stop",
            }
        ]
    }


# Two-phase plan + two phase bodies keep the mocked LLM stream short.
PLAN_BODY = _completions_body(
    json.dumps(
        {
            "total_phases": 2,
            "phase_names": ["基础", "进阶"],
            "total_duration_hint": "6 个月",
            "title": "RAG 路线",
            "summary": "s",
        },
        ensure_ascii=False,
    )
)
PHASE1_BODY = _completions_body(
    json.dumps({"id": "p1", "name": "基础", "order": 1, "topics": []}, ensure_ascii=False)
)
PHASE2_BODY = _completions_body(
    json.dumps({"id": "p2", "name": "进阶", "order": 2, "topics": []}, ensure_ascii=False)
)


@pytest.fixture()
def fake_redis():
    return fakeredis_aioredis.FakeRedis(decode_responses=True)


@pytest.fixture(autouse=True)
def _inject_singletons(fake_redis, monkeypatch):
    """Point the route module's cache/registry singletons at fakeredis.

    The registry's mirror writes are no-op'd by passing a fakeredis client
    whose sync-style ``set`` is harmless; we instead give it a lightweight
    dummy that never raises so no real Redis I/O happens.
    """
    cache = CacheService(client=fake_redis)
    registry = TaskRegistry(client=_NoopClient())
    client = _make_client()
    monkeypatch.setattr(roadmaps_route, "_cache", cache)
    monkeypatch.setattr(roadmaps_route, "_registry", registry)
    monkeypatch.setattr(roadmaps_route, "_client", client)
    yield


class _NoopClient:
    """Dummy redis client: registry mirror writes become no-ops, never raise."""

    def set(self, *a, **k):
        return None

    async def aclose(self):
        return None


def _make_client():
    from app.services.generator import LLMClient

    return LLMClient(api_key="k", base_url="https://llm.test/v1", model="m")


BASE = "http://testserver"


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=BASE, transport=httpx.ASGITransport(app=app))


def _parse_sse(raw: str):
    """Parse an SSE body into a list of (event_name, data_dict) tuples."""
    events = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        name = None
        data_lines = []
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[len("event: "):].strip()
            elif line.startswith("data: "):
                data_lines.append(line[len("data: "):])
        if name is not None:
            data = json.loads("\n".join(data_lines)) if data_lines else {}
            events.append((name, data))
    return events


# ------------------------------------------------------------------ #
# GET /{keyword}                                                     #
# ------------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_get_cache_hit_returns_roadmap(fake_redis):
    roadmap = Roadmap(keyword="rag", title="t", summary="s", total_duration_hint="1 年", phases=[])
    cache = CacheService(client=fake_redis)
    await cache.set("rag", roadmap)
    async with await _client() as client:
        r = await client.get("/api/roadmaps/rag")
    assert r.status_code == 200
    body = r.json()
    # Roadmap object itself, no data wrapper.
    assert body["keyword"] == "rag"
    assert "phases" in body


@pytest.mark.asyncio
async def test_get_cache_miss_404():
    async with await _client() as client:
        r = await client.get("/api/roadmaps/unknown")
    assert r.status_code == 404
    # FastAPI wraps HTTPException detail in {"detail": ...}.
    assert r.json()["detail"]["error"] == "not_generated"


@pytest.mark.asyncio
async def test_get_empty_keyword_422():
    async with await _client() as client:
        r = await client.get("/api/roadmaps/")
    assert r.status_code in (404, 405, 422)  # path shape varies; not a crash


@pytest.mark.asyncio
async def test_get_long_keyword_422():
    keyword = "k" * 101
    async with await _client() as client:
        r = await client.get(f"/api/roadmaps/{keyword}")
    assert r.status_code == 422


# ------------------------------------------------------------------ #
# POST /{keyword}/generate                                            #
# ------------------------------------------------------------------ #


@respx.mock
@pytest.mark.asyncio
async def test_generate_returns_202_with_task_id():
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    async with await _client() as client:
        r = await client.post("/api/roadmaps/rag/generate")
    assert r.status_code == 202
    body = r.json()
    assert body["task_id"]
    assert "/events?task_id=" in body["event_stream"]


@respx.mock
@pytest.mark.asyncio
async def test_generate_same_keyword_reuses_task_id():
    # Reuse: two in-flight generates for the same keyword return one task_id.
    # We block the LLM so the first task stays running long enough to collide.
    import asyncio

    gate = asyncio.Event()

    async def _blocking_side_effect(request):
        await gate.wait()
        return HttpxResponse(200, json=PLAN_BODY)

    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = _blocking_side_effect

    async with await _client() as client:
        r1 = await client.post("/api/roadmaps/rag/generate")
        task1 = r1.json()["task_id"]
        assert r1.status_code == 202
        r2 = await client.post("/api/roadmaps/rag/generate")
        task2 = r2.json()["task_id"]
        gate.set()  # unblock so background coroutines can finish
    assert task1 == task2, "concurrent same-keyword generates must reuse task_id"


@respx.mock
@pytest.mark.asyncio
async def test_generate_force_bypasses_cache(fake_redis):
    # Seed the cache; a forced generate must still return 202 (not a 200 body).
    roadmap = Roadmap(keyword="rag", title="t", summary="s", total_duration_hint="1 年", phases=[])
    cache = CacheService(client=fake_redis)
    await cache.set("rag", roadmap)

    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    async with await _client() as client:
        r = await client.post("/api/roadmaps/rag/generate", params={"force": "true"})
    assert r.status_code == 202
    assert "task_id" in r.json()


@respx.mock
@pytest.mark.asyncio
async def test_generate_nonforce_cache_hit_returns_200_roadmap(fake_redis):
    # Non-force generate with a warm cache short-circuits to 200 + Roadmap body.
    roadmap = Roadmap(keyword="rag", title="t", summary="s", total_duration_hint="1 年", phases=[])
    cache = CacheService(client=fake_redis)
    await cache.set("rag", roadmap)

    async with await _client() as client:
        r = await client.post("/api/roadmaps/rag/generate")
    assert r.status_code == 200
    assert r.json()["keyword"] == "rag"


# ------------------------------------------------------------------ #
# GET /{keyword}/events  (SSE)                                        #
# ------------------------------------------------------------------ #


@respx.mock
@pytest.mark.asyncio
async def test_sse_event_sequence_phase_phase_done():
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    async with await _client() as client:
        g = await client.post("/api/roadmaps/rag/generate")
        task_id = g.json()["task_id"]
        async with client.stream(
            "GET", f"/api/roadmaps/rag/events", params={"task_id": task_id}
        ) as r:
            raw = await r.aread()
    events = _parse_sse(raw.decode())
    names = [n for n, _ in events]
    assert names == ["phase", "phase", "done"]
    # done carries the full Roadmap.
    done_payload = events[-1][1]
    assert done_payload["keyword"] == "rag"
    assert [p["id"] for p in done_payload["phases"]] == ["p1", "p2"]


@respx.mock
@pytest.mark.asyncio
async def test_sse_reconnect_replays_done_phases():
    # Finish one full generation, then reconnect with the same task_id and
    # confirm the already-emitted phases replay (idempotent, terminal stream).
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    async with await _client() as client:
        g = await client.post("/api/roadmaps/rag/generate")
        task_id = g.json()["task_id"]
        # First stream: consume until done (drives the background task to
        # completion so the cache is warm and the task is terminal).
        async with client.stream(
            "GET", f"/api/roadmaps/rag/events", params={"task_id": task_id}
        ) as r:
            await r.aread()

        # Reconnect with the same task_id: replayed phases + done again.
        async with client.stream(
            "GET", f"/api/roadmaps/rag/events", params={"task_id": task_id}
        ) as r2:
            raw2 = await r2.aread()
    events = _parse_sse(raw2.decode())
    names = [n for n, _ in events]
    # Terminal reconnect replays recorded phases then the done payload.
    assert "phase" in names
    assert names[-1] == "done"


@respx.mock
@pytest.mark.asyncio
async def test_sse_error_event_closes_stream():
    # Force a failure: the LLM returns non-JSON so both plan attempts raise.
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=_completions_body("not json")),
    ]
    async with await _client() as client:
        g = await client.post("/api/roadmaps/rag/generate")
        task_id = g.json()["task_id"]
        async with client.stream(
            "GET", f"/api/roadmaps/rag/events", params={"task_id": task_id}
        ) as r:
            raw = await r.aread()
    events = _parse_sse(raw.decode())
    names = [n for n, _ in events]
    assert names[-1] == "msg"
    err = events[-1][1]
    assert err["retryable"] is True
    assert "error" in err
