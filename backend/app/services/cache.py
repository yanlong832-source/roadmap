"""Redis-backed roadmap cache with graceful degradation.

The cache is an optimization, not a correctness dependency (spec section 6):
every redis failure is swallowed, `available` flips to False, and callers
continue without caching. Corrupted cached payloads are treated as misses.
"""
from __future__ import annotations

import logging
from typing import Any

import redis.asyncio as aioredis

from app.models import Roadmap

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 7 * 24 * 3600  # spec: TTL 7 days
_KEY_PREFIX = "roadmap:"


class CacheService:
    def __init__(
        self,
        redis_url: str = "redis://localhost:6379/0",
        client: Any | None = None,
    ) -> None:
        self._client = client if client is not None else aioredis.from_url(redis_url, decode_responses=True)
        self.available: bool = True

    def key(self, norm_keyword: str) -> str:
        return f"{_KEY_PREFIX}{norm_keyword}"

    async def get(self, norm_keyword: str) -> Roadmap | None:
        if not self.available:
            return None
        try:
            raw = await self._client.get(self.key(norm_keyword))
        except Exception:
            logger.warning("cache get failed; degrading (no-cache mode)", exc_info=True)
            self.available = False
            return None
        if raw is None:
            return None
        try:
            return Roadmap.model_validate_json(raw)
        except Exception:
            logger.warning("cache payload for %s is corrupted; treating as miss", norm_keyword)
            return None

    async def set(self, norm_keyword: str, roadmap: Roadmap) -> None:
        if not self.available:
            return
        try:
            await self._client.set(self.key(norm_keyword), roadmap.model_dump_json(), ex=CACHE_TTL_SECONDS)
        except Exception:
            logger.warning("cache set failed; degrading (no-cache mode)", exc_info=True)
            self.available = False

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass
