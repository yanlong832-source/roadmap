"""Roadmap tutor: a Socratic teaching agent bound to the current roadmap.

The tutor receives the user's live question plus the full roadmap
context (keyword, phases, and the topic the user is currently looking
at), and answers in a coaching style: it explains the "why" before the
"what", asks the learner to predict before revealing, and always ends
with a concrete 5-minute action.
"""
from __future__ import annotations

import json

from app.models import Phase, Topic
from app.services.generator import LLMClient

TUTOR_SYSTEM_PROMPT = """你是一位学习教练兼导师，正在陪用户走一条为「行业专家级」量身定制的学习路线。

## 人设与风格
- 用简体中文、教练式口吻称呼用户为「你」。
- 先解释「为什么学这个」，再解释「这是什么」，最后才是「怎么练」。
- 用几何、物理、生活类比帮助理解抽象概念（例如：把检索比作图书馆索引，
  把梯度下降比作下山）。
- 回答控制在 300-600 字，信息密度优先，不要客套话。

## 硬性规则
1. 你只能围绕当前学习路线上下文回答，不要发散到无关领域。
2. 每次回答的结尾必须给一个「5 分钟行动」：一个用户现在就可以做的小任务
   （写一段伪代码、画一张图、读一个 API 的某个函数……），格式固定为：
   `【5 分钟行动】...`
3. 当用户的问题超出当前路线范围时，先点明这一点，再给一个把问题拉回
   路线内的折中方案。
4. 如果用户正在看某个 topic，优先围绕该 topic 展开；否则围绕当前阶段。

## 当前路线上下文
路线关键词：{keyword}
路线标题：{title}

完整路线（阶段 → 主题）：
{roadmap_outline}

用户当前正在查看的主题（可能为空）：{active_topic}
"""


def _topic_brief(topic: Topic) -> str:
    resources = "; ".join(r.title for r in topic.resources[:3]) or "无"
    return f"{topic.title}（{topic.duration_hint}）—— 资源: {resources}"


def build_tutor_system_prompt(
    keyword: str,
    title: str,
    phases: list[Phase],
    active_topic: Topic | None = None,
) -> str:
    """Render the tutor system prompt bound to the current roadmap."""
    outline_lines: list[str] = []
    for phase in phases:
        outline_lines.append(
            f"阶段 {phase.order}：{phase.name} —— "
            + " / ".join(t.title for t in phase.topics)
        )
    active = (
        _topic_brief(active_topic) if active_topic else "（未指定，请基于整体路线回答）"
    )
    return TUTOR_SYSTEM_PROMPT.format(
        keyword=keyword,
        title=title,
        roadmap_outline="\n".join(outline_lines) or "（路线尚未生成完成）",
        active_topic=active,
    )


async def tutor_complete(
    client: LLMClient,
    system: str,
    history: list[dict],
    user_message: str,
    temperature: float = 0.4,
    timeout: float = 90.0,
) -> str:
    """One tutor turn: append the user message to history and complete.

    Returns the raw assistant text (tutor answers are prose, not JSON).
    """
    messages = [{"role": "system", "content": system}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    return await client.complete_text(
        system,
        user_message,
        temperature=temperature,
        timeout=timeout,
        history=history,
    )

