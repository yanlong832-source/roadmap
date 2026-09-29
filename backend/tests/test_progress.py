"""Tests for the per-topic learning-state progress store + REST API.

Pattern follows tests/test_cache.py (graceful degradation via a raising
fake client) and tests/test_roadmaps_api.py (ASGITransport + fakeredis).
"""
import json

import fakeredis.aioredis as fakeredis_aioredis
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.progress import (
    ProgressStore,
    compute_fingerprint,
)




def test_fingerprint_is_deterministic_12hex():
    a = compute_fingerprint("rag", "基础", "向量数据库入门")
    b = compute_fingerprint("rag", "基础", "向量数据库入门")
    assert a == b
    assert len(a) == 12
    assert all(ch in "0123456789abcdef" for ch in a)


def test_fingerprint_changes_when_title_changes():
    x = compute_fingerprint("rag", "基础", "向量数据库入门")
    y = compute_fingerprint("rag", "基础", "向量数据库进阶")
    assert x != y


def test_fingerprint_matches_node_vector():
    # Pinned cross-language vector (Task 4). Generated via node crypto:
    # sha1("rag|基础|向量数据库入门").digest("hex").slice(0,12)
    assert compute_fingerprint("rag", "基础", "向量数据库入门") == "fccf4d91a6cd"

# All four vectors from frontend/src/layout/fingerprintVectors.ts (source of
# truth; this test pins the backend implementation against the same
# ground truth that the frontend sha1Hex is verified against).
_CROSS_LANG_VECTORS = [
    ("rag", "基础", "向量数据库入门", "fccf4d91a6cd"),
    ("git", "进阶", "rebase 与合并", "596405d2b10d"),
    ("rag", "阶段1", "大模型推理基础", "904967a6a0b7"),
    ("健身", "初级", "深蹲动作要领", "ed4ca58b0bb2"),
]


def test_fingerprint_matches_all_node_vectors():
    """Cross-language check: every vector in fingerprintVectors.ts."""
    for kw, phase_name, title, expected in _CROSS_LANG_VECTORS:
        assert compute_fingerprint(kw, phase_name, title) == expected, (
            f"vector {kw}|{phase_name}|{title} mismatch"
        )



@pytest.fixture()
def fake_redis():
    return fakeredis_aioredis.FakeRedis(decode_responses=True)


class _Boom:
    """Client that raises on every call - simulates connection failure."""

    def __init__(self):
        self.hgetall_calls = 0
        self.hset_calls = 0

    async def hgetall(self, *a, **k):
        self.hgetall_calls += 1
        raise ConnectionError("boom")

    async def hset(self, *a, **k):
        self.hset_calls += 1
        raise ConnectionError("boom")


@pytest.mark.asyncio
async def test_store_roundtrip(fake_redis):
    store = ProgressStore(client=fake_redis)
    await store.set_statuses("rag", {"abc123def456": "done"})
    got = await store.get_statuses("rag")
    assert got == {"abc123def456": "done"}


@pytest.mark.asyncio
async def test_store_unknown_keyword_returns_empty(fake_redis):
    store = ProgressStore(client=fake_redis)
    assert await store.get_statuses("nope") == {}


@pytest.mark.asyncio
async def test_store_partial_update_keeps_old_fields(fake_redis):
    store = ProgressStore(client=fake_redis)
    await store.set_statuses("rag", {"f1": "in_progress"})
    await store.set_statuses("rag", {"f2": "done"})
    got = await store.get_statuses("rag")
    assert got == {"f1": "in_progress", "f2": "done"}


@pytest.mark.asyncio
async def test_degraded_client_does_not_raise():
    boom = _Boom()
    store = ProgressStore(client=boom)
    assert await store.get_statuses("rag") == {}
    await store.set_statuses("rag", {"f1": "done"})  # must not raise
    assert boom.hgetall_calls >= 1
    # After the first failure the store is degraded, so set_statuses
    # short-circuits before touching redis (hset must never be called).
    assert boom.hset_calls == 0
    assert store.available is False




@pytest.mark.asyncio
async def test_api_get_unknown_keyword_returns_empty_status_map():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.get("/api/progress/unknown")
    assert res.status_code == 200
    assert res.json() == {"statuses": {}}


@pytest.mark.asyncio
async def test_api_post_then_get_echoes(fake_redis):
    # Wire the app's ProgressStore to the fake redis so post/get round-trip.
    import app.routes.progress as progress_routes

    progress_routes._store = ProgressStore(client=fake_redis)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            fp = "fccf4d91a6cd"
            post = await client.post(
                "/api/progress/rag", json={"updates": {fp: "in_progress"}}
            )
            assert post.status_code == 200
            assert post.json() == {"ok": True}

            got = await client.get("/api/progress/rag")
            assert got.status_code == 200
            assert got.json() == {"statuses": {fp: "in_progress"}}
    finally:
        progress_routes._store = None


@pytest.mark.asyncio
async def test_api_post_invalid_status_is_422():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.post(
            "/api/progress/rag", json={"updates": {"abc123def456": "bogus"}}
        )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_api_empty_keyword_is_422():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.get("/api/progress/%20%20")
    assert res.status_code == 422
"""Tests for the per-topic learning-state progress store + REST API.

Pattern follows tests/test_cache.py (graceful degradation via a raising
fake client) and tests/test_roadmaps_api.py (ASGITransport + fakeredis).
"""
import json

import fakeredis.aioredis as fakeredis_aioredis
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.progress import (
    ProgressStore,
    compute_fingerprint,
)


