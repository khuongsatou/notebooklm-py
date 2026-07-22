"""REST coverage for desktop features that are enabled in the renderer."""

from __future__ import annotations

from fastapi.testclient import TestClient

from notebooklm._types.sources import Source
from notebooklm.rpc.types import SourceStatus

from .fakes import FakeClient


def test_add_drive_source_records_plan(authed_client: TestClient, fake_client: FakeClient) -> None:
    resp = authed_client.post(
        "/v1/notebooks/nb-1/sources/drive",
        json={
            "file_id": "drive-file-1",
            "title": "Drive strategy doc",
            "mime_type": "google-doc",
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "Drive strategy doc"
    assert body["url"].endswith("/drive-file-1")
    assert fake_client.last_drive_add == {
        "notebook_id": "nb-1",
        "file_id": "drive-file-1",
        "title": "Drive strategy doc",
        "mime_type": "application/vnd.google-apps.document",
    }


def test_label_routes_manage_labels_and_sources(
    authed_client: TestClient, fake_client: FakeClient
) -> None:
    fake_client.sources_store["nb-1"] = {
        "src-1": Source(id="src-1", title="Architecture reference", status=SourceStatus.READY)
    }

    created = authed_client.post(
        "/v1/notebooks/nb-1/labels",
        json={"name": "Architecture", "emoji": "🏷️"},
    )
    assert created.status_code == 201
    label_id = created.json()["id"]

    renamed = authed_client.patch(
        f"/v1/notebooks/nb-1/labels/{label_id}",
        json={"name": "Architecture QA"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Architecture QA"

    emoji = authed_client.patch(
        f"/v1/notebooks/nb-1/labels/{label_id}/emoji",
        json={"emoji": "✅"},
    )
    assert emoji.status_code == 200
    assert emoji.json()["emoji"] == "✅"

    added = authed_client.post(
        f"/v1/notebooks/nb-1/labels/{label_id}/sources",
        json={"source_ids": ["src-1"]},
    )
    assert added.status_code == 200
    assert added.json()["label"]["source_ids"] == ["src-1"]

    sources = authed_client.get(f"/v1/notebooks/nb-1/labels/{label_id}/sources")
    assert sources.status_code == 200
    assert sources.json()["sources"][0]["id"] == "src-1"

    removed = authed_client.request(
        "DELETE",
        f"/v1/notebooks/nb-1/labels/{label_id}/sources",
        json={"source_ids": ["src-1"]},
    )
    assert removed.status_code == 200
    assert removed.json()["label"]["source_ids"] == []

    generated = authed_client.post(
        "/v1/notebooks/nb-1/labels/generate",
        json={"scope": "all"},
    )
    assert generated.status_code == 200
    assert generated.json()["count"] >= 1

    deleted = authed_client.delete(f"/v1/notebooks/nb-1/labels/{label_id}")
    assert deleted.status_code == 204


def test_research_routes_start_poll_and_cancel(authed_client: TestClient) -> None:
    started = authed_client.post(
        "/v1/notebooks/nb-1/research",
        json={"query": "Find source gaps", "source": "web", "mode": "fast"},
    )
    assert started.status_code == 201
    task_id = started.json()["task_id"]

    status = authed_client.get(
        "/v1/notebooks/nb-1/research/status",
        params={"task_id": task_id},
    )
    assert status.status_code == 200
    assert status.json()["status"] == "completed"
    assert status.json()["summary"] == "Research completed"

    cancelled = authed_client.delete(f"/v1/notebooks/nb-1/research/{task_id}")
    assert cancelled.status_code == 204


def test_settings_routes_manage_language_and_update_status(
    authed_client: TestClient,
) -> None:
    settings = authed_client.get("/v1/settings")
    assert settings.status_code == 200
    assert settings.json()["server"] == "notebooklm-server"
    assert "vi" in settings.json()["languages"]

    changed = authed_client.patch("/v1/settings/language", json={"code": "vi"})
    assert changed.status_code == 200
    assert changed.json()["language_name"] == "Tiếng Việt"

    rejected = authed_client.patch("/v1/settings/language", json={"code": "zz"})
    assert rejected.status_code == 422

    update = authed_client.get("/v1/settings/update")
    assert update.status_code == 200
    assert update.json()["update_available"] is False
