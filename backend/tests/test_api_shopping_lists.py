"""API and PostgreSQL portability tests for planned shopping lists."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def shopping_client(tmp_path, monkeypatch):
    db_file = str(tmp_path / "test_shopping_lists.sqlite3")
    monkeypatch.setenv("DATABASE_PATH", db_file)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-1234567890123456789012")

    from backend.app.main import app
    from finance_core.db.connection import connect
    from finance_core.db.migrations import init_db

    conn = connect(db_file)
    init_db(conn)
    conn.close()

    with TestClient(app) as client:
        reg1 = client.post(
            "/api/auth/register",
            json={"email": "shopper1@example.com", "password": "password123", "first_name": "Ayu"},
        )
        reg2 = client.post(
            "/api/auth/register",
            json={"email": "shopper2@example.com", "password": "password123", "first_name": "Budi"},
        )
        yield (
            client,
            {"Authorization": f"Bearer {reg1.json()['access_token']}"},
            {"Authorization": f"Bearer {reg2.json()['access_token']}"},
        )


def test_shopping_list_crud_groups_duplicate_and_expense_conversion(shopping_client) -> None:
    client, h1, h2 = shopping_client

    # Create a monthly shopping list with grouped items (including an unpriced item).
    created = client.post(
        "/api/shopping-lists",
        json={
            "title": "List Belanja Bulanan November",
            "budget_amount": 500_000,
            "notes": "Masih ada: deodorant, tisu. Budget 500k di luar beras.",
            "items": [
                {"group_name": "Kebutuhan Dapur", "name": "Beras 10 kg", "price": 120_000},
                {"group_name": "Kebutuhan Dapur", "name": "Minyak goreng 2 L", "price": 31_500},
                {"group_name": "Kebutuhan Ibu", "name": "Moisturizer", "price": None},
            ],
        },
        headers=h1,
    )
    assert created.status_code == 201
    body = created.json()
    list_id = body["id"]
    assert body["title"] == "List Belanja Bulanan November"
    assert body["budget_amount"] == 500_000
    assert body["item_count"] == 3
    assert body["checked_count"] == 0
    assert body["planned_total"] == 151_500
    assert body["unrecorded_checked_total"] == 0

    # Other user cannot read, mutate, duplicate, or convert this list.
    assert client.get(f"/api/shopping-lists/{list_id}", headers=h2).status_code == 404
    assert client.put(f"/api/shopping-lists/{list_id}", json={"title": "Hijack"}, headers=h2).status_code == 404
    assert client.post(f"/api/shopping-lists/{list_id}/duplicate", headers=h2).status_code == 404
    assert client.post(f"/api/shopping-lists/{list_id}/record-expense", headers=h2).status_code == 404

    # Add one more item and update the unpriced item later.
    added = client.post(
        f"/api/shopping-lists/{list_id}/items",
        json={"group_name": "Kebutuhan Rumah", "name": "Detergen", "price": 15_000},
        headers=h1,
    )
    assert added.status_code == 201
    detergent_id = added.json()["id"]

    # Check Beras and Detergen; check Moisturizer (price None -> cannot be recorded yet).
    beras_id = body["items"][0]["id"]
    moisturizer_id = body["items"][2]["id"]
    assert client.patch(
        f"/api/shopping-lists/{list_id}/items/{beras_id}",
        json={"is_checked": True},
        headers=h1,
    ).status_code == 200
    assert client.patch(
        f"/api/shopping-lists/{list_id}/items/{detergent_id}",
        json={"is_checked": True},
        headers=h1,
    ).status_code == 200
    assert client.patch(
        f"/api/shopping-lists/{list_id}/items/{moisturizer_id}",
        json={"is_checked": True},
        headers=h1,
    ).status_code == 200

    # Planned items must NOT enter transactions before explicit conversion.
    assert client.get("/api/transactions", headers=h1).json() == []

    # Convert checked items with prices into one Belanja expense.
    recorded = client.post(
        f"/api/shopping-lists/{list_id}/record-expense",
        json={"transaction_date": "2026-11-20"},
        headers=h1,
    )
    assert recorded.status_code == 200
    rec_body = recorded.json()
    assert rec_body["transaction"]["type"] == "expense"
    assert rec_body["transaction"]["category_name"] == "Belanja"
    assert rec_body["transaction"]["amount"] == 135_000
    assert rec_body["shopping_list"]["recorded_total"] == 135_000
    assert rec_body["shopping_list"]["unrecorded_checked_total"] == 0

    # Immediate duplicate click must refuse cleanly rather than double-recording!
    duplicate_record = client.post(
        f"/api/shopping-lists/{list_id}/record-expense",
        json={"transaction_date": "2026-11-20"},
        headers=h1,
    )
    assert duplicate_record.status_code == 400
    assert len(client.get("/api/transactions", headers=h1).json()) == 1

    # Duplicate list for next month resets checked & transaction links.
    cloned = client.post(
        f"/api/shopping-lists/{list_id}/duplicate",
        json={"title": "List Belanja Bulanan Desember"},
        headers=h1,
    )
    assert cloned.status_code == 201
    cloned_body = cloned.json()
    assert cloned_body["title"] == "List Belanja Bulanan Desember"
    assert cloned_body["item_count"] == 4
    assert cloned_body["checked_count"] == 0
    assert cloned_body["recorded_total"] == 0
    assert all(not item["is_checked"] and item["transaction_id"] is None for item in cloned_body["items"])

    # Delete cloned item & list cleanly; original transaction remains intact.
    last_item_id = cloned_body["items"][-1]["id"]
    assert client.delete(f"/api/shopping-lists/{cloned_body['id']}/items/{last_item_id}", headers=h1).status_code == 204
    assert client.delete(f"/api/shopping-lists/{list_id}", headers=h1).status_code == 204
    assert len(client.get("/api/transactions", headers=h1).json()) == 1


def test_shopping_list_postgres_portability() -> None:
    postgres_url = os.getenv("POSTGRES_TEST_URL")
    if not postgres_url:
        pytest.skip("POSTGRES_TEST_URL is not set; PostgreSQL shopping list check skipped")

    import uuid
    from urllib.parse import quote

    import psycopg

    from finance_core.db.connection import connect_url
    from finance_core.db.migrations import run_migrations
    from finance_core.db.shopping_lists import (
        create_shopping_list,
        record_shopping_list_expense,
    )
    from finance_core.db.users import create_mobile_user

    schema = f"t_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(postgres_url, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
    sep = "&" if "?" in postgres_url else "?"
    scoped_url = f"{postgres_url}{sep}options={quote(f'-c search_path={schema}')}"

    try:
        conn = connect_url(scoped_url)
        try:
            assert run_migrations(conn) == 10
            user = create_mobile_user(conn, email="pgshop@example.com", password_hash="unused")
            summary, _items = create_shopping_list(
                conn,
                user_id=user.id,
                title="PG Monthly List",
                budget_amount=300_000,
                items=[{"group_name": "Dapur", "name": "Beras", "price": 120_000, "is_checked": True}],
            )
            conn.commit()
            result = record_shopping_list_expense(
                conn,
                user_id=user.id,
                list_id=summary.id,
                transaction_date="2026-11-20",
            )
            conn.commit()
            assert result is not None
            tx, updated_summary, updated_items = result
            assert tx.amount == 120_000
            assert updated_summary.recorded_total == 120_000
            assert updated_items[0].transaction_id == tx.id
        finally:
            conn.close()
    finally:
        with psycopg.connect(postgres_url, autocommit=True) as admin:
            admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
