from app.keywords import normalize_keyword


def test_normalize_cases():
    assert normalize_keyword(" RAG  x ") == "rag x"
    assert normalize_keyword("   ") == ""
    assert normalize_keyword("rag") == "rag"
