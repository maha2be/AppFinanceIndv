"""API contract for the paginated transaction browser endpoint.

The fixture seeds two owners in a temporary SQLite database. The owner under
test has 45 transactions with repeated dates and amounts, null category/note/
asset values, searchable text, and literal LIKE metacharacters. Expected pages
and orderings are computed from that same seed, so the assertions verify the
query itself rather than restating hard-coded page contents.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

ITEM_KEYS = {
    "id",
    "user_id",
    "type",
    "category_id",
    "category_name",
    "amount",
    "note",
    "asset_name",
    "transaction_date",
    "can_edit",
    "can_delete",
}

DATES = [
    "2026-01-05",
    "2026-01-04",
    "2026-01-03",
    "2026-01-02",
    "2026-01-01",
]
AMOUNTS = [10_000, 20_000, 30_000, 20_000, 50_000]
TYPES = ["expense", "income", "investment"]
TYPE_CATEGORY = {
    "expense": "Makan & Minum",
    "income": "Gaji",
    "investment": "Emas",
}
ASSETS = ["BCA", "Mandiri", "Dompet Digital"]


def _note_for(index: int) -> str | None:
    if index % 9 == 0:
        return None
    if index == 8:
        return "Kopi Spesial Pagi"
    if index == 11:
        return "Diskon 50% akhir tahun"
    if index == 13:
        return "kode_A1 khusus"
    if index == 17:
        return "promo!! seru"
    return f"Catatan transaksi {index}"


def _asset_for(index: int) -> str | None:
    if index % 8 == 0:
        return None
    if index == 9:
        return "Tabungan Emas Digital"
    return ASSETS[index % 3]


def _expected_rows(rows, *, q=None, start_date=None, end_date=None, type=None,
                   category_id=None, min_amount=None, max_amount=None):
    """Replicate the documented filter semantics over the seed rows."""

    def matches(row):
        if start_date and row["transaction_date"] < start_date:
            return False
        if end_date and row["transaction_date"] > end_date:
            return False
        if type and row["type"] != type:
            return False
        if category_id is not None and row["category_id"] != category_id:
            return False
        if min_amount is not None and row["amount"] < min_amount:
            return False
        if max_amount is not None and row["amount"] > max_amount:
            return False
        keyword = (q or "").strip().lower()
        if keyword:
            haystack = " ".join(
                [
                    (row["note"] or "").lower(),
                    (row["category_name"] or "").lower(),
                    (row["asset_name"] or "").lower(),
                ]
            )
            if keyword not in haystack:
                return False
        return True

    return [row for row in rows if matches(row)]


def _sorted(rows, sort):
    def ordinal(row):
        return date.fromisoformat(row["transaction_date"]).toordinal()

    if sort == "date_desc":
        return sorted(rows, key=lambda row: (ordinal(row), row["id"]), reverse=True)
    if sort == "date_asc":
        return sorted(rows, key=lambda row: (ordinal(row), row["id"]))
    if sort == "amount_desc":
        return sorted(
            rows, key=lambda row: (row["amount"], ordinal(row), row["id"]), reverse=True
        )
    if sort == "amount_asc":
        return sorted(rows, key=lambda row: (row["amount"], -ordinal(row), -row["id"]))
    raise AssertionError(f"unknown sort {sort}")


class BrowserFixture:
    def __init__(self, client, db_file, owner, other, rows, other_rows,
                 foreign_category_id):
        self.client = client
        self.db_file = db_file
        self.owner = owner
        self.other = other
        self.rows = rows
        self.other_rows = other_rows
        self.foreign_category_id = foreign_category_id

    def get(self, params=None, *, auth=True):
        headers = {"Authorization": f"Bearer {self.owner['token']}"} if auth else {}
        return self.client.get("/api/transactions/page", params=params, headers=headers)


def _register(client, email, first_name):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "first_name": first_name},
    )
    assert response.status_code == 201, response.text
    return response.json()["access_token"]


def _seed(connection, owner_id, other_id):
    def category_id(user_id, transaction_type, name=None):
        name = name or TYPE_CATEGORY[transaction_type]
        row = connection.execute(
            "SELECT id FROM categories WHERE user_id = ? AND type = ? AND name = ?",
            (user_id, transaction_type, name),
        ).fetchone()
        assert row is not None, f"missing seeded category {name}"
        return row[0]

    # A custom category proves the search covers owner category names, not only
    # the seeded defaults.
    cursor = connection.execute(
        """
        INSERT INTO categories (user_id, type, name, aliases, is_default)
        VALUES (?, 'expense', 'Langganan Khusus', '', 0)
        """,
        (owner_id,),
    )
    custom_category_id = cursor.lastrowid
    other_category_id = category_id(other_id, "expense")

    rows = []
    for index in range(45):
        transaction_type = TYPES[index % 3]
        category = None if index % 10 == 0 else category_id(owner_id, transaction_type)
        if index == 21:
            category = custom_category_id
        row = {
            "type": transaction_type,
            "category_id": category,
            "category_name": (
                "Langganan Khusus"
                if category == custom_category_id
                else (TYPE_CATEGORY[transaction_type] if category is not None else None)
            ),
            "amount": AMOUNTS[index % 5],
            "note": _note_for(index),
            "asset_name": _asset_for(index),
            "transaction_date": DATES[index % 5],
        }
        cursor = connection.execute(
            """
            INSERT INTO transactions (
                user_id, type, category_id, amount, note, asset_name,
                transaction_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                owner_id,
                row["type"],
                row["category_id"],
                row["amount"],
                row["note"],
                row["asset_name"],
                row["transaction_date"],
            ),
        )
        row["id"] = cursor.lastrowid
        row["user_id"] = owner_id
        rows.append(row)

    other_rows = []
    for index, amount in enumerate((1_000_000, 2_000_000, 3_000_000)):
        row = {
            "type": "expense",
            "category_id": other_category_id,
            "category_name": "Makan & Minum",
            "amount": amount,
            "note": f"Rahasia pemilik lain {index}",
            "asset_name": "Rekening Lain",
            "transaction_date": DATES[index],
        }
        cursor = connection.execute(
            """
            INSERT INTO transactions (
                user_id, type, category_id, amount, note, asset_name,
                transaction_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                other_id,
                row["type"],
                row["category_id"],
                row["amount"],
                row["note"],
                row["asset_name"],
                row["transaction_date"],
            ),
        )
        row["id"] = cursor.lastrowid
        row["user_id"] = other_id
        other_rows.append(row)

    connection.commit()
    return rows, other_rows, other_category_id


@pytest.fixture
def browser_api(tmp_path, monkeypatch):
    db_file = str(tmp_path / "browser.sqlite3")
    monkeypatch.setenv("DATABASE_PATH", db_file)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-1234567890123456789012")

    from backend.app.main import app
    from finance_core.db.connection import connect
    from finance_core.db.migrations import init_db
    from finance_core.db.users import get_user_by_email

    connection = connect(db_file)
    init_db(connection)
    connection.close()

    with TestClient(app) as client:
        owner_token = _register(client, "owner_a@example.com", "Owner A")
        other_token = _register(client, "owner_b@example.com", "Owner B")

        connection = connect(db_file)
        owner = get_user_by_email(connection, "owner_a@example.com")
        other = get_user_by_email(connection, "owner_b@example.com")
        assert owner is not None and other is not None
        rows, other_rows, foreign_category_id = _seed(connection, owner.id, other.id)
        connection.close()

        yield BrowserFixture(
            client=client,
            db_file=db_file,
            owner={"id": owner.id, "token": owner_token},
            other={"id": other.id, "token": other_token},
            rows=rows,
            other_rows=other_rows,
            foreign_category_id=foreign_category_id,
        )


def _page(browser, params=None):
    response = browser.get(params)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"items", "total", "page", "page_size", "total_pages"}
    assert body["page_size"] == 20
    for item in body["items"]:
        assert set(item) == ITEM_KEYS
    return body


def test_pages_split_the_owner_dataset_without_overlap(browser_api):
    first = _page(browser_api, {"page": 1})
    second = _page(browser_api, {"page": 2})
    third = _page(browser_api, {"page": 3})

    assert [len(page["items"]) for page in (first, second, third)] == [20, 20, 5]
    assert first["total"] == second["total"] == third["total"] == 45
    assert first["total_pages"] == second["total_pages"] == third["total_pages"] == 3
    assert [first["page"], second["page"], third["page"]] == [1, 2, 3]

    ids = [item["id"] for page in (first, second, third) for item in page["items"]]
    assert len(ids) == len(set(ids)) == 45
    assert set(ids) == {row["id"] for row in browser_api.rows}

    expected = [row["id"] for row in _sorted(browser_api.rows, "date_desc")]
    assert ids == expected[:20] + expected[20:40] + expected[40:]


def test_page_beyond_the_last_clamps_to_the_final_page(browser_api):
    body = _page(browser_api, {"page": 99})
    assert body["page"] == 3
    assert body["total_pages"] == 3
    assert body["total"] == 45
    assert len(body["items"]) == 5

    expected_tail = [row["id"] for row in _sorted(browser_api.rows, "date_desc")][40:]
    assert [item["id"] for item in body["items"]] == expected_tail


def test_combined_filters_count_before_pagination(browser_api):
    params = {
        "q": "catatan",
        "start_date": "2026-01-02",
        "end_date": "2026-01-04",
        "type": "expense",
        "min_amount": 15_000,
        "max_amount": 30_000,
    }
    body = _page(browser_api, params)
    expected = _sorted(
        _expected_rows(
            browser_api.rows,
            q="catatan",
            start_date="2026-01-02",
            end_date="2026-01-04",
            type="expense",
            min_amount=15_000,
            max_amount=30_000,
        ),
        "date_desc",
    )
    assert body["total"] == len(expected)
    assert body["total_pages"] == 1
    assert [item["id"] for item in body["items"]] == [row["id"] for row in expected]

    # The unfiltered total stays 45, so the filter really narrowed the count.
    assert _page(browser_api)["total"] == 45


def test_search_matches_note_category_and_asset_names(browser_api):
    for query in ("kopi", "langganan", "tabungan emas", "Spesial Pagi"):
        body = _page(browser_api, {"q": query})
        expected = _expected_rows(browser_api.rows, q=query)
        assert body["total"] == len(expected), query
        assert {item["id"] for item in body["items"]} == {row["id"] for row in expected}

    kopi = _page(browser_api, {"q": "kopi"})
    assert kopi["total"] >= 1
    assert any(
        "kopi" in (item["note"] or "").lower() for item in kopi["items"]
    )


def test_category_filter_is_owner_scoped_and_rejects_foreign_categories(browser_api):
    own_category = next(
        row["category_id"]
        for row in browser_api.rows
        if row["category_id"] is not None and row["category_name"] == "Makan & Minum"
    )
    body = _page(browser_api, {"category_id": own_category})
    expected = _expected_rows(browser_api.rows, category_id=own_category)
    assert body["total"] == len(expected)
    assert {item["id"] for item in body["items"]} == {row["id"] for row in expected}

    foreign = _page(browser_api, {"category_id": browser_api.foreign_category_id})
    assert foreign == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
        "total_pages": 0,
    }


def test_zero_results_return_an_empty_first_page(browser_api):
    body = _page(browser_api, {"q": "tidak ada hasil sama sekali", "page": 5})
    assert body == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
        "total_pages": 0,
    }

    empty_type_and_category = _page(
        browser_api,
        {"type": "income", "category_id": browser_api.foreign_category_id},
    )
    assert empty_type_and_category["items"] == []
    assert empty_type_and_category["total"] == 0
    assert empty_type_and_category["total_pages"] == 0


def test_owner_isolation_for_rows_and_counts(browser_api):
    other_headers = {"Authorization": f"Bearer {browser_api.other['token']}"}
    response = browser_api.client.get(
        "/api/transactions/page", params={"page": 1}, headers=other_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    assert body["total_pages"] == 1
    assert {item["id"] for item in body["items"]} == {
        row["id"] for row in browser_api.other_rows
    }
    assert all(item["user_id"] == browser_api.other["id"] for item in body["items"])
    assert "Rahasia" in body["items"][0]["note"]

    owner_ids = {item["id"] for item in _page(browser_api, {"page": 1})["items"]}
    assert owner_ids.isdisjoint({row["id"] for row in browser_api.other_rows})

    # A keyword only present in the other owner's rows must not match here.
    assert _page(browser_api, {"q": "rahasia"})["total"] == 0


@pytest.mark.parametrize(
    "sort, reverse_key",
    [
        ("date_desc", "date_desc"),
        ("date_asc", "date_asc"),
        ("amount_desc", "amount_desc"),
        ("amount_asc", "amount_asc"),
    ],
)
def test_all_sorts_are_deterministic_with_id_tie_break(browser_api, sort, reverse_key):
    expected_ids = [row["id"] for row in _sorted(browser_api.rows, reverse_key)]
    collected = []
    for page in (1, 2, 3):
        body = _page(browser_api, {"sort": sort, "page": page})
        collected.extend(item["id"] for item in body["items"])
    assert collected == expected_ids

    # Repeat the first page: live reads of an unchanged dataset are stable.
    again = _page(browser_api, {"sort": sort, "page": 1})
    assert [item["id"] for item in again["items"]] == expected_ids[:20]


def test_sort_tie_break_uses_id_not_insertion_order(browser_api):
    tied = _page(browser_api, {"sort": "date_desc", "page": 1})["items"]
    by_date = {}
    for item in tied:
        by_date.setdefault(item["transaction_date"], []).append(item["id"])
    repeated = [ids for ids in by_date.values() if len(ids) > 1]
    assert repeated, "fixture must contain repeated dates"
    for ids in repeated:
        assert ids == sorted(ids, reverse=True)


def test_invalid_parameters_are_rejected(browser_api):
    cases = [
        {"sort": "amount_sideways"},
        {"sort": "date_desc; DROP TABLE transactions"},
        {"page": 0},
        {"page": -2},
        {"start_date": "2026-03-01", "end_date": "2026-02-01"},
        {"min_amount": 50_000, "max_amount": 10_000},
        {"q": "x" * 201},
        {"type": "transfer"},
        {"category_id": 0},
        {"min_amount": 0},
    ]
    for params in cases:
        response = browser_api.get(params)
        assert response.status_code == 422, (params, response.text)

    # Boundary values that are documented as valid still pass.
    assert browser_api.get({"q": "x" * 200}).status_code == 200
    assert browser_api.get({"start_date": "2026-01-01", "end_date": "2026-01-01"}).status_code == 200
    assert browser_api.get({"min_amount": 10_000, "max_amount": 10_000}).status_code == 200


def test_fixed_page_size_ignores_a_client_page_size(browser_api):
    default_page = _page(browser_api, {"page": 1})
    oversized = _page(browser_api, {"page": 1, "page_size": 100})
    assert len(oversized["items"]) == 20
    assert oversized["page_size"] == 20
    assert [item["id"] for item in oversized["items"]] == [
        item["id"] for item in default_page["items"]
    ]


def test_blank_search_means_no_search(browser_api):
    body = _page(browser_api, {"q": "   "})
    assert body["total"] == 45
    assert len(body["items"]) == 20
    assert _page(browser_api, {"q": ""})["total"] == 45


def test_unauthenticated_reads_are_rejected(browser_api):
    response = browser_api.client.get("/api/transactions/page", headers={})
    assert response.status_code == 401
    response = browser_api.client.get(
        "/api/transactions/page", headers={"Authorization": "Bearer not-a-token"}
    )
    assert response.status_code == 401


def test_like_metacharacters_and_injection_text_stay_literal(browser_api):
    literal_cases = {
        "%": "Diskon 50% akhir tahun",
        "_": "kode_A1 khusus",
        "!": "promo!! seru",
    }
    for query, needle in literal_cases.items():
        body = _page(browser_api, {"q": query})
        expected = _expected_rows(browser_api.rows, q=query)
        assert body["total"] == len(expected), query
        assert {item["id"] for item in body["items"]} == {row["id"] for row in expected}
        assert any(needle in (item["note"] or "") for item in body["items"]), query

    wildcard_only = _page(browser_api, {"q": "%"})
    assert wildcard_only["total"] == 1  # only the note that literally has "50%"
    assert wildcard_only["items"][0]["note"] == "Diskon 50% akhir tahun"

    for injection in ("' OR 1=1 --", "'; DROP TABLE transactions; --", "%' OR '1'='1"):
        body = _page(browser_api, {"q": injection, "page": 1})
        assert body["total"] == 0, injection
        assert body["items"] == []

    # The table still has 45 owner rows after the injection-shaped reads.
    assert _page(browser_api)["total"] == 45


def test_clamped_page_after_rows_are_deleted(browser_api):
    from finance_core.db.connection import connect

    third = _page(browser_api, {"page": 3})
    deleted_ids = [item["id"] for item in third["items"]]
    assert len(deleted_ids) == 5

    connection = connect(browser_api.db_file)
    try:
        connection.executemany(
            "DELETE FROM transactions WHERE id = ?", [(item,) for item in deleted_ids]
        )
        connection.commit()
    finally:
        connection.close()

    refreshed = _page(browser_api, {"page": 3})
    assert refreshed["page"] == 2
    assert refreshed["total"] == 40
    assert refreshed["total_pages"] == 2
    assert len(refreshed["items"]) == 20
    assert {item["id"] for item in refreshed["items"]}.isdisjoint(deleted_ids)


def test_static_page_route_is_not_a_transaction_id_and_old_routes_keep_shape(browser_api):
    page_response = browser_api.get({"page": 1})
    assert page_response.status_code == 200
    assert "items" in page_response.json()

    detail_id = browser_api.rows[0]["id"]
    detail = browser_api.client.get(
        f"/api/transactions/{detail_id}",
        headers={"Authorization": f"Bearer {browser_api.owner['token']}"},
    )
    assert detail.status_code == 200
    assert set(detail.json()) == ITEM_KEYS

    old_list = browser_api.client.get(
        "/api/transactions",
        headers={"Authorization": f"Bearer {browser_api.owner['token']}"},
    )
    assert old_list.status_code == 200
    old_body = old_list.json()
    assert isinstance(old_body, list)
    assert len(old_body) == 45
    assert set(old_body[0]) == ITEM_KEYS

    history = browser_api.client.get(
        "/api/transactions/history",
        headers={"Authorization": f"Bearer {browser_api.owner['token']}"},
    )
    assert history.status_code == 200
    assert isinstance(history.json(), list)

    missing = browser_api.client.get(
        "/api/transactions/999999",
        headers={"Authorization": f"Bearer {browser_api.owner['token']}"},
    )
    assert missing.status_code == 404
