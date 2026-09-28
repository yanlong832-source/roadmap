"""Keyword normalization: the single source of truth for cache keys.

Rule (Global Constraints, verbatim): lowercase + strip + collapse internal
whitespace. All-whitespace input yields the empty string.
"""
import re


def normalize_keyword(raw: str) -> str:
    if not raw:
        return ""
    return re.sub(r"\s+", " ", raw.strip().lower())
