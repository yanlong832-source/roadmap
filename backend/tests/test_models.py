from app.models import Phase, Resource, Roadmap, Topic


def test_roadmap_full_shape():
    r = Roadmap(
        keyword="rag",
        title="t",
        summary="s",
        total_duration_hint="1 年",
        phases=[
            Phase(
                id="p1",
                name="基础",
                order=1,
                topics=[
                    Topic(
                        id="p1t1",
                        phase_id="p1",
                        title="向量检索",
                        description="d",
                        duration_hint="2 周",
                        resources=[
                            Resource(title="b", url="https://b23.tv/x", type="bilibili")
                        ],
                    )
                ],
            )
        ],
    )
    assert r.model_dump_json()  # serializable


def test_resource_type_rejects_unknown():
    import pytest

    from app.models import Resource

    with pytest.raises(ValueError):
        Resource(title="x", url="https://example.com", type="youtube")
