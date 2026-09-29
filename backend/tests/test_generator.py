import json

from httpx import Response as HttpxResponse

import pytest
import respx

from app.models import Phase
from app.services import generator
from app.services.generator import LLMClient, LLMError, generate_phases


def _completions_body(text_payload: str) -> dict:
    return {
        "choices": [
            {
                "message": {"role": "assistant", "content": text_payload},
                "finish_reason": "stop",
            }
        ]
    }


PLAN_BODY = _completions_body(
    json.dumps(
        {
            "total_phases": 2,
            "phase_names": ["基础", "进阶"],
            "total_duration_hint": "6 个月",
            "title": "RAG 路线",
            "summary": "s",
        },
        ensure_ascii=False,
    )
)
PHASE1_BODY = _completions_body(
    json.dumps(
        {"id": "p1", "name": "基础", "order": 1, "topics": []},
        ensure_ascii=False,
    )
)
PHASE2_BODY = _completions_body(
    json.dumps(
        {"id": "p2", "name": "进阶", "order": 2, "topics": []},
        ensure_ascii=False,
    )
)


def make_client() -> LLMClient:
    return LLMClient(api_key="k", base_url="https://llm.test/v1", model="m")


@pytest.mark.asyncio
@respx.mock
async def test_generate_phases_happy_path():
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    phases = [p async for p in generate_phases(make_client(), "rag")]
    assert len(phases) == 2
    assert all(isinstance(p, Phase) for p in phases)
    assert [p.id for p in phases] == ["p1", "p2"]
    assert route.call_count == 3


@pytest.mark.asyncio
@respx.mock
async def test_markdown_fences_stripped():
    fenced = _completions_body("```json\n" + json.dumps({"id": "p1", "name": "基础", "order": 1, "topics": []}) + "\n```")
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=fenced),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    phases = [p async for p in generate_phases(make_client(), "rag")]
    assert phases[0].id == "p1"


@pytest.mark.asyncio
@respx.mock
async def test_bad_json_retried_once_then_raises():
    bad = HttpxResponse(200, json=_completions_body("this is not json"))
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        bad,
        bad,
        bad,  # 3 attempts, all bad -> LLMError
    ]
    with pytest.raises(LLMError):
        [p async for p in generate_phases(make_client(), "rag")]
    # plan(1) + 3 phase attempts
    assert route.call_count == 4


@pytest.mark.asyncio
@respx.mock
async def test_retry_recovers_on_second_attempt():
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=PLAN_BODY),
        HttpxResponse(200, json=_completions_body("garbage")),
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    phases = [p async for p in generate_phases(make_client(), "rag")]
    assert [p.id for p in phases] == ["p1", "p2"]


@pytest.mark.asyncio
@respx.mock
async def test_http_error_raises_llmerror():
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(500, text="boom"),
        HttpxResponse(500, text="boom"),
        HttpxResponse(500, text="boom"),
    ]
    with pytest.raises(LLMError):
        [p async for p in generate_phases(make_client(), "rag")]
    # plan retried 3 times, all failing -> LLMError before any phase
    assert route.call_count == 3


@pytest.mark.asyncio
@respx.mock
async def test_plan_empty_content_retried_then_recovers():
    """Regression: empty content on the plan call used to kill the whole
    generation with `json.loads` failing on '' before any retry happened."""
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=_completions_body("")),  # gateway hiccup
        HttpxResponse(200, json=PLAN_BODY),  # retry recovers
        HttpxResponse(200, json=PHASE1_BODY),
        HttpxResponse(200, json=PHASE2_BODY),
    ]
    phases = [p async for p in generate_phases(make_client(), "rag")]
    assert [p.id for p in phases] == ["p1", "p2"]
    assert route.call_count == 4


@pytest.mark.asyncio
@respx.mock
async def test_plan_bad_payload_exhausts_attempts():
    bad_plan = _completions_body(json.dumps({"total_phases": 99, "phase_names": []}))
    route = respx.post("https://llm.test/v1/chat/completions")
    route.side_effect = [
        HttpxResponse(200, json=bad_plan),
        HttpxResponse(200, json=bad_plan),
        HttpxResponse(200, json=bad_plan),
    ]
    with pytest.raises(LLMError):
        [p async for p in generate_phases(make_client(), "rag")]
    assert route.call_count == 3
