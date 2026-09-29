from __future__ import annotations

import json
import os
from typing import Any

import redis as sync_redis

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Roadmap API")

# Module-level TaskRegistry singleton; Task 6 wires in_flight() to health.
# Redis mirroring degrades gracefully when the backend is unreachable.
from app.services.tasks import TaskRegistry
_registry = TaskRegistry()

# Roadmap generation routes (cache read, async generate, SSE stream) - Task 5.
from app.routes.roadmaps import router as roadmaps_router
app.include_router(roadmaps_router)
from app.routes.tutor import router as tutor_router
app.include_router(tutor_router)

origins_raw = os.getenv("CORS_ORIGINS", "*").strip()
origins = [o.strip() for o in origins_raw.split(",") if o.strip()] or ["*"]
if "*" not in origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _redis_status() -> str:
    """Health check uses a synchronous client (no event loop available in a sync context
    such as TestClient startup). The real service path uses redis.asyncio; ping latency
    here is irrelevant to production correctness."""
    try:
        client = sync_redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        client.ping()
        return "ok"
    except Exception:
        return "down"


def _llm_key_status() -> str:
    return "configured" if os.getenv("LLM_API_KEY", "").strip() else "missing"


@app.get("/api/health")
async def health() -> dict[str, Any]:
    """Health endpoint: redis up/down, llm key status, live task count.

    tasks_in_flight reflects the real TaskRegistry so deploy checks see
    active generation work (Task 6).
    """
    return json.loads(json.dumps({"redis": _redis_status(), "llm_key": _llm_key_status(), "tasks_in_flight": _registry.in_flight()}))

