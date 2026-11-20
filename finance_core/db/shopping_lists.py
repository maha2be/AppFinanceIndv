"""Shopping list and checklist item repository shared across SQLite and PostgreSQL."""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from typing import Optional

from ..services.transaction_service import find_or_create_category
from .connection import is_postgres
from .transactions import Transaction, create_transaction

_UNSET = object()

EXPENSE_CATEGORY_NAME = "Belanja"


@dataclass(frozen=True)
class ShoppingListItem:
    id: int
    list_id: int
    user_id: int
    group_name: str
    name: str
    price: Optional[int]
    is_checked: bool
    transaction_id: Optional[int]
    position: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass(frozen=True)
class ShoppingListSummary:
    id: int
    user_id: int
    title: str
    budget_amount: Optional[int]
    notes: Optional[str]
    item_count: int
    checked_count: int
    planned_total: int
    checked_total: int
    unrecorded_checked_total: int
    recorded_total: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def _row_to_item(row: sqlite3.Row) -> ShoppingListItem:
    keys = row.keys()
    return ShoppingListItem(
        id=int(row["id"]),
        list_id=int(row["list_id"]),
        user_id=int(row["user_id"]),
        group_name=str(row["group_name"]),
        name=str(row["name"]),
        price=int(row["price"]) if row["price"] is not None else None,
        is_checked=bool(row["is_checked"]),
        transaction_id=int(row["transaction_id"]) if row["transaction_id"] is not None else None,
        position=int(row["position"]),
        created_at=row["created_at"] if "created_at" in keys else None,
        updated_at=row["updated_at"] if "updated_at" in keys else None,
    )


def _compute_totals(items: list[ShoppingListItem]) -> tuple[int, int, int, int, int, int]:
    item_count = len(items)
    checked_count = 0
    planned_total = 0
    checked_total = 0
    unrecorded_checked_total = 0
    recorded_total = 0

    for item in items:
        price = item.price or 0
        planned_total += price
        if item.is_checked:
            checked_count += 1
            checked_total += price
            if item.transaction_id is None and price > 0:
                unrecorded_checked_total += price
        if item.transaction_id is not None:
            recorded_total += price

    return (
        item_count,
        checked_count,
        planned_total,
        checked_total,
        unrecorded_checked_total,
        recorded_total,
    )


def _clean_title(title: str) -> str:
    cleaned = title.strip()
    if not cleaned:
        raise ValueError("Judul daftar belanja tidak boleh kosong.")
    if len(cleaned) > 100:
        raise ValueError("Judul maksimal 100 karakter.")
    return cleaned


def _clean_group(group_name: str | None) -> str:
    cleaned = (group_name or "").strip() or "Umum"
    if len(cleaned) > 60:
        raise ValueError("Nama grup maksimal 60 karakter.")
    return cleaned


def _clean_item_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Nama item tidak boleh kosong.")
    if len(cleaned) > 120:
        raise ValueError("Nama item maksimal 120 karakter.")
    return cleaned


def _clean_notes(notes: str | None) -> str | None:
    if notes is None:
        return None
    cleaned = notes.strip()
    if not cleaned:
        return None
    if len(cleaned) > 1000:
        raise ValueError("Catatan maksimal 1000 karakter.")
    return cleaned


def _build_summary(
    row: sqlite3.Row,
    items: list[ShoppingListItem],
) -> ShoppingListSummary:
    (
        item_count,
        checked_count,
        planned_total,
        checked_total,
        unrecorded_checked_total,
        recorded_total,
    ) = _compute_totals(items)
    keys = row.keys()
    return ShoppingListSummary(
        id=int(row["id"]),
        user_id=int(row["user_id"]),
        title=str(row["title"]),
        budget_amount=int(row["budget_amount"]) if row["budget_amount"] is not None else None,
        notes=row["notes"],
        item_count=item_count,
        checked_count=checked_count,
        planned_total=planned_total,
        checked_total=checked_total,
        unrecorded_checked_total=unrecorded_checked_total,
        recorded_total=recorded_total,
        created_at=row["created_at"] if "created_at" in keys else None,
        updated_at=row["updated_at"] if "updated_at" in keys else None,
    )


def list_shopping_lists(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    limit: int = 50,
    offset: int = 0,
) -> list[ShoppingListSummary]:
    """Return owned shopping lists ordered newest first with aggregated totals."""

    connection.row_factory = sqlite3.Row
    list_rows = connection.execute(
        """
        SELECT id, user_id, title, budget_amount, notes, created_at, updated_at
        FROM shopping_lists
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        (user_id, limit, offset),
    ).fetchall()
    if not list_rows:
        return []

    list_ids = [int(row["id"]) for row in list_rows]
    placeholders = ", ".join("?" for _ in list_ids)
    item_rows = connection.execute(
        f"""
        SELECT id, list_id, user_id, group_name, name, price, is_checked,
               transaction_id, position, created_at, updated_at
        FROM shopping_list_items
        WHERE user_id = ? AND list_id IN ({placeholders})
        ORDER BY position ASC, id ASC
        """,
        (user_id, *list_ids),
    ).fetchall()

    items_by_list: dict[int, list[ShoppingListItem]] = {list_id: [] for list_id in list_ids}
    for item_row in item_rows:
        item = _row_to_item(item_row)
        items_by_list[item.list_id].append(item)

    return [_build_summary(row, items_by_list[int(row["id"])]) for row in list_rows]


def get_shopping_list_detail(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    for_update: bool = False,
) -> tuple[ShoppingListSummary, list[ShoppingListItem]] | None:
    """Return one owned shopping list and its items, or None if not found."""

    connection.row_factory = sqlite3.Row
    lock_clause = " FOR UPDATE" if for_update and is_postgres(connection) else ""
    row = connection.execute(
        f"""
        SELECT id, user_id, title, budget_amount, notes, created_at, updated_at
        FROM shopping_lists
        WHERE id = ? AND user_id = ?{lock_clause}
        """,
        (list_id, user_id),
    ).fetchone()
    if row is None:
        return None

    item_rows = connection.execute(
        f"""
        SELECT id, list_id, user_id, group_name, name, price, is_checked,
               transaction_id, position, created_at, updated_at
        FROM shopping_list_items
        WHERE list_id = ? AND user_id = ?
        ORDER BY position ASC, id ASC{lock_clause}
        """,
        (list_id, user_id),
    ).fetchall()
    items = [_row_to_item(item_row) for item_row in item_rows]
    return _build_summary(row, items), items


def create_shopping_list(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    title: str,
    budget_amount: int | None = None,
    notes: str | None = None,
    items: list[dict] | None = None,
) -> tuple[ShoppingListSummary, list[ShoppingListItem]]:
    """Create a shopping list and optional initial items inside the active transaction."""

    cleaned_title = _clean_title(title)
    cleaned_notes = _clean_notes(notes)
    if budget_amount is not None and budget_amount <= 0:
        raise ValueError("Target budget harus lebih dari 0.")

    connection.row_factory = sqlite3.Row
    cursor = connection.execute(
        """
        INSERT INTO shopping_lists (user_id, title, budget_amount, notes)
        VALUES (?, ?, ?, ?)
        """,
        (user_id, cleaned_title, budget_amount, cleaned_notes),
    )
    list_id = int(cursor.lastrowid)

    if items:
        for index, raw_item in enumerate(items):
            add_shopping_list_item(
                connection,
                user_id=user_id,
                list_id=list_id,
                group_name=raw_item.get("group_name"),
                name=raw_item["name"],
                price=raw_item.get("price"),
                is_checked=bool(raw_item.get("is_checked", False)),
                position=index,
            )

    detail = get_shopping_list_detail(connection, user_id=user_id, list_id=list_id)
    if detail is None:
        raise RuntimeError("Failed to create shopping list")
    return detail


def update_shopping_list(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    title: str | object = _UNSET,
    budget_amount: int | None | object = _UNSET,
    notes: str | None | object = _UNSET,
) -> tuple[ShoppingListSummary, list[ShoppingListItem]] | None:
    """Update metadata fields on an owned shopping list."""

    current = get_shopping_list_detail(connection, user_id=user_id, list_id=list_id)
    if current is None:
        return None
    summary, _ = current

    next_title = summary.title if title is _UNSET else _clean_title(str(title))
    if budget_amount is _UNSET:
        next_budget = summary.budget_amount
    elif budget_amount is None:
        next_budget = None
    else:
        next_budget = int(budget_amount)  # type: ignore[arg-type]
        if next_budget <= 0:
            raise ValueError("Target budget harus lebih dari 0.")

    next_notes = (
        summary.notes
        if notes is _UNSET
        else _clean_notes(notes if isinstance(notes, str) or notes is None else str(notes))
    )

    connection.execute(
        """
        UPDATE shopping_lists
        SET title = ?, budget_amount = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        """,
        (next_title, next_budget, next_notes, list_id, user_id),
    )
    return get_shopping_list_detail(connection, user_id=user_id, list_id=list_id)


def delete_shopping_list(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
) -> bool:
    """Delete an owned shopping list (its items cascade; linked expenses stay)."""

    cursor = connection.execute(
        "DELETE FROM shopping_lists WHERE id = ? AND user_id = ?",
        (list_id, user_id),
    )
    return cursor.rowcount > 0


def duplicate_shopping_list(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    title: str | None = None,
) -> tuple[ShoppingListSummary, list[ShoppingListItem]] | None:
    """Clone an owned shopping list with all items unchecked and unlinked."""

    source = get_shopping_list_detail(connection, user_id=user_id, list_id=list_id)
    if source is None:
        return None
    summary, items = source

    new_title = _clean_title(title) if title is not None else _clean_title(f"{summary.title} (Salinan)")
    cloned_items = [
        {
            "group_name": item.group_name,
            "name": item.name,
            "price": item.price,
            "is_checked": False,
        }
        for item in items
    ]
    return create_shopping_list(
        connection,
        user_id=user_id,
        title=new_title,
        budget_amount=summary.budget_amount,
        notes=summary.notes,
        items=cloned_items,
    )


def add_shopping_list_item(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    group_name: str | None = None,
    name: str,
    price: int | None = None,
    is_checked: bool = False,
    position: int | None = None,
) -> ShoppingListItem | None:
    """Add one item to an owned shopping list, or return None if the list isn't owned."""

    owner_row = connection.execute(
        "SELECT id FROM shopping_lists WHERE id = ? AND user_id = ?",
        (list_id, user_id),
    ).fetchone()
    if owner_row is None:
        return None

    cleaned_group = _clean_group(group_name)
    cleaned_name = _clean_item_name(name)
    if price is not None and price < 0:
        raise ValueError("Harga item tidak boleh negatif.")

    if position is None:
        max_row = connection.execute(
            "SELECT COALESCE(MAX(position), -1) FROM shopping_list_items WHERE list_id = ? AND user_id = ?",
            (list_id, user_id),
        ).fetchone()
        position = int(max_row[0]) + 1

    connection.row_factory = sqlite3.Row
    cursor = connection.execute(
        """
        INSERT INTO shopping_list_items
            (list_id, user_id, group_name, name, price, is_checked, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (list_id, user_id, cleaned_group, cleaned_name, price, 1 if is_checked else 0, position),
    )
    item_id = int(cursor.lastrowid)
    connection.execute(
        "UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        (list_id, user_id),
    )
    row = connection.execute(
        """
        SELECT id, list_id, user_id, group_name, name, price, is_checked,
               transaction_id, position, created_at, updated_at
        FROM shopping_list_items
        WHERE id = ? AND list_id = ? AND user_id = ?
        """,
        (item_id, list_id, user_id),
    ).fetchone()
    return None if row is None else _row_to_item(row)


def update_shopping_list_item(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    item_id: int,
    group_name: str | object = _UNSET,
    name: str | object = _UNSET,
    price: int | None | object = _UNSET,
    is_checked: bool | object = _UNSET,
) -> ShoppingListItem | None:
    """Update an owned shopping list item."""

    connection.row_factory = sqlite3.Row
    row = connection.execute(
        """
        SELECT id, list_id, user_id, group_name, name, price, is_checked,
               transaction_id, position, created_at, updated_at
        FROM shopping_list_items
        WHERE id = ? AND list_id = ? AND user_id = ?
        """,
        (item_id, list_id, user_id),
    ).fetchone()
    if row is None:
        return None
    current = _row_to_item(row)

    next_group = current.group_name if group_name is _UNSET else _clean_group(str(group_name))
    next_name = current.name if name is _UNSET else _clean_item_name(str(name))
    if price is _UNSET:
        next_price = current.price
    elif price is None:
        next_price = None
    else:
        next_price = int(price)  # type: ignore[arg-type]
        if next_price < 0:
            raise ValueError("Harga item tidak boleh negatif.")
    next_checked = current.is_checked if is_checked is _UNSET else bool(is_checked)

    connection.execute(
        """
        UPDATE shopping_list_items
        SET group_name = ?, name = ?, price = ?, is_checked = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND list_id = ? AND user_id = ?
        """,
        (next_group, next_name, next_price, 1 if next_checked else 0, item_id, list_id, user_id),
    )
    connection.execute(
        "UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        (list_id, user_id),
    )

    updated = connection.execute(
        """
        SELECT id, list_id, user_id, group_name, name, price, is_checked,
               transaction_id, position, created_at, updated_at
        FROM shopping_list_items
        WHERE id = ? AND list_id = ? AND user_id = ?
        """,
        (item_id, list_id, user_id),
    ).fetchone()
    return None if updated is None else _row_to_item(updated)


def delete_shopping_list_item(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    item_id: int,
) -> bool:
    """Delete one item from an owned shopping list."""

    cursor = connection.execute(
        "DELETE FROM shopping_list_items WHERE id = ? AND list_id = ? AND user_id = ?",
        (item_id, list_id, user_id),
    )
    if cursor.rowcount > 0:
        connection.execute(
            "UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
            (list_id, user_id),
        )
        return True
    return False


def record_shopping_list_expense(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    list_id: int,
    transaction_date: str,
) -> tuple[Transaction, ShoppingListSummary, list[ShoppingListItem]] | None:
    """Atomically convert unrecorded checked items with positive prices into one expense."""

    detail = get_shopping_list_detail(
        connection,
        user_id=user_id,
        list_id=list_id,
        for_update=True,
    )
    if detail is None:
        return None
    summary, items = detail

    pending_items = [
        item
        for item in items
        if item.is_checked and item.transaction_id is None and (item.price or 0) > 0
    ]
    if not pending_items:
        raise ValueError("Centang minimal satu item berharga lebih dari Rp0 yang belum tercatat.")

    total_amount = sum(item.price or 0 for item in pending_items)
    category_id = find_or_create_category(
        connection,
        user_id=user_id,
        category_type="expense",
        category_name=EXPENSE_CATEGORY_NAME,
    )
    note = f"{summary.title} ({len(pending_items)} item)"[:500]
    tx = create_transaction(
        connection,
        user_id=user_id,
        type="expense",
        category_id=category_id,
        amount=total_amount,
        note=note,
        asset_name=None,
        transaction_date=transaction_date,
        source_key=f"shopping_list:{user_id}:{list_id}:{uuid.uuid4().hex}",
    )

    pending_ids = [item.id for item in pending_items]
    placeholders = ", ".join("?" for _ in pending_ids)
    connection.execute(
        f"""
        UPDATE shopping_list_items
        SET transaction_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND list_id = ? AND id IN ({placeholders}) AND transaction_id IS NULL
        """,
        (tx.id, user_id, list_id, *pending_ids),
    )
    connection.execute(
        "UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        (list_id, user_id),
    )

    refreshed = get_shopping_list_detail(connection, user_id=user_id, list_id=list_id)
    if refreshed is None:
        raise RuntimeError("Shopping list disappeared after recording expense")
    refreshed_summary, refreshed_items = refreshed
    return tx, refreshed_summary, refreshed_items
