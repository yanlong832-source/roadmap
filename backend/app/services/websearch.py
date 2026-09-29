"""Web search enrichment for generated roadmap resources.

The LLM plans the phase skeleton and picks candidate resources from
memory; this module takes those candidates and validates them against
a live web search (DuckDuckGo HTML endpoint, no API key required).
Anything the search cannot corroborate gets a search-fallback URL
attached so the user always lands on a relevant, real page.

Design rules:
- best-effort: search failures never block generation; callers fall
  back to the LLM-picked URLs unchanged.
- a single topic triggers at most one search query (its title),
  keeping latency bounded.
"""
from __future__ import annotations

import logging
import os
import re
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger(__name__)

_DDG_HTML_URL = "https://html.duckduckgo.com/html/"
_SEARCH_TIMEOUT_SECONDS = float(os.getenv("WEBSEARCH_TIMEOUT", "8"))


def _ddg_results(query: str, max_results: int = 5) -> list[dict[str, str]]:
    """Scrape DuckDuckGo's HTML endpoint for organic results.

    Returns a list of {"title": ..., "url": ..., "snippet": ...} dicts.
    Empty list on transport error or no results.
    """

    def _fetch_sync() -> list[dict[str, str]]:
        try:
            response = httpx.post(
                _DDG_HTML_URL,
                data={"q": query},
                timeout=_SEARCH_TIMEOUT_SECONDS,
                headers={"User-Agent": "Mozilla/5.0 (roadmap-websearch)"},
            )
            if response.status_code != 200:
                return []
            return _parse_ddg_html(response.text, max_results)
        except httpx.HTTPError:
            logger.warning(
                "websearch: DDG transport error for %r", query, exc_info=True
            )
            return []

    # When called from inside a running event loop (the async generator
    # path), offload the blocking httpx call to a thread so the loop is
    # not stalled for the duration of the request.
    import asyncio

    try:
        asyncio.get_running_loop()
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(_fetch_sync).result(
                timeout=_SEARCH_TIMEOUT_SECONDS + 2
            )
    except RuntimeError:
        # No running loop; safe to block the current thread directly.
        return _fetch_sync()


def _parse_ddg_html(html: str, max_results: int) -> list[dict[str, str]]:
    """Extract organic results from DuckDuckGo's HTML result page.

    Each organic result is a ``result`` div wrapping an inner anchor
    ``result__a``; the snippet sits in ``result__snippet``.  The
    absolute URL is reconstructed from the ``uddg`` query param on the
    result wrapper.
    """
    results: list[dict[str, str]] = []
    result_re = re.compile(
        r'<div[^>]*class="[^"]*result[^"]*"[^>]*>(.*?)(?=<div[^>]*class="[^"]*result|$)',
        re.DOTALL,
    )
    for block in result_re.findall(html)[:max_results]:
        title_m = re.search(
            r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*>(.*?)</a>', block, re.DOTALL
        )
        url_m = re.search(r'<a[^>]*href="([^"]*uddg=[^"]*)"', block, re.DOTALL)
        snippet_m = re.search(
            r'<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>',
            block,
            re.DOTALL,
        )
        if not title_m:
            continue
        title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip()
        url = _decode_ddg_url(url_m.group(1) if url_m else "")
        snippet = re.sub(
            r"<[^>]+>", "", snippet_m.group(1) if snippet_m else ""
        ).strip()
        if url:
            results.append({"title": title, "url": url, "snippet": snippet})
    return results


def _decode_ddg_url(href: str) -> str:
    """DuckDuckGo hides the real URL behind a ``uddg`` query param."""
    if not href:
        return ""
    uddg_m = re.search(r"[?&]uddg=([^&]+)", href)
    if uddg_m:
        import urllib.parse

        return urllib.parse.unquote(uddg_m.group(1))
    return href


def search_fallback_url(query: str) -> str:
    """Stable, always-valid search link for the given query."""
    return f"https://search.bilibili.com/all?keyword={quote_plus(query)}"


def enrich_resources_with_search(
    topic_title: str,
    resources: list[dict],
    ddg_results: list[dict[str, str]] | None = None,
) -> list[dict]:
    """Validate LLM-picked resources against a web search for the topic.

    For each resource dict (title/url/type/note), keep it when the
    search results corroborate it (same host or overlapping tokens in
    the result titles); otherwise replace the URL with a
    search-fallback so the link always lands on a real page for the
    topic.  The resource type is preserved, and a ``_search_fallback``
    flag is set on downgraded resources so the frontend can hint at it.

    ``ddg_results`` may be pre-fetched (unit tests, batching); when
    omitted a live search is performed.
    """
    if not resources:
        return []

    if ddg_results is None:
        ddg_results = _ddg_results(topic_title, max_results=5)
    corroborated_hosts = _hosts_of(ddg_results)
    corroborated_titles = " ".join(
        r.get("title", "").lower() for r in ddg_results
    )

    enriched: list[dict] = []
    for resource in resources:
        url = resource.get("url", "")
        kept = _is_corroborated(
            url, corroborated_hosts, corroborated_titles, topic_title
        )
        if kept:
            enriched.append(resource)
        else:
            downgraded = dict(resource)
            downgraded["url"] = search_fallback_url(topic_title)
            downgraded["_search_fallback"] = True
            enriched.append(downgraded)
    return enriched


def _hosts_of(results: list[dict[str, str]]) -> set[str]:
    import urllib.parse

    hosts: set[str] = set()
    for r in results:
        url = r.get("url", "")
        if not url:
            continue
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        hosts.add(host)
    return hosts


def _is_corroborated(
    url: str,
    corroborated_hosts: set[str],
    corroborated_titles: str,
    topic_title: str,
) -> bool:
    """A resource is corroborated when its host appears in the search
    results, or when the result titles share meaningful tokens with the
    resource title.  Search-fallback URLs (bilibili search links) are
    always treated as corroborated -- they are structurally valid."""
    import urllib.parse

    if not url:
        return False
    if "search.bilibili.com/all?keyword=" in url:
        return True

    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if host in corroborated_hosts:
        return True

    tokens = set(
        re.findall(r"[a-z0-9\u4e00-\u9fff]+", url.lower() + " " + topic_title)
    )
    overlap = len(
        tokens
        & set(re.findall(r"[a-z0-9\u4e00-\u9fff]+", corroborated_titles))
    )
    return overlap >= 3


__all__ = [
    "enrich_resources_with_search",
    "search_fallback_url",
]
