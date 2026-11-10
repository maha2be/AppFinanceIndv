"""Tests for Bot04 transaction repository."""

from __future__ import annotations

import sqlite3

from finance_core.db.categories import seed_default_categories
from finance_core.db.connection import connect
from finance_core.db.migrations import init_db
from finance_core.db.transactions import (
    Transaction,
    TransactionPage,
    count_transactions_by_type,
    create_transaction,
    delete_transaction,
    list_transactions,
    list_transactions_by_type,
    update_transaction,
)
from finance_core.db.users import get_or_create_user


def setup_connection() -> sqlite3.Connection:
    connection = connect(":memory:")
    init_db(connection)
    return connection


def setup_user_with_categories(
    connection: sqlite3.Connection,
    telegram_user_id: int,
) -> tuple[int, int]:
    user = get_or_create_user(connection, telegram_user_id=telegram_user_id)
    seed_default_categories(connection, user.id)
    category_id = connection.execute(
        """
        SELECT id FROM categories
        WHERE user_id = ? AND type = 'expense' AND name = 'Makan & Minum'
        """,
        (user.id,),
    ).fetchone()[0]
    return user.id, category_id


def test_create_transaction_persists_and_returns_transaction() -> None:
    connection = setup_connection()
    user_id, category_id = setup_user_with_categories(connection, 796529359)

    transaction = create_transaction(
        connection,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=25000,
        note="kopi pagi",
        asset_name=None,
        transaction_date="2026-05-30",
    )

    assert transaction == Transaction(
        id=1,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=25000,
        note="kopi pagi",
        asset_name=None,
        transaction_date="2026-05-30",
        category_name="Makan & Minum",
    )
    row_count = connection.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    assert row_count == 1


def test_list_transactions_filters_by_user_and_date_range() -> None:
    connection = setup_connection()
    first_user_id, first_category_id = setup_user_with_categories(connection, 1)
    second_user_id, second_category_id = setup_user_with_categories(connection, 2)
    expected = create_transaction(
        connection,
        user_id=first_user_id,
        type="expense",
        category_id=first_category_id,
        amount=10000,
        note="inside range",
        asset_name=None,
        transaction_date="2026-05-15",
    )
    create_transaction(
        connection,
        user_id=first_user_id,
        type="expense",
        category_id=first_category_id,
        amount=20000,
        note="outside range",
        asset_name=None,
        transaction_date="2026-06-01",
    )
    create_transaction(
        connection,
        user_id=second_user_id,
        type="expense",
        category_id=second_category_id,
        amount=30000,
        note="other user",
        asset_name=None,
        transaction_date="2026-05-15",
    )

    transactions = list_transactions(
        connection,
        user_id=first_user_id,
        start_date="2026-05-01",
        end_date="2026-05-31",
    )

    assert transactions == [expected]


def test_list_transactions_by_type_filters_user_type_orders_newest_and_paginates() -> None:
    connection = setup_connection()
    user_id, category_id = setup_user_with_categories(connection, 1)
    other_user_id, other_category_id = setup_user_with_categories(connection, 2)

    expected_page_one: list[Transaction] = []
    expected_page_two: list[Transaction] = []
    for index in range(12):
        transaction = create_transaction(
            connection,
            user_id=user_id,
            type="income",
            category_id=None,
            amount=100_000 + index,
            note=f"income {index}",
            asset_name=None,
            transaction_date=f"2026-05-{index + 1:02d}",
        )
        if index >= 2:
            expected_page_one.append(transaction)
        else:
            expected_page_two.append(transaction)

    same_day_older = create_transaction(
        connection,
        user_id=user_id,
        type="income",
        category_id=None,
        amount=50_000,
        note="same day older id",
        asset_name=None,
        transaction_date="2026-05-12",
    )
    same_day_newer = create_transaction(
        connection,
        user_id=user_id,
        type="income",
        category_id=None,
        amount=60_000,
        note="same day newer id",
        asset_name=None,
        transaction_date="2026-05-12",
    )
    create_transaction(
        connection,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=25_000,
        note="wrong type",
        asset_name=None,
        transaction_date="2026-05-13",
    )
    create_transaction(
        connection,
        user_id=user_id,
        type="investment",
        category_id=None,
        amount=75_000,
        note="wrong type investment",
        asset_name="BTC",
        transaction_date="2026-05-14",
    )
    create_transaction(
        connection,
        user_id=other_user_id,
        type="income",
        category_id=other_category_id,
        amount=999_000,
        note="other user",
        asset_name=None,
        transaction_date="2026-05-15",
    )

    page_one = list_transactions_by_type(
        connection,
        user_id=user_id,
        transaction_type="income",
        limit=10,
        offset=0,
    )
    page_two = list_transactions_by_type(
        connection,
        user_id=user_id,
        transaction_type="income",
        limit=10,
        offset=10,
    )
    total = count_transactions_by_type(connection, user_id=user_id, transaction_type="income")

    assert page_one == [same_day_newer, same_day_older, *reversed(expected_page_one[-8:])]
    assert page_two == list(reversed(expected_page_two + expected_page_one[:2]))
    assert total == 14


def test_update_transaction_changes_only_owned_transaction_fields() -> None:
    connection = setup_connection()
    user_id, category_id = setup_user_with_categories(connection, 1)
    other_user_id, other_category_id = setup_user_with_categories(connection, 2)
    transaction = create_transaction(
        connection,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=10000,
        note="old note",
        asset_name=None,
        transaction_date="2026-05-15",
    )
    other_transaction = create_transaction(
        connection,
        user_id=other_user_id,
        type="expense",
        category_id=other_category_id,
        amount=99999,
        note="do not touch",
        asset_name=None,
        transaction_date="2026-05-15",
    )

    updated = update_transaction(
        connection,
        user_id=user_id,
        transaction_id=transaction.id,
        amount=15000,
        category_id=category_id,
        transaction_date="2026-05-16",
        note="updated note",
    )
    blocked_update = update_transaction(
        connection,
        user_id=user_id,
        transaction_id=other_transaction.id,
        amount=1,
        category_id=category_id,
        transaction_date="2026-05-17",
        note="leak attempt",
    )

    assert updated == Transaction(
        id=transaction.id,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=15000,
        note="updated note",
        asset_name=None,
        transaction_date="2026-05-16",
        category_name="Makan & Minum",
    )
    assert blocked_update is None


def test_delete_transaction_removes_only_owned_transaction() -> None:
    connection = setup_connection()
    user_id, category_id = setup_user_with_categories(connection, 1)
    other_user_id, other_category_id = setup_user_with_categories(connection, 2)
    transaction = create_transaction(
        connection,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=10000,
        note="delete me",
        asset_name=None,
        transaction_date="2026-05-15",
    )
    other_transaction = create_transaction(
        connection,
        user_id=other_user_id,
        type="expense",
        category_id=other_category_id,
        amount=20000,
        note="keep me",
        asset_name=None,
        transaction_date="2026-05-15",
    )

    assert delete_transaction(connection, user_id=user_id, transaction_id=other_transaction.id) is False
    assert delete_transaction(connection, user_id=user_id, transaction_id=transaction.id) is True

    assert list_transactions(
        connection,
        user_id=user_id,
        start_date="2026-05-01",
        end_date="2026-05-31",
    ) == []
    assert list_transactions(
        connection,
        user_id=other_user_id,
        start_date="2026-05-01",
        end_date="2026-05-31",
    ) == [other_transaction]


def test_repository_writes_are_rolled_back_without_a_commit(tmp_path) -> None:
    from finance_core.db.connection import connect, transaction
    from finance_core.db.migrations import init_db
    from finance_core.db.transactions import create_transaction, list_transactions
    from finance_core.db.users import get_or_create_user

    path = str(tmp_path / "unit-of-work.sqlite3")
    connection = connect(path)
    init_db(connection)
    user = get_or_create_user(connection, telegram_user_id=123)
    connection.commit()

    create_transaction(
        connection,
        user_id=user.id,
        type="expense",
        category_id=None,
        amount=1000,
        note=None,
        asset_name=None,
        transaction_date="2026-05-30",
    )
    connection.rollback()
    assert list_transactions(connection, user_id=user.id) == []

    with transaction(connection):
        create_transaction(
            connection,
            user_id=user.id,
            type="expense",
            category_id=None,
            amount=1000,
            note=None,
            asset_name=None,
            transaction_date="2026-05-30",
        )

    assert len(list_transactions(connection, user_id=user.id)) == 1
    connection.close()


def test_transaction_context_manager_rolls_back_on_exception(tmp_path) -> None:
    import pytest

    from finance_core.db.connection import connect, transaction
    from finance_core.db.migrations import init_db
    from finance_core.db.transactions import create_transaction, list_transactions
    from finance_core.db.users import get_or_create_user

    connection = connect(str(tmp_path / "rollback.sqlite3"))
    init_db(connection)
    user = get_or_create_user(connection, telegram_user_id=456)

    with pytest.raises(RuntimeError):
        with transaction(connection):
            create_transaction(
                connection,
                user_id=user.id,
                type="expense",
                category_id=None,
                amount=1000,
                note=None,
                asset_name=None,
                transaction_date="2026-05-30",
            )
            raise RuntimeError("boom")

    assert list_transactions(connection, user_id=user.id) == []
    connection.close()


# --- Paginated transaction browser -------------------------------------------

def _seed_browser_rows(connection: sqlite3.Connection, telegram_user_id: int) -> int:
    """Create 45 transactions with repeated dates, amounts and missing fields."""

    user = get_or_create_user(connection, telegram_user_id=telegram_user_id)
    seed_default_categories(connection, user.id)
    category_id = connection.execute(
        "SELECT id FROM categories WHERE user_id = ? AND type = 'expense'"
        " ORDER BY id LIMIT 1",
        (user.id,),
    ).fetchone()[0]
    for index in range(45):
        create_transaction(
            connection,
            user_id=user.id,
            type="expense" if index % 3 else "income",
            category_id=None if index % 7 == 0 else category_id,
            amount=1000 + (index % 5) * 500,
            note=None if index % 4 == 0 else f"catatan {index}",
            asset_name=None if index % 6 else f"aset {index}",
            transaction_date=f"2026-05-{1 + index % 28:02d}",
        )
    connection.commit()
    return user.id


def test_page_reads_twenty_rows_and_clamps_beyond_the_last_page() -> None:
    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    user_id = _seed_browser_rows(connection, 9001)

    first = list_transactions_page(connection, user_id=user_id, page=1, page_size=20)
    second = list_transactions_page(connection, user_id=user_id, page=2, page_size=20)
    last = list_transactions_page(connection, user_id=user_id, page=3, page_size=20)
    beyond = list_transactions_page(connection, user_id=user_id, page=99, page_size=20)

    assert (first.total, first.total_pages, first.page_size) == (45, 3, 20)
    assert [len(page.items) for page in (first, second, last)] == [20, 20, 5]
    assert beyond.page == 3 and len(beyond.items) == 5

    first_ids = {item.id for item in first.items}
    second_ids = {item.id for item in second.items}
    last_ids = {item.id for item in last.items}
    assert not (first_ids & second_ids) and not (second_ids & last_ids)
    assert len(first_ids | second_ids | last_ids) == 45


def test_page_count_and_rows_stay_owner_scoped() -> None:
    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    owner_id = _seed_browser_rows(connection, 9002)
    other = get_or_create_user(connection, telegram_user_id=9003)
    create_transaction(
        connection,
        user_id=other.id,
        type="expense",
        category_id=None,
        amount=12345,
        note="milik orang lain",
        asset_name=None,
        transaction_date="2026-05-10",
    )
    connection.commit()

    page = list_transactions_page(
        connection, user_id=owner_id, page=1, page_size=20, search="milik orang lain"
    )

    assert page.total == 0
    assert page.items == []
    assert page.total_pages == 0
    assert page.page == 1


def test_page_filters_by_text_type_amount_and_dates_together() -> None:
    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    user_id = _seed_browser_rows(connection, 9004)

    found = list_transactions_page(
        connection,
        user_id=user_id,
        search="  CATATAN 1  ",
        start_date="2026-05-01",
        end_date="2026-05-28",
        sort="date_asc",
    )
    assert found.total > 0
    for item in found.items:
        assert (item.note or "").lower().find("catatan 1") >= 0

    incomes = list_transactions_page(
        connection, user_id=user_id, transaction_type="income", page_size=20
    )
    assert incomes.total == 15
    assert all(item.type == "income" for item in incomes.items)

    bounded = list_transactions_page(
        connection, user_id=user_id, min_amount=2000, max_amount=2500
    )
    assert bounded.total > 0
    assert all(2000 <= item.amount <= 2500 for item in bounded.items)


def test_page_search_treats_like_wildcards_as_literal_text() -> None:
    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    user = get_or_create_user(connection, telegram_user_id=9005)
    for note in ("diskon 50% hari ini", "diskon 5000 hari ini", "pakai_kartu"):
        create_transaction(
            connection,
            user_id=user.id,
            type="expense",
            category_id=None,
            amount=1000,
            note=note,
            asset_name=None,
            transaction_date="2026-05-10",
        )
    connection.commit()

    percent = list_transactions_page(connection, user_id=user.id, search="50%")
    underscore = list_transactions_page(connection, user_id=user.id, search="ai_ka")

    assert [item.note for item in percent.items] == ["diskon 50% hari ini"]
    assert [item.note for item in underscore.items] == ["pakai_kartu"]


def test_page_sorting_is_stable_and_allowlisted() -> None:
    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    user_id = _seed_browser_rows(connection, 9006)

    newest = list_transactions_page(connection, user_id=user_id, sort="date_desc")
    oldest = list_transactions_page(connection, user_id=user_id, sort="date_asc")
    largest = list_transactions_page(connection, user_id=user_id, sort="amount_desc")
    smallest = list_transactions_page(connection, user_id=user_id, sort="amount_asc")
    injected = list_transactions_page(
        connection, user_id=user_id, sort="amount DESC; DROP TABLE transactions"
    )

    assert [item.transaction_date for item in newest.items] == sorted(
        (item.transaction_date for item in newest.items), reverse=True
    )
    assert oldest.items[0].transaction_date <= newest.items[0].transaction_date
    assert [item.amount for item in largest.items] == sorted(
        (item.amount for item in largest.items), reverse=True
    )
    assert [item.amount for item in smallest.items] == sorted(
        item.amount for item in smallest.items
    )
    assert [item.id for item in injected.items] == [item.id for item in newest.items]


def test_page_empty_filter_returns_zero_pages() -> None:
    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    user_id = _seed_browser_rows(connection, 9007)

    page = list_transactions_page(connection, user_id=user_id, search="tidak pernah ada")

    assert page == TransactionPage(items=[], total=0, page=1, page_size=20, total_pages=0)


def test_page_search_folds_case_on_both_sides() -> None:
    """Fold the pattern in SQL, not Python, so ASCII case always matches.

    SQLite folds ASCII letters only. Uppercase queries against non-ASCII text
    work because both sides go through the same LOWER; full Unicode folding is a
    PostgreSQL behaviour and is not promised for SQLite.
    """

    from finance_core.db.transactions import list_transactions_page

    connection = setup_connection()
    user = get_or_create_user(connection, telegram_user_id=9010)
    create_transaction(
        connection,
        user_id=user.id,
        type="expense",
        category_id=None,
        amount=1000,
        note="Kopi ÉCLAIR",
        asset_name=None,
        transaction_date="2026-05-10",
    )
    connection.commit()

    assert list_transactions_page(connection, user_id=user.id, search="KOPI ÉCLAIR").total == 1
    assert list_transactions_page(connection, user_id=user.id, search="ÉCLAIR").total == 1
    assert list_transactions_page(connection, user_id=user.id, search="KOPI").total == 1
