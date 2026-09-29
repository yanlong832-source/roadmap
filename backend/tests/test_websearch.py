from app.services.websearch import (
    _is_corroborated,
    _parse_ddg_html,
    enrich_resources_with_search,
    search_fallback_url,
)


def test_search_fallback_url_encodes_query():
    url = search_fallback_url("RAG 检索")
    assert url.startswith("https://search.bilibili.com/all?keyword=")
    assert "RAG" in url


def test_search_fallback_url_is_always_corroborated():
    url = search_fallback_url("任意关键词")
    assert _is_corroborated(url, set(), "", "任意关键词") is True


def test_corroborated_by_shared_host():
    hosts = {"milvus.io"}
    assert _is_corroborated("https://milvus.io/docs/x", hosts, "", "向量数据库")
    assert _is_corroborated("https://www.milvus.io/docs", hosts, "", "向量数据库")
    assert not _is_corroborated("https://example.com/x", hosts, "", "向量数据库")


def test_uncorroborated_resource_downgraded_to_fallback():
    resources = [
        {"title": "RAG 原理", "url": "https://unknown-guru.example/rag", "type": "doc"},
        {"title": "Milvus 文档", "url": "https://milvus.io/docs/overview.md", "type": "doc"},
    ]
    ddg = [
        {"title": "Milvus - Vector Database", "url": "https://milvus.io", "snippet": ""},
        {"title": "RAG 教程", "url": "https://example.org/rag", "snippet": ""},
    ]
    enriched = enrich_resources_with_search("RAG 原理", resources, ddg_results=ddg)
    downgraded = enriched[0]
    assert downgraded.get("_search_fallback") is True
    assert downgraded["url"].startswith("https://search.bilibili.com/")
    # The corroborated resource is kept as-is
    assert "_search_fallback" not in enriched[1]


def test_parse_ddg_html_extracts_results():
    html = """
    <div class="result results_links results_links_deep web-result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmilvus.io%2Fdocs&rut=1">Milvus Official</a>
      <a class="result__snippet" href="#">A vector database...</a>
    </div>
    <div class="result results_links results_links_deep web-result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fmilvus&rut=2">GitHub - Milvus</a>
    </div>
    """
    results = _parse_ddg_html(html, 5)
    assert len(results) == 2
    assert results[0]["url"] == "https://milvus.io/docs"
    assert results[1]["url"] == "https://github.com/milvus"


def test_parse_ddg_html_empty_when_no_results():
    assert _parse_ddg_html("<html><body>no results</body></html>", 5) == []


def test_enrich_empty_resources_is_noop():
    assert enrich_resources_with_search("x", [], ddg_results=[]) == []
