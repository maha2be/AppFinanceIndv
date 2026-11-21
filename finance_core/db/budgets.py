"""Personal monthly budgets repository shared across SQLite and PostgreSQL."""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Literal, Optional

from ..reports.date_ranges import month_range
from .categories import category_belongs_to
from .transactions import list_transactions_in_range

BudgetStatus = Literal["safe", "warning", "exceeded"]


@dataclass(frozen=True)
class Budget:
    id: int
    user_id: int
    category_id: Optional[int]
    category_name: Optional[str]
    amount: int
    alert_threshold: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass(frozen=True)
class BudgetProgress:
    id: int
    user_id: int
    category_id: Optional[int]
    category_name: Optional[str]
    amount: int
    spent: int
    remaining: int
    percentage: float
    alert_threshold: int
    status: BudgetStatus


@dataclass(frozen=True)
class BudgetOverview:
    year: int
    month: int
    start_date: str
    end_date: str
    total_expense: int
    overall_budget: Optional[BudgetProgress]
    category_budgets: list[BudgetProgress]
    allocated_category_total: int
    warning_count: int
    exceeded_count: int


def _row_to_budget(row: sqlite3.Row) -> Budget:
    keys = row.keys()
    return Budget(
        id=int(row["id"]),
        user_id=int(row["user_id"]),
        category_id=int(row["category_id"]) if row["category_id"] is not None else None,
        category_name=row["category_name"] if "category_name" in keys else None,
        amount=int(row["amount"]),
        alert_threshold=int(row["alert_threshold"]),
        created_at=row["created_at"] if "created_at" in keys else None,
        updated_at=row["updated_at"] if "updated_at" in keys else None,
    )


def _fetch_budget_by_id(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    budget_id: int,
) -> Budget | None:
    connection.row_factory = sqlite3.Row
    row = connection.execute(
        """
        SELECT b.id, b.user_id, b.category_id, c.name AS category_name,
               b.amount, b.alert_threshold, b.created_at, b.updated_at
        FROM budgets b
        LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.id = ? AND b.user_id = ?
        """,
        (budget_id, user_id),
    ).fetchone()
    return None if row is None else _row_to_budget(row)


def list_budgets(
    connection: sqlite3.Connection,
    *,
    user_id: int,
) -> list[Budget]:
    """List every budget configured for the user (overall first, then categories)."""

    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT b.id, b.user_id, b.category_id, c.name AS category_name,
               b.amount, b.alert_threshold, b.created_at, b.updated_at
        FROM budgets b
        LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.user_id = ?
        ORDER BY CASE WHEN b.category_id IS NULL THEN 0 ELSE 1 END,
                 LOWER(COALESCE(c.name, '')), b.id ASC
        """,
        (user_id,),
    ).fetchall()
    return [_row_to_budget(row) for row in rows]


def upsert_budget(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    category_id: int | None,
    amount: int,
    alert_threshold: int = 80,
) -> Budget:
    """Create or update a monthly overall or expense-category budget."""

    if amount <= 0:
        raise ValueError("Nominal anggaran harus lebih dari 0.")
    if alert_threshold < 1 or alert_threshold > 100:
        raise ValueError("Ambang peringatan harus antara 1% dan 100%.")

    if category_id is not None and not category_belongs_to(
        connection,
        user_id=user_id,
        category_id=category_id,
        category_type="expense",
    ):
        raise ValueError("Kategori pengeluaran tidak ditemukan.")

    connection.row_factory = sqlite3.Row
    if category_id is None:
        existing = connection.execute(
            "SELECT id FROM budgets WHERE user_id = ? AND category_id IS NULL",
            (user_id,),
        ).fetchone()
    else:
        existing = connection.execute(
            "SELECT id FROM budgets WHERE user_id = ? AND category_id = ?",
            (user_id, category_id),
        ).fetchone()

    if existing is not None:
        budget_id = int(existing["id"])
        connection.execute(
            """
            UPDATE budgets
            SET amount = ?, alert_threshold = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (amount, alert_threshold, budget_id, user_id),
        )
    else:
        cursor = connection.execute(
            """
            INSERT INTO budgets (user_id, category_id, amount, alert_threshold)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, category_id, amount, alert_threshold),
        )
        budget_id = int(cursor.lastrowid)

    saved = _fetch_budget_by_id(connection, user_id=user_id, budget_id=budget_id)
    if saved is None:
        raise RuntimeError("Failed to save budget")
    return saved


def delete_budget(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    budget_id: int,
) -> bool:
    """Delete one owned budget."""

    cursor = connection.execute(
        "DELETE FROM budgets WHERE id = ? AND user_id = ?",
        (budget_id, user_id),
    )
    return cursor.rowcount > 0


def _build_progress(budget: Budget, spent: int) -> BudgetProgress:
    percentage = round((spent / budget.amount) * 100, 1) if budget.amount > 0 else 0.0
    if spent > budget.amount:
        status: BudgetStatus = "exceeded"
    elif percentage >= budget.alert_threshold:
        status = "warning"
    else:
        status = "safe"

    return BudgetProgress(
        id=budget.id,
        user_id=budget.user_id,
        category_id=budget.category_id,
        category_name=budget.category_name,
        amount=budget.amount,
        spent=spent,
        remaining=budget.amount - spent,
        percentage=percentage,
        alert_threshold=budget.alert_threshold,
        status=status,
    )


def get_budget_overview(
    connection: sqlite3.Connection,
    *,
    user_id: int,
    year: int,
    month: int,
) -> BudgetOverview:
    """Evaluate all configured budgets against actual expenses in the given month."""

    span = month_range(date(year, month, 1))
    start_iso = span.start_date.isoformat()
    end_iso = span.end_date.isoformat()

    transactions = list_transactions_in_range(
        connection,
        user_id=user_id,
        start_date=start_iso,
        end_date=end_iso,
    )

    total_expense = 0
    spent_by_category: dict[int, int] = defaultdict(int)
    for tx in transactions:
        if tx.type != "expense":
            continue
        total_expense += tx.amount
        if tx.category_id is not None:
            spent_by_category[tx.category_id] += tx.amount

    budgets = list_budgets(connection, user_id=user_id)
    overall_budget: BudgetProgress | None = None
    category_budgets: list[BudgetProgress] = []
    allocated_category_total = 0

    for budget in budgets:
        if budget.category_id is None:
            overall_budget = _build_progress(budget, total_expense)
        else:
            allocated_category_total += budget.amount
            spent = spent_by_category.get(budget.category_id, 0)
            category_budgets.append(_build_progress(budget, spent))

    category_budgets.sort(key=lambda item: (-item.percentage, -item.spent, item.id))

    all_progress = ([overall_budget] if overall_budget is not None else []) + category_budgets
    warning_count = sum(1 for item in all_progress if item.status == "warning")
    exceeded_count = sum(1 for item in all_progress if item.status == "exceeded")

    return BudgetOverview(
        year=year,
        month=month,
        start_date=start_iso,
        end_date=end_iso,
        total_expense=total_expense,
        overall_budget=overall_budget,
        category_budgets=category_budgets,
        allocated_category_total=allocated_category_total,
        warning_count=warning_count,
        exceeded_count=exceeded_count,
    )
