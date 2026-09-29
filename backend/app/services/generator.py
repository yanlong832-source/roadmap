"""LLM client and per-phase roadmap generator.

The generation protocol (spec section 5 / plan Task 4):
1. one "plan" call returns the phase skeleton (N, names, title, summary,
   total duration hint);
2. N subsequent calls generate one Phase object each, with the previous
   phases passed in for continuity;
3. every response must be pure JSON; markdown fences are stripped before
   parsing, and each malformed/HTTP failure gets exactly one retry at
   temperature 0.2 before raising LLMError.
"""
from __future__ import annotations

import json
import os
import re
from typing import AsyncIterator

import httpx

from app.models import Phase
from app.prompts import SYSTEM_PROMPT, phase_user_prompt, plan_prompt

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```$", re.DOTALL)
_MAX_ATTEMPTS = 3  # total attempts including the first one

_DEFAULT_TIMEOUT_SECONDS = 60.0
_CALL_TIMEOUT_SECONDS: float = float(os.getenv("LLM_CALL_TIMEOUT", "90"))
_FIRST_ATTEMPT_TEMPERATURE = 0.4
_RETRY_TEMPERATURE = 0.2


class LLMError(Exception):
    """Raised when the LLM endpoint or its JSON payload is unusable."""


class LLMClient:
    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model

    def _describe_failure(self, exc: BaseException) -> str:
        """Build a user-facing reason for an LLM transport failure.

        A missing/empty api_key is the most common cause in self-hosted
        deployments; call it out explicitly instead of an empty detail.
        """
        if not self._api_key:
            return "LLM_API_KEY is not configured on the server"
        detail = str(exc) or exc.__class__.__name__
        return detail


    async def complete_text(
        self,
        system: str,
        user: str,
        temperature: float = 0.4,
        timeout: float = _CALL_TIMEOUT_SECONDS,
        history: list[dict] | None = None,
    ) -> str:
        """One chat completion returning raw text (no JSON parsing).

        Used by the tutor, whose answers are prose. ``history`` carries
        prior user/assistant turns for multi-turn coaching.
        """
        url = f"{self._base_url}/chat/completions"
        messages: list[dict] = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": user})
        payload = {
            "model": self._model,
            "temperature": temperature,
            "messages": messages,
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise LLMError(
                f"LLM request failed: {self._describe_failure(exc)}"
            ) from exc
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"unexpected LLM response shape: {exc}") from exc

    async def complete_json(
        self,
        system: str,
        user: str,
        temperature: float = _FIRST_ATTEMPT_TEMPERATURE,
        timeout: float = _CALL_TIMEOUT_SECONDS,
    ) -> dict:
        """Call the OpenAI-compatible /chat/completions endpoint and parse JSON.

        Strips optional ```json markdown fences, then json.loads; any
        transport error or payload problem raises LLMError.
        """
        url = f"{self._base_url}/chat/completions"
        payload = {
            "model": self._model,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise LLMError(
                f"LLM request failed: {self._describe_failure(exc)}"
            ) from exc

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"unexpected LLM response shape: {exc}") from exc

        return _parse_json_text(text)


def _parse_json_text(text: str) -> dict:
    """Strip optional markdown fences, then decode the JSON payload.

    Raises LLMError with a descriptive message when the content is empty
    or unparseable, so the caller can retry with a lower temperature.
    """
    if text is None or not text.strip():
        raise LLMError("LLM returned empty content (likely a gateway timeout or truncation)")
    match = _FENCE_RE.match(text)
    candidate = match.group(1).strip() if match else text.strip()
    if not candidate:
        raise LLMError("LLM returned only markdown fences with no content inside")
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        snippet = candidate[:120].replace("\n", " ")
        raise LLMError(
            f"LLM returned non-JSON content ({exc}); first 120 chars: {snippet!r}"
        ) from exc
    if not isinstance(parsed, dict):
        raise LLMError(f"LLM JSON payload is {type(parsed).__name__}, expected object")
    return parsed


async def generate_phases(
    client: LLMClient,
    norm_keyword: str,
    timeout: float = _CALL_TIMEOUT_SECONDS,
) -> AsyncIterator[Phase]:
    """Stream phases for a normalized keyword: plan once, then per phase.

    Each phase generation is validated against the Phase schema; a failure
    gets exactly one retry at temperature 0.2, otherwise LLMError is
    raised and the generator stops.
    """
    total_phases, phase_names = await _plan_with_retry(
        client, norm_keyword, timeout
    )

    generated: list[dict] = []
    for index in range(total_phases):
        prompt = phase_user_prompt(
            norm_keyword,
            generated,
            index + 1,
            total_phases,
            phase_names[index],
        )
        phase = await _complete_phase_with_retry(client, prompt, timeout)
        generated.append(phase.model_dump())
        yield phase


async def _complete_phase_with_retry(
    client: LLMClient, prompt: str, timeout: float
) -> Phase:
    """Generate one Phase with bounded retries.

    Three attempts total: first at temperature 0.4, remaining two at 0.2.
    All LLMError / validation failures trigger the next attempt; after
    the last failure the most recent error is re-raised.
    """
    last_error: LLMError | None = None
    for attempt in range(_MAX_ATTEMPTS):
        temperature = _FIRST_ATTEMPT_TEMPERATURE if attempt == 0 else _RETRY_TEMPERATURE
        try:
            raw = await client.complete_json(
                SYSTEM_PROMPT, prompt, temperature=temperature, timeout=timeout
            )
            return Phase.model_validate(raw)
        except (LLMError, ValueError) as exc:
            last_error = exc if isinstance(exc, LLMError) else LLMError(f"invalid phase payload: {exc}")
    raise last_error if last_error else LLMError("phase generation failed")


async def _plan_with_retry(
    client: LLMClient, norm_keyword: str, timeout: float
) -> tuple[int, list[str]]:
    """Call the plan step with bounded retries.

    Three attempts total: first at temperature 0.4, remaining two at 0.2.
    Each attempt validates the plan payload (total_phases must be an int
    within 1..len(phase_names)); the last error is re-raised when all
    attempts fail.
    """
    last_error: LLMError | None = None
    for attempt in range(_MAX_ATTEMPTS):
        temperature = _FIRST_ATTEMPT_TEMPERATURE if attempt == 0 else _RETRY_TEMPERATURE
        try:
            plan = await client.complete_json(
                SYSTEM_PROMPT,
                plan_prompt(norm_keyword),
                temperature=temperature,
                timeout=timeout,
            )
            try:
                total_phases = int(plan["total_phases"])
                phase_names = [str(n) for n in plan["phase_names"]]
            except (KeyError, TypeError, ValueError) as exc:
                raise LLMError(f"invalid plan payload: {exc}") from exc
            if not (1 <= total_phases <= len(phase_names)):
                raise LLMError("total_phases does not match phase_names")
            return total_phases, phase_names
        except LLMError as exc:
            last_error = exc
    raise last_error if last_error else LLMError("plan generation failed")

