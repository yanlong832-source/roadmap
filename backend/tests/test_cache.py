import json

import fakeredis.aioredis as fakeredis_aioredis
import pytest

from app.models import Phase, Roadmap
from app.services.cache import CacheService


def _sample_roadmap() -> Roadmap:
    return Roadmap(
        keyword="rag",
        title="RAG Roadmap",
        summary="s",
        total_duration_hint="1 年",
        phases=[Phase(id="p1", name="基础", order=1, topics=[])],
    )


@pytest.fixture()
def fake_redis():
    return fakeredis_aioredis.FakeRedis(decode_responses=True)


@pytest.mark.asyncio
async def test_cache_roundtrip(fake_redis):
    svc = CacheService(client=fake_redis)
    await svc.set("rag", _sample_roadmap())
    assert svc.available is True
    hit = await svc.get("rag")
    assert hit is not None
    assert hit.keyword == "rag"
    assert hit.phases[0].name == "基础"


@pytest.mark.asyncio
async def test_cache_miss_returns_none(fake_redis):
    svc = CacheService(client=fake_redis)
    assert await svc.get("unknown") is None


@pytest.mark.asyncio
async def test_corrupted_value_returns_none(fake_redis):
    svc = CacheService(client=fake_redis)
    fake_redis.set("roadmap:broken", "{not valid json")
    assert await svc.get("broken") is None


class _Boom:
    """Client that raises on every call - simulates connection failure."""

    def __init__(self):
        self.available = False
        self.set_calls = 0

    async def get(self, *a, **k):
        raise ConnectionError("boom")

    async def set(self, *a, **k):
        self.set_calls += 1
        raise ConnectionError("boom")


@pytest.mark.asyncio
async def test_degraded_client_set_does_not_raise():
    boom = _Boom()
    svc = CacheService(client=boom)
    await svc.set("k", _sample_roadmap())  # must not raise
    assert boom.set_calls == 1
    assert svc.available is False


@pytest.mark.asyncio
async def test_ttl_set_on_write(fake_redis):
    svc = CacheService(client=fake_redis)
    await svc.set("rag", _sample_roadmap())
    ttl = await fake_redis.ttl("roadmap:rag")
    assert ttl > 0 and ttl <= 7 * 24 * 3600
