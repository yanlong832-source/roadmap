import json

import pytest

from app.models import Phase, Resource, Topic
from app.services.tutor import build_tutor_system_prompt, _topic_brief


def _topic(title="向量检索", url="https://milvus.io/docs/overview.md") -> Topic:
    return Topic(
        id="t1",
        phase_id="p1",
        title=title,
        description="d",
        duration_hint="约 2 周",
        resources=[Resource(title="Milvus 文档", url=url, type="doc")],
    )


def test_topic_brief_includes_title_and_resources():
    brief = _topic_brief(_topic())
    assert "向量检索" in brief
    assert "Milvus 文档" in brief
    assert "约 2 周" in brief


def test_topic_brief_without_resources_shows_placeholder():
    t = _topic()
    t.resources = []
    brief = _topic_brief(t)
    assert "无" in brief


def test_build_tutor_system_prompt_binds_roadmap():
    phase = Phase(
        id="p1",
        name="RAG 基础",
        order=1,
        topics=[_topic()],
    )
    prompt = build_tutor_system_prompt(
        "rag", "RAG 学习路线", [phase], active_topic=phase.topics[0]
    )
    assert "rag" in prompt
    assert "RAG 学习路线" in prompt
    assert "阶段 1" in prompt
    assert "向量检索" in prompt
    # 教练式口吻与 5 分钟行动规则必须在提示词里
    assert "5 分钟行动" in prompt
    assert "教练" in prompt


def test_build_tutor_system_prompt_no_active_topic_placeholder():
    prompt = build_tutor_system_prompt("rag", "T", [])
    assert "未指定" in prompt
    assert "路线尚未生成完成" in prompt
