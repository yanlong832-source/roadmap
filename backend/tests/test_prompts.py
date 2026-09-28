import json

from app.prompts import SYSTEM_PROMPT, phase_user_prompt


def test_system_prompt_contains_required_constraints():
    assert "bilibili" in SYSTEM_PROMPT
    assert "专家" in SYSTEM_PROMPT
    # must embed the JSON schema text at the end
    assert '"type"' in SYSTEM_PROMPT and "phases" in SYSTEM_PROMPT


def test_system_prompt_ends_with_schema_block():
    tail = SYSTEM_PROMPT[-2000:]
    assert "phases" in tail


def test_phase_user_prompt_injects_keyword_and_previous():
    previous = [{"id": "p1", "name": "基础", "order": 1, "topics": []}]
    out = phase_user_prompt("rag", previous, current_phase_index=2, total_phases=5, current_phase_name="进阶")
    assert "rag" in out
    assert "基础" in out  # previous phases content present
    assert "进阶" in out
    assert "5" in out  # total
