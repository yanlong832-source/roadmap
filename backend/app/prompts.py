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
   - 资源必须**真实存在、可访问**，严禁编造链接、BV号或标题。
     后端会用 HTTP 探针逐一校验每个 URL，**不存在的链接会被自动丢弃**。
   - Bilibili 资源（type="bilibili"）只允许两类：
     (a) 你**高度确信**存在的知名系列 / 课程主页（例如 B 站官方「学堂」/
         大学课程合集，或 UP 主公开标注的合集页），使用系列页 URL；
     (b) 该资源的**搜索页链接** `https://search.bilibili.com/all?keyword=<URL编码的关键词>`，
         用于你不确定具体 BV 号但知道该领域在 B 站有大量内容的场景。
     严禁凭记忆拼造 `BV` 号或 `av` 号。
   - 在保证真实性的前提下，优先给**一级域名主页 / 官方文档 / GitHub 仓库
     根页**这类你非常确定存在的稳定 URL；深链（具体章节 / 课时）只有在你
     对 URL 路径有明确把握时才使用，否则退回主页，宁可浅不可假。
   - 书籍用豆瓣读书 / 出版社官方页，文档用官方文档站，课程用课程主页，
     项目用 GitHub / 官方仓库主页。**不使用 YouTube**。
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
