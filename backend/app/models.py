"""Pydantic models for the generated learning roadmap.

Field names mirror spec section 3 exactly; the frontend TypeScript types
(Task 6) mirror this module field-for-field.
"""
from typing import Literal

from pydantic import BaseModel, Field

ResourceType = Literal["bilibili", "doc", "book", "course", "project"]


class Resource(BaseModel):
    title: str
    url: str
    type: ResourceType
    note: str | None = None


class Topic(BaseModel):
    id: str
    phase_id: str
    title: str
    description: str
    duration_hint: str
    resources: list[Resource] = Field(default_factory=list)


class Phase(BaseModel):
    id: str
    name: str
    order: int
    topics: list[Topic] = Field(default_factory=list)


class Roadmap(BaseModel):
    keyword: str
    title: str
    summary: str
    total_duration_hint: str
    phases: list[Phase] = Field(default_factory=list)
