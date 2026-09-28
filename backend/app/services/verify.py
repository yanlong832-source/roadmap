"""Post-generation resource verification.

After the LLM produces a Phase, we fetch every resource URL with a
short HTTP timeout:

- HTTP 404 / 451 / 403 / 401 / 5xx  -> drop the resource (the LLM
  hallucinated a link that does not exist or is not reachable).
- Any other status (200, 3xx, 400, 406, ...) -> keep it.

The Bilibili check is intentionally lenient: Bilibili returns a
specific "video does not exist" page for dead BV ids, but that page
is still HTTP 200.  We therefore also do a lightweight content
probe -- if the page contains the known dead-video markers we drop
the resource; otherwise we trust the 200.

Dropped resources are logged so the operator can audit what the LLM
got wrong.  The Phase is re-saved with the filtered topic resources.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field

import httpx

from app.models import Phase, Resource

logger = logging.getLogger(__name__)

# Bilibili dead-video markers (the page returns 200 but says "video
# does not exist" or redirects to the search page).
_BILI_DEAD_MARKERS = (
    "视频不见了",
    "稿件不存在",
    "视频已删除",
    "404",
)

# HTTP status codes that mean "this resource is not reachable / gone".
_DEAD_STATUS = frozenset({401, 403, 404, 410, 451, 500, 502, 503, 504})

# A single resource fetch must not block generation for long.
_VERIFY_TIMEOUT_SECONDS = float(os.getenv("VERIFY_TIMEOUT", "6"))

# Cap concurrent checks per phase so a huge topic list cannot stall
# the pipeline.
_MAX_PARALLEL = 8


@dataclass
class VerificationReport:
    """Per-phase outcome of the URL probe pass."""

    kept: int = 0
    dropped: list[Resource] = field(default_factory=list)


def _is_dead_bilibili(url: str, page: str) -> bool:
    """Heuristic: does this Bilibili page look like a dead video?

    We only probe the body for known dead-video markers.  Bilibili
    returns 200 for missing videos, so a pure status check is not
    enough.  The markers are deliberately a small, conservative set
    -- a false positive (dropping a live video) is less harmful than
    a false negative (keeping a dead link the user will click).
    """
    if not url.startswith("https://www.bilibili.com/video/") and not url.startswith(
        "https://b23.tv/"
    ):
        return False
    lowered = page[:8000]  # only inspect the head of the page
    for marker in _BILI_DEAD_MARKERS:
        if marker in lowered:
            return True
    return False


async def _probe_resource(
    resource: Resource, client: httpx.AsyncClient
) -> bool:
    """Return True if the resource looks alive, False otherwise."""
    try:
        response = await client.get(
            resource.url,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (roadmap-verify)"},
        )
    except httpx.HTTPError:
        # Network / DNS / timeout -- we cannot prove the link is dead,
        # but we also cannot prove it is alive.  Keep it (the LLM
        # usually at least gets the domain right) and log a warning.
        logger.warning("verify: fetch failed for %s (%s)", resource.url, "transport")
        return True

    if response.status_code in _DEAD_STATUS:
        logger.warning(
            "verify: dropping %s (HTTP %d) -- %s",
            resource.url,
            response.status_code,
            resource.title,
        )
        return False

    if resource.type == "bilibili" and _is_dead_bilibili(resource.url, response.text):
        logger.warning(
            "verify: dropping %s (Bilibili dead-video marker found) -- %s",
            resource.url,
            resource.title,
        )
        return False

    return True


async def verify_phase_resources(phase: Phase) -> Phase:
    """Probe every resource URL in the phase, drop the dead ones.

    Returns the (possibly mutated) Phase.  Topics with zero surviving
    resources keep their empty list -- the schema allows that.  The
    caller is responsible for persisting the result.
    """
    resources: list[Resource] = []
    for topic in phase.topics:
        resources.extend(topic.resources)

    if not resources:
        return phase

    # Probe in bounded batches.
    report = VerificationReport()
    alive_flags: list[bool] = [True] * len(resources)
    for i in range(0, len(resources), _MAX_PARALLEL):
        batch = resources[i : i + _MAX_PARALLEL]
        async with httpx.AsyncClient(
            timeout=_VERIFY_TIMEOUT_SECONDS,
            limits=httpx.Limits(max_connections=_MAX_PARALLEL),
        ) as client:
            results = list(
                await asyncio.gather(*(_probe_resource(r, client) for r in batch))
            )
        for j, ok in enumerate(results):
            idx = i + j
            alive_flags[idx] = ok
            if not ok:
                report.dropped.append(resources[idx])
        report.kept += sum(1 for ok in results if ok)

    if not report.dropped:
        return phase

    # Rewrite topic resources with only the survivors.
    cursor = 0
    for topic in phase.topics:
        original_count = len(topic.resources)
        survivors = [
            r
            for r, keep in zip(topic.resources, alive_flags[cursor : cursor + original_count])
            if keep
        ]
        topic.resources = survivors
        cursor += original_count

    logger.info(
        "verify: phase %s -- kept %d, dropped %d",
        phase.id,
        report.kept,
        len(report.dropped),
    )
    return phase

