"""End-to-end smoke test: register, upload a tiny PDF, ask a question.

Uses real OpenAI calls — guarded by OPENAI_API_KEY env var so this
skips gracefully on fork PRs and in any environment where the secret
isn't configured.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.main import app


@pytest.fixture(scope="module")
def tiny_pdf(tmp_path_factory) -> Path:
    """Create a one-page text-layer PDF for upload tests."""
    path = tmp_path_factory.mktemp("fixtures") / "tiny.pdf"
    c = canvas.Canvas(str(path), pagesize=letter)
    c.drawString(100, 750, "AskDocs CI smoke test fixture.")
    c.drawString(100, 730, "The dataset used in this report was SQuAD 2.0.")
    c.drawString(100, 710, "The reported F1 score was 89.3.")
    c.save()
    return path


@pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"),
    reason="OPENAI_API_KEY not set; skipping integration smoke test",
)
async def test_register_upload_ask(tiny_pdf: Path) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        register_res = await client.post(
            "/auth/register",
            json={"email": "ci@askdocs.local", "password": "ci-test-password"},
        )
        assert register_res.status_code in (201, 409)

        login_res = await client.post(
            "/auth/login",
            json={"email": "ci@askdocs.local", "password": "ci-test-password"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        with open(tiny_pdf, "rb") as f:
            upload_res = await client.post(
                "/documents",
                files={"file": ("tiny.pdf", f.read(), "application/pdf")},
                headers=headers,
            )
        assert upload_res.status_code in (200, 201)
        doc_id = upload_res.json()["id"]

        doc: dict = {}
        for _ in range(60):
            status_res = await client.get(
                f"/documents/{doc_id}", headers=headers
            )
            doc = status_res.json()
            if doc["status"] in ("ready", "failed"):
                break
            await asyncio.sleep(1)
        assert doc["status"] == "ready", f"document not ready: {doc}"

        conv_res = await client.post(
            "/conversations",
            json={"document_id": doc_id},
            headers=headers,
        )
        assert conv_res.status_code == 201
        conv_id = conv_res.json()["id"]

        async with client.stream(
            "POST",
            "/chat",
            json={
                "conversation_id": conv_id,
                "question": "What dataset is used in this report?",
            },
            headers=headers,
        ) as stream:
            assert stream.status_code == 200
            received_token = False
            received_done = False
            received_error: str | None = None
            async for line in stream.aiter_lines():
                if line.startswith("event: token"):
                    received_token = True
                elif line.startswith("event: done"):
                    received_done = True
                elif line.startswith("event: error"):
                    received_error = line

        assert received_error is None, f"chat stream errored: {received_error}"
        assert received_token, "expected at least one token frame"
        assert received_done, "expected done frame"
