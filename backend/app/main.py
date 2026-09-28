from __future__ import annotations

import json
import os
from typing import Any

import redis as sync_redis

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Roadmap API")

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
    # tasks_in_flight is hardcoded until Task 6 wires the real TaskRegistry.
    return json.loads(json.dumps({"redis": _redis_status(), "llm_key": _llm_key_status(), "tasks_in_flight": 0}))
