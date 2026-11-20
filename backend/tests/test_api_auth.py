"""Tests for authentication API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_file = str(tmp_path / "test_api.sqlite3")
    monkeypatch.setenv("DATABASE_PATH", db_file)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-1234567890123456789012")

    from backend.app.main import app
    from finance_core.db.connection import connect
    from finance_core.db.migrations import init_db

    conn = connect(db_file)
    init_db(conn)
    conn.close()

    with TestClient(app) as test_client:
        yield test_client


def test_health_check(client):
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["status"] == "online"


def test_register_and_login(client):
    # 1. Register
    reg_res = client.post(
        "/api/auth/register",
        json={
            "email": "user@example.com",
            "password": "password123",
            "first_name": "Hans",
        },
    )
    assert reg_res.status_code == 201
    data = reg_res.json()
    assert "access_token" in data
    assert data["user"]["email"] == "user@example.com"
    token = data["access_token"]

    # 2. Get profile with Bearer token
    me_res = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["first_name"] == "Hans"

    # 3. Login
    login_res = client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "password123"},
    )
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()


def test_duplicate_registration_fails(client):
    payload = {"email": "dup@example.com", "password": "password123"}
    res1 = client.post("/api/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/auth/register", json=payload)
    assert res2.status_code == 400
    assert "Email sudah terdaftar" in res2.json()["detail"]


def test_telegram_link_token_returns_rotating_six_digit_code(client):
    registered = client.post(
        "/api/auth/register",
        json={"email": "link@example.com", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

    first = client.post("/api/auth/telegram-link-token", headers=headers)
    assert first.status_code == 201
    first_body = first.json()
    assert len(first_body["code"]) == 6 and first_body["code"].isdigit()
    assert first_body["expires_in_minutes"] == 10

    # Kode baru membatalkan kode lama.
    second = client.post("/api/auth/telegram-link-token", headers=headers)
    assert second.status_code == 201
    assert second.json()["code"] != first_body["code"]

    import os

    from finance_core.db.connection import open_database
    from finance_core.db.users import consume_telegram_link_code

    connection = open_database(os.environ["DATABASE_PATH"])
    try:
        assert consume_telegram_link_code(connection, code=first_body["code"]) is None
        assert consume_telegram_link_code(
            connection, code=second.json()["code"]
        ) == registered.json()["user"]["id"]
    finally:
        connection.close()


def test_profile_reports_telegram_link_state(client):
    registered = client.post(
        "/api/auth/register",
        json={"email": "state@example.com", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["telegram_linked"] is False


def test_telegram_link_can_be_removed_without_losing_data(client):
    registered = client.post(
        "/api/auth/register",
        json={"email": "unlink@example.com", "password": "password123"},
    )
    user_id = registered.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

    client.post(
        "/api/transactions",
        json={
            "type": "expense",
            "category_name": "Makan & Minum",
            "amount": 15000,
            "transaction_date": "2026-11-02",
        },
        headers=headers,
    )

    import os

    from finance_core.db.connection import open_database
    from finance_core.db.users import link_telegram_account

    connection = open_database(os.environ["DATABASE_PATH"])
    try:
        link_telegram_account(connection, user_id=user_id, telegram_user_id=31337)
        connection.commit()
    finally:
        connection.close()

    assert client.get("/api/auth/me", headers=headers).json()["telegram_linked"] is True

    removed = client.delete("/api/auth/telegram-link", headers=headers)
    assert removed.status_code == 200
    assert removed.json() == {"telegram_linked": False}

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["telegram_linked"] is False

    listed = client.get("/api/transactions", headers=headers).json()
    assert len(listed) == 1


def _sample_png_data_uri() -> str:
    import base64

    payload = base64.b64encode(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR").decode("ascii")
    return f"data:image/png;base64,{payload}"


def _sample_jpeg_data_uri() -> str:
    import base64

    payload = base64.b64encode(b"\xff\xd8\xff\xe0\x00\x10JFIF").decode("ascii")
    return f"data:image/jpeg;base64,{payload}"


def test_patch_profile_updates_name_and_avatar_and_clears_avatar(client):
    registered = client.post(
        "/api/auth/register",
        json={"email": "editme@example.com", "password": "password123", "first_name": "Ayu"},
    )
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    other = client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "password": "password123", "first_name": "Budi"},
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    assert client.patch("/api/auth/me", json={"first_name": "Anon"}).status_code == 401

    png_uri = _sample_png_data_uri()
    updated = client.patch(
        "/api/auth/me",
        json={"first_name": "  Ayu Lestari  ", "avatar_url": png_uri},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["first_name"] == "Ayu Lestari"
    assert updated.json()["avatar_url"] == png_uri

    # Updating only the name keeps the existing avatar intact.
    jpeg_uri = _sample_jpeg_data_uri()
    name_only = client.patch("/api/auth/me", json={"first_name": "Ayu L."}, headers=headers)
    assert name_only.status_code == 200
    assert name_only.json()["first_name"] == "Ayu L."
    assert name_only.json()["avatar_url"] == png_uri

    # Updating only the avatar keeps the existing name intact.
    avatar_only = client.patch("/api/auth/me", json={"avatar_url": jpeg_uri}, headers=headers)
    assert avatar_only.status_code == 200
    assert avatar_only.json()["first_name"] == "Ayu L."
    assert avatar_only.json()["avatar_url"] == jpeg_uri

    # Explicit null clears only the avatar.
    cleared = client.patch("/api/auth/me", json={"avatar_url": None}, headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["first_name"] == "Ayu L."
    assert cleared.json()["avatar_url"] is None

    # Other user remains untouched.
    other_me = client.get("/api/auth/me", headers=other_headers)
    assert other_me.status_code == 200
    assert other_me.json()["first_name"] == "Budi"
    assert other_me.json()["avatar_url"] is None


def test_patch_profile_rejects_invalid_names_and_untrusted_avatars(client):
    import base64

    registered = client.post(
        "/api/auth/register",
        json={"email": "validate@example.com", "password": "password123", "first_name": "Ayu"},
    )
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

    assert client.patch("/api/auth/me", json={}, headers=headers).status_code == 422
    assert client.patch("/api/auth/me", json={"first_name": "   "}, headers=headers).status_code == 422
    assert client.patch("/api/auth/me", json={"first_name": None}, headers=headers).status_code == 422
    assert client.patch("/api/auth/me", json={"first_name": "A" * 81}, headers=headers).status_code == 422
    assert client.patch(
        "/api/auth/me", json={"avatar_url": "https://evil.example/a.png"}, headers=headers
    ).status_code == 422
    svg = base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'/>").decode("ascii")
    assert client.patch(
        "/api/auth/me", json={"avatar_url": f"data:image/svg+xml;base64,{svg}"}, headers=headers
    ).status_code == 422
    fake_png = base64.b64encode(b"not-actually-a-png").decode("ascii")
    assert client.patch(
        "/api/auth/me", json={"avatar_url": f"data:image/png;base64,{fake_png}"}, headers=headers
    ).status_code == 422
    oversized = base64.b64encode(b"\xff\xd8\xff" + b"a" * 300_000).decode("ascii")
    assert client.patch(
        "/api/auth/me", json={"avatar_url": f"data:image/jpeg;base64,{oversized}"}, headers=headers
    ).status_code == 422
