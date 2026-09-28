from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_shape():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"redis", "llm_key", "tasks_in_flight"}
    assert body["redis"] in ("ok", "down")
