"""Redis-backed per-topic learning-state store with graceful degradation.

Pattern mirrors app/services/cache.py: every redis failure is swallowed,
`available` flips to False, and callers continue without persistence
(GET degrades to an empty map, POST becomes a no-op).

Storage layout: a hash per normalized keyword
    key   progress:{norm_keyword}
    field <12-hex topic fingerprint>
    value JSON {"status": str, "updated_at": iso-8601}
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

_KEY_PREFIX = "progress:"

# The only values the status field may take; the API validates against
# this set (POST body is a dict of fingerprint -> Literal status).
VALID_STATUSES = ("not_started", "in_progress", "done")


def compute_fingerprint(norm_keyword: str, phase_name: str, topic_title: str) -> str:
    """First 12 hex chars of sha1(norm_keyword + "|" + phase_name + "|" + topic_title).

    MUST match the dependency-free TypeScript implementation on the
    frontend (Global Constraints). The pipe-joined, lowercased-keyword
    input is the shared contract; see Task 4 cross-language vectors.
    """
    payload = f"{norm_keyword}|{phase_name}|{topic_title}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


class ProgressStore:
    """In-memory-free progress store on top of a Redis hash."""

    def __init__(
        self,
        redis_url: str = "redis://localhost:6379/0",
        client: Any | None = None,
    ) -> None:
        self._client = (
            client
            if client is not None
            else aioredis.from_url(redis_url, decode_responses=True)
        )
        self.available: bool = True

    def _key(self, norm_keyword: str) -> str:
        return f"{_KEY_PREFIX}{norm_keyword}"

    async def get_statuses(self, norm_keyword: str) -> dict[str, str]:
        """{fingerprint: status}. {} when the keyword is unknown or redis is down."""
        if not self.available:
            return {}
        try:
            raw = await self._client.hgetall(self._key(norm_keyword))
        except Exception:
            logger.warning(
                "progress get_statuses failed; degrading (no-persistence mode)",
                exc_info=True,
            )
            self.available = False
            return {}
        out: dict[str, str] = {}
        for fp, value in raw.items():
            try:
                out[fp] = json.loads(value)["status"]
            except Exception:
                # Corrupted field -> treat as missing rather than crash.
                logger.warning(
                    "progress field %s is corrupted; ignoring", fp, exc_info=True
                )
        return out

    async def set_statuses(
        self, norm_keyword: str, updates: dict[str, str]
    ) -> None:
        """Merge status updates into the keyword's hash. No-op when degraded."""
        if not self.available or not updates:
            return
        now = datetime.now(timezone.utc).isoformat()
        fields = {
            fp: json.dumps({"status": status, "updated_at": now})
            for fp, status in updates.items()
        }
        try:
            await self._client.hset(self._key(norm_keyword), mapping=fields)
        except Exception:
            logger.warning(
                "progress set_statuses failed; degrading (no-persistence mode)",
                exc_info=True,
            )
            self.available = False

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass
