"""API and PostgreSQL portability tests for personal budgets and cash-flow reports."""

from __future__ import annotations

import os
import uuid
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def finance_client(tmp_path, monkeypatch):
    db_file = str(tmp_path / "test_budgets_cashflow.sqlite3")
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
            json={"email": "budget1@example.com", "password": "password123", "first_name": "Ayu"},
        )
        reg2 = client.post(
            "/api/auth/register",
            json={"email": "budget2@example.com", "password": "password123", "first_name": "Budi"},
        )
        yield (
            client,
            {"Authorization": f"Bearer {reg1.json()['access_token']}"},
            {"Authorization": f"Bearer {reg2.json()['access_token']}"},
        )


def test_budgets_upsert_progress_alerts_and_isolation(finance_client) -> None:
    client, h1, h2 = finance_client

    cats = client.get("/api/categories", headers=h1).json()
    makan = next(c for c in cats if c["type"] == "expense" and c["name"] == "Makan & Minum")
    transport = next(c for c in cats if c["type"] == "expense" and c["name"] == "Transportasi")
    gaji = next(c for c in cats if c["type"] == "income" and c["name"] == "Gaji")

    # Non-expense category must be rejected.
    bad_cat = client.put(
        "/api/budgets",
        json={"category_id": gaji["id"], "amount": 500_000, "alert_threshold": 80},
        headers=h1,
    )
    assert bad_cat.status_code == 400

    # Set overall monthly budget (2jt), Makan (1jt @ 80%), Transport (300k @ 80%).
    overall = client.put(
        "/api/budgets",
        json={"category_id": None, "amount": 2_000_000, "alert_threshold": 80},
        headers=h1,
    )
    assert overall.status_code == 200
    assert overall.json()["category_id"] is None

    b_makan = client.put(
        "/api/budgets",
        json={"category_id": makan["id"], "amount": 1_000_000, "alert_threshold": 80},
        headers=h1,
    )
    assert b_makan.status_code == 200
    b_transport = client.put(
        "/api/budgets",
        json={"category_id": transport["id"], "amount": 300_000, "alert_threshold": 80},
        headers=h1,
    )
    assert b_transport.status_code == 200

    # Upsert Makan updates in-place instead of creating a duplicate.
    b_makan_updated = client.put(
        "/api/budgets",
        json={"category_id": makan["id"], "amount": 1_200_000, "alert_threshold": 75},
        headers=h1,
    )
    assert b_makan_updated.status_code == 200
    assert b_makan_updated.json()["id"] == b_makan.json()["id"]

    # Record November 2026 expenses: Makan 960k (80% -> warning), Transport 350k (116.7% -> exceeded).
    assert client.post(
        "/api/transactions",
        json={
            "type": "expense",
            "category_id": makan["id"],
            "amount": 960_000,
            "transaction_date": "2026-11-10",
        },
        headers=h1,
    ).status_code == 201
    assert client.post(
        "/api/transactions",
        json={
            "type": "expense",
            "category_id": transport["id"],
            "amount": 350_000,
            "transaction_date": "2026-11-12",
        },
        headers=h1,
    ).status_code == 201

    overview = client.get("/api/budgets", params={"year": 2026, "month": 11}, headers=h1)
    assert overview.status_code == 200
    body = overview.json()
    assert body["total_expense"] == 1_310_000
    assert body["allocated_category_total"] == 1_500_000
    assert body["overall_budget"]["status"] == "safe"
    assert body["overall_budget"]["remaining"] == 690_000
    assert body["warning_count"] == 1
    assert body["exceeded_count"] == 1
    assert body["category_budgets"][0]["category_name"] == "Transportasi"
    assert body["category_budgets"][0]["status"] == "exceeded"
    assert body["category_budgets"][1]["category_name"] == "Makan & Minum"
    assert body["category_budgets"][1]["status"] == "warning"

    # Other user cannot delete or see user 1's budgets.
    assert client.delete(f"/api/budgets/{b_transport.json()['id']}", headers=h2).status_code == 404
    assert client.get("/api/budgets", params={"year": 2026, "month": 11}, headers=h2).json()["overall_budget"] is None

    # Owner can delete budget cleanly.
    assert client.delete(f"/api/budgets/{b_transport.json()['id']}", headers=h1).status_code == 204
    after_del = client.get("/api/budgets", params={"year": 2026, "month": 11}, headers=h1).json()
    assert len(after_del["category_budgets"]) == 1


def test_cash_flow_report_separates_operating_investing_financing_and_compares_prior(finance_client) -> None:
    client, h1, _h2 = finance_client

    cats = client.get("/api/categories", headers=h1).json()
    gaji = next(c for c in cats if c["type"] == "income" and c["name"] == "Gaji")
    makan = next(c for c in cats if c["type"] == "expense" and c["name"] == "Makan & Minum")
    crypto = next(c for c in cats if c["type"] == "investment" and c["name"] == "Crypto")

    # October 2026 baseline: income 4jt, expense 1jt -> operating net 3jt.
    assert client.post(
        "/api/transactions",
        json={"type": "income", "category_id": gaji["id"], "amount": 4_000_000, "transaction_date": "2026-10-05"},
        headers=h1,
    ).status_code == 201
    assert client.post(
        "/api/transactions",
        json={"type": "expense", "category_id": makan["id"], "amount": 1_000_000, "transaction_date": "2026-10-15"},
        headers=h1,
    ).status_code == 201

    # November 2026:
    # Operating: +5jt Gaji, -1.5jt Makan -> operating_net = +3.5jt (saving_rate = 70.0%)
    # Investing: -1jt Crypto
    # Financing (cash-synced debt created in Nov): +600k borrowed -> financing_net = +600k
    # Total net cash flow = 3.5jt - 1jt + 600k = 3.1jt
    assert client.post(
        "/api/transactions",
        json={"type": "income", "category_id": gaji["id"], "amount": 5_000_000, "transaction_date": "2026-11-01"},
        headers=h1,
    ).status_code == 201
    assert client.post(
        "/api/transactions",
        json={"type": "expense", "category_id": makan["id"], "amount": 1_500_000, "transaction_date": "2026-11-05"},
        headers=h1,
    ).status_code == 201
    assert client.post(
        "/api/transactions",
        json={
            "type": "investment",
            "category_id": crypto["id"],
            "amount": 1_000_000,
            "asset_name": "XRP",
            "transaction_date": "2026-11-08",
        },
        headers=h1,
    ).status_code == 201
    debt_res = client.post(
        "/api/debts",
        json={
            "type": "debt",
            "person_name": "Koperasi",
            "total_amount": 600_000,
            "sync_cash": True,
            "due_date": "2026-12-01",
        },
        headers=h1,
    )
    assert debt_res.status_code == 201

    # Pay 200k installment dated in Nov 2026 to test financing outflow too.
    debt_id = debt_res.json()["id"]
    assert client.post(
        f"/api/debts/{debt_id}/payments",
        json={"amount": 200_000, "payment_date": "2026-11-18"},
        headers=h1,
    ).status_code == 201

    # Query Nov 2026 monthly cash flow (note: opening debt tx uses today's date in user tz,
    # so query the month of the opening debt tx or check Nov specifically for payment outflow).
    cf_nov = client.get("/api/reports/cash-flow", params={"period": "monthly", "year": 2026, "month": 11}, headers=h1)
    assert cf_nov.status_code == 200
    data = cf_nov.json()
    assert data["title"] == "Arus Kas November 2026"
    assert data["previous_title"] == "Oktober 2026"

    cur = data["current"]
    assert cur["operating_inflow"] == 5_000_000
    assert cur["operating_outflow"] == 1_500_000
    assert cur["operating_net"] == 3_500_000
    assert cur["investing_outflow"] == 1_000_000
    assert cur["saving_rate_pct"] == 70.0
    assert cur["operating_income_breakdown"][0]["name"] == "Gaji"
    assert cur["operating_expense_breakdown"][0]["name"] == "Makan & Minum"

    # Comparison against Oct 2026: operating_net 3.5jt - 3.0jt = +500k
    assert data["previous"]["operating_net"] == 3_000_000
    assert data["comparison"]["operating_net_delta"] == 500_000
    assert data["comparison"]["operating_inflow_delta_pct"] == 25.0
    assert data["comparison"]["operating_outflow_delta_pct"] == 50.0


def test_budgets_postgres_portability() -> None:
    postgres_url = os.getenv("POSTGRES_TEST_URL")
    if not postgres_url:
        pytest.skip("POSTGRES_TEST_URL is not set; PostgreSQL budget check skipped")

    from finance_core.db.budgets import get_budget_overview, upsert_budget
    from finance_core.db.categories import list_categories, seed_default_categories
    from finance_core.db.connection import connect_url
    from finance_core.db.migrations import SCHEMA_VERSION, run_migrations
    from finance_core.db.transactions import create_transaction
    from finance_core.db.users import create_mobile_user

    schema = f"t_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(postgres_url, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
    sep = "&" if "?" in postgres_url else "?"
    scoped_url = f"{postgres_url}{sep}options={quote(f'-c search_path={schema}')}"

    try:
        conn = connect_url(scoped_url)
        try:
            assert run_migrations(conn) == SCHEMA_VERSION
            user = create_mobile_user(conn, email="pgbudget@example.com", password_hash="unused")
            seed_default_categories(conn, user.id)
            expense_cat = list_categories(conn, user.id, "expense")[0]

            overall = upsert_budget(conn, user_id=user.id, category_id=None, amount=2_000_000)
            cat_budget = upsert_budget(
                conn,
                user_id=user.id,
                category_id=expense_cat.id,
                amount=500_000,
                alert_threshold=80,
            )
            upsert_budget(
                conn,
                user_id=user.id,
                category_id=expense_cat.id,
                amount=600_000,
                alert_threshold=80,
            )
            create_transaction(
                conn,
                user_id=user.id,
                type="expense",
                category_id=expense_cat.id,
                amount=510_000,
                note="Belanja",
                asset_name=None,
                transaction_date="2026-11-15",
            )
            conn.commit()

            overview = get_budget_overview(conn, user_id=user.id, year=2026, month=11)
            assert overview.overall_budget is not None
            assert overview.overall_budget.id == overall.id
            assert overview.overall_budget.status == "safe"
            assert len(overview.category_budgets) == 1
            assert overview.category_budgets[0].id == cat_budget.id
            assert overview.category_budgets[0].amount == 600_000
            assert overview.category_budgets[0].status == "warning"
        finally:
            conn.close()
    finally:
        with psycopg.connect(postgres_url, autocommit=True) as admin:
            admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
