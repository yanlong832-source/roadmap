"""Unit tests for app.services.verify (resource URL probing)."""
from __future__ import annotations

import httpx
import pytest

from app.models import Phase, Resource, Topic
from app.services.verify import (
    _DEAD_STATUS,
    _is_dead_bilibili,
    verify_phase_resources,
)


def _make_phase(url: str, resource_type: str = "bilibili") -> Phase:
    resource = Resource(title="test", url=url, type=resource_type)  # type: ignore[arg-type]
    topic = Topic(
        id="t1",
        phase_id="p1",
        title="topic",
        description="d",
        duration_hint="1w",
        resources=[resource],
    )
    return Phase(id="p1", name="phase", order=1, topics=[topic])


def test_is_dead_bilibili_markers() -> None:
    # Non-bilibili URLs never count as "dead bilibili".
    assert _is_dead_bilibili("https://example.com", "视频不见了") is False
    # Bilibili with a dead marker in the head of the page.
    assert _is_dead_bilibili("https://www.bilibili.com/video/BVxxxx", "视频不见了") is True
    # Bilibili with a clean page.
    assert _is_dead_bilibili("https://www.bilibili.com/video/BVreal", "<html>ok</html>") is False
    # b23.tv short links also go through the bilibili check.
    assert _is_dead_bilibili("https://b23.tv/abc", "稿件不存在") is True


def _patch_get(monkeypatch, response_factory) -> None:
    """Patch httpx.AsyncClient.get to return a canned response.

    The patched function is a *bound* method, so the first positional
    argument is `self`.  We accept it and ignore it.
    """
    async def fake_get(self, url, **kwargs):
        return response_factory(url)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)


@pytest.mark.asyncio
async def test_verify_drops_404(monkeypatch) -> None:
    _patch_get(monkeypatch, lambda url: httpx.Response(404, text="not found"))
    phase = _make_phase("https://dead.example.com/page")
    await verify_phase_resources(phase)
    assert phase.topics[0].resources == []


@pytest.mark.asyncio
async def test_verify_keeps_200(monkeypatch) -> None:
    _patch_get(monkeypatch, lambda url: httpx.Response(200, text="<html>ok</html>"))
    phase = _make_phase("https://live.example.com/page")
    await verify_phase_resources(phase)
    assert len(phase.topics[0].resources) == 1


@pytest.mark.asyncio
async def test_verify_drops_dead_bilibili(monkeypatch) -> None:
    def factory(url):
        # Bilibili returns 200 even for dead videos; the marker check
        # must catch it.
        return httpx.Response(200, text="<html>视频不见了</html>")

    _patch_get(monkeypatch, factory)
    phase = _make_phase("https://www.bilibili.com/video/BVfake1234")
    await verify_phase_resources(phase)
    assert phase.topics[0].resources == []


@pytest.mark.asyncio
async def test_verify_keeps_alive_bilibili(monkeypatch) -> None:
    _patch_get(
        monkeypatch,
        lambda url: httpx.Response(200, text="<html>Transformer 原理</html>"),
    )
    phase = _make_phase("https://www.bilibili.com/video/BVreal9999")
    await verify_phase_resources(phase)
    assert len(phase.topics[0].resources) == 1


@pytest.mark.asyncio
async def test_verify_keeps_on_transport_error(monkeypatch) -> None:
    def factory(url):
        raise httpx.ConnectError("dns fail")

    _patch_get(monkeypatch, factory)
    phase = _make_phase("https://flaky.example.com/page")
    await verify_phase_resources(phase)
    # We cannot prove the link is dead; keep it.
    assert len(phase.topics[0].resources) == 1


def test_dead_status_set() -> None:
    assert 404 in _DEAD_STATUS
    assert 500 in _DEAD_STATUS
    assert 200 not in _DEAD_STATUS
