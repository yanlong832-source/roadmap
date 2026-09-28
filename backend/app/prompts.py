"""LLM generation prompts (spec section 5, verbatim constraints).

The Roadmap JSON schema is embedded from models.Roadmap so the prompt and
the Pydantic validator share a single source of truth.
"""
from __future__ import annotations

import json

from app.models import Roadmap

_SCHEMA_JSON = json.dumps(Roadmap.model_json_schema(), ensure_ascii=False)

SYSTEM_PROMPT = """你是资深学习规划师，擅长为任意关键词产出一条「可执行」的学习路线。

## 硬性要求
1. 终点定位：该关键词对应领域的**行业专家 / 高级工程师级**。阶段划分以此为终点，
   覆盖专家级所需的完整知识版图，不得为了精简而砍掉高阶阶段。
2. 阶段数量随领域复杂度自适应：简单领域 4-6 个阶段，复杂领域可到 6-8 个阶段。
   每个阶段 3-6 个 topic，每个 topic 配 2-4 个资源。
3. 资源规则（真实性 > 深度）：
   - 资源必须**真实存在、可访问**，严禁编造链接或标题。
   - 在保证真实性的前提下，尽量给到具体章节 / 课时 / 单集级深链；
     若不确定深链是否正确，退到该资源的真实主页，宁可浅不可假。
   - 视频类资源（type="bilibili"）一律使用 Bilibili（B站）链接，
     尽量给到单集或系列页，**不使用 YouTube**。
   - 书籍用豆瓣/出版社页，文档用官方文档站，课程用课程主页，项目用仓库主页。
4. 每个 topic 必须给出 duration_hint（如「约 2 周」「约 3 个月」），
   最终 total_duration_hint 为各阶段累加后的量级描述。
5. 输出必须是**纯 JSON**，结构严格符合下方 schema，不得包含 markdown 围栏或任何额外文本。

## 输出 JSON Schema
""" + _SCHEMA_JSON


def phase_user_prompt(
    norm_keyword: str,
    previous_phases: list[dict],
    current_phase_index: int,
    total_phases: int,
    current_phase_name: str,
) -> str:
    """User prompt for generating one phase at a time.

    `previous_phases` are already-generated phase dicts (for continuity).
    `current_phase_index` is 1-based.
    """
    prev_json = json.dumps(previous_phases, ensure_ascii=False)
    return (
        f"请为关键词「{norm_keyword}」生成学习路线的第 {current_phase_index} 阶段"
        f"（共 {total_phases} 个阶段，本阶段名称：{current_phase_name}）。\n"
        f"已生成的前序阶段（保持术语与深度连贯）：\n{prev_json}\n\n"
        f"输出**本阶段单个 Phase 对象**的 JSON（含 id/name/order/topics），"
        f"结构必须符合 schema 中 Phase 的定义。纯 JSON，无围栏无解释。"
    )


def plan_prompt(norm_keyword: str) -> str:
    """First call: ask the LLM to plan the phase skeleton for a keyword."""
    return (
        f"请为关键词「{norm_keyword}」规划一条通往行业专家级的学习路线的阶段骨架。"
        f"输出纯 JSON：{{\"total_phases\": <int 4-8>, "
        f"\"phase_names\": [<str>, ...], "
        f"\"total_duration_hint\": \"<量级描述，如 1.5 年>\", "
        f"\"title\": \"<比关键词更人话的路线标题>\", "
        f"\"summary\": \"<2-3 句总述>\"}}。"
    )
