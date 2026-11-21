"""Aggregate transaction data for reports and visualization."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from ..db.transactions import Transaction, is_derived_transaction


@dataclass(frozen=True)
class CategoryTotal:
    """Total amount and percentage for one category."""

    name: str
    amount: int
    percentage: float = 0.0


@dataclass(frozen=True)
class DailyFlowPoint:
    """One day's cashflow totals and running net balance."""

    date: str
    income: int
    expense: int
    investment: int
    net: int
    cumulative_net: int


@dataclass(frozen=True)
class ReportSummary:
    """Aggregated financial summary for a transaction list."""

    total_income: int
    total_expense: int
    total_investment: int
    net: int
    average_expense: int
    top_expense_categories: list[CategoryTotal]
    investment_percentage: float


def aggregate_transactions(
    transactions: list[Transaction],
    *,
    category_names: dict[int, str] | None = None,
) -> ReportSummary:
    """Aggregate totals, net, expense categories, and investment percentage."""
    names = category_names or {}
    total_income = 0
    total_expense = 0
    total_investment = 0
    expense_count = 0
    expense_totals_by_category: dict[str, int] = defaultdict(int)

    for transaction in transactions:
        if transaction.type == "income":
            total_income += transaction.amount
        elif transaction.type == "expense":
            total_expense += transaction.amount
            expense_count += 1
            category_name = (
                transaction.category_name
                or names.get(transaction.category_id or 0, "Lainnya")
            )
            expense_totals_by_category[category_name] += transaction.amount
        elif transaction.type == "investment":
            total_investment += transaction.amount

    net = total_income - total_expense - total_investment
    average_expense = total_expense // expense_count if expense_count else 0
    investment_percentage = (
        round((total_investment / total_income) * 100, 2) if total_income > 0 else 0.0
    )

    top_expense_categories = [
        CategoryTotal(
            name=name,
            amount=amount,
            percentage=round((amount / total_expense * 100), 1) if total_expense > 0 else 0.0,
        )
        for name, amount in sorted(
            expense_totals_by_category.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]

    return ReportSummary(
        total_income=total_income,
        total_expense=total_expense,
        total_investment=total_investment,
        net=net,
        average_expense=average_expense,
        top_expense_categories=top_expense_categories,
        investment_percentage=investment_percentage,
    )


def aggregate_by_category(
    transactions: list[Transaction],
    category_type: str,
    *,
    category_names: dict[int, str] | None = None,
) -> tuple[list[CategoryTotal], int]:
    """Aggregate transactions of a specific type by category with percentages."""
    names = category_names or {}
    totals: dict[str, int] = defaultdict(int)
    total_amount = 0

    for tx in transactions:
        if tx.type == category_type:
            total_amount += tx.amount
            name = tx.category_name or names.get(tx.category_id or 0, "Lainnya")
            totals[name] += tx.amount

    items = [
        CategoryTotal(
            name=name,
            amount=amt,
            percentage=round((amt / total_amount * 100), 1) if total_amount > 0 else 0.0,
        )
        for name, amt in sorted(totals.items(), key=lambda x: -x[1])
    ]
    return items, total_amount


def aggregate_investments(
    transactions: list[Transaction],
    *,
    category_names: dict[int, str] | None = None,
) -> tuple[list[CategoryTotal], list[CategoryTotal], int]:
    """Aggregate investments by type and by asset name."""
    names = category_names or {}
    type_totals: dict[str, int] = defaultdict(int)
    asset_totals: dict[str, int] = defaultdict(int)
    total_invested = 0

    for tx in transactions:
        if tx.type == "investment":
            total_invested += tx.amount
            type_name = tx.category_name or names.get(tx.category_id or 0, "Lainnya")
            type_totals[type_name] += tx.amount
            asset = tx.asset_name or type_name
            asset_totals[asset] += tx.amount

    by_type = [
        CategoryTotal(
            name=name,
            amount=amt,
            percentage=round((amt / total_invested * 100), 1) if total_invested > 0 else 0.0,
        )
        for name, amt in sorted(type_totals.items(), key=lambda x: -x[1])
    ]

    by_asset = [
        CategoryTotal(
            name=name,
            amount=amt,
            percentage=round((amt / total_invested * 100), 1) if total_invested > 0 else 0.0,
        )
        for name, amt in sorted(asset_totals.items(), key=lambda x: -x[1])
    ]

    return by_type, by_asset, total_invested


def aggregate_daily_series(
    transactions: list[Transaction],
    *,
    start_date: date,
    end_date: date,
) -> list[DailyFlowPoint]:
    """Build a contiguous daily cashflow and cumulative net curve across [start_date, end_date]."""

    if end_date < start_date:
        return []

    buckets: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    start_iso = start_date.isoformat()
    end_iso = end_date.isoformat()

    for tx in transactions:
        if tx.transaction_date < start_iso or tx.transaction_date > end_iso:
            continue
        if tx.type == "income":
            buckets[tx.transaction_date][0] += tx.amount
        elif tx.type == "expense":
            buckets[tx.transaction_date][1] += tx.amount
        elif tx.type == "investment":
            buckets[tx.transaction_date][2] += tx.amount

    points: list[DailyFlowPoint] = []
    running_net = 0
    cursor = start_date
    while cursor <= end_date:
        iso = cursor.isoformat()
        income, expense, investment = buckets[iso]
        net = income - expense - investment
        running_net += net
        points.append(
            DailyFlowPoint(
                date=iso,
                income=income,
                expense=expense,
                investment=investment,
                net=net,
                cumulative_net=running_net,
            )
        )
        cursor += timedelta(days=1)

    return points


@dataclass(frozen=True)
class CashFlowSummary:
    """Structured personal cash flow across Operating, Investing, and Financing."""

    operating_inflow: int
    operating_outflow: int
    operating_net: int
    investing_outflow: int
    financing_inflow: int
    financing_outflow: int
    financing_net: int
    net_cash_flow: int
    saving_rate_pct: float
    operating_income_breakdown: list[CategoryTotal]
    operating_expense_breakdown: list[CategoryTotal]


def _sorted_category_totals(
    totals: dict[str, int],
    grand_total: int,
) -> list[CategoryTotal]:
    return [
        CategoryTotal(
            name=name,
            amount=amount,
            percentage=round((amount / grand_total * 100), 1) if grand_total > 0 else 0.0,
        )
        for name, amount in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    ]


def aggregate_cash_flow(
    transactions: list[Transaction],
    *,
    category_names: dict[int, str] | None = None,
) -> CashFlowSummary:
    """Group transactions into Operating, Investing, and Debt/Financing cash flows."""

    names = category_names or {}
    operating_inflow = 0
    operating_outflow = 0
    investing_outflow = 0
    financing_inflow = 0
    financing_outflow = 0

    op_income_by_cat: dict[str, int] = defaultdict(int)
    op_expense_by_cat: dict[str, int] = defaultdict(int)

    for tx in transactions:
        cat_name = tx.category_name or names.get(tx.category_id or 0, "Lainnya")
        if tx.type == "investment":
            investing_outflow += tx.amount
            continue

        if is_derived_transaction(tx):
            if tx.type == "income":
                financing_inflow += tx.amount
            elif tx.type == "expense":
                financing_outflow += tx.amount
            continue

        if tx.type == "income":
            operating_inflow += tx.amount
            op_income_by_cat[cat_name] += tx.amount
        elif tx.type == "expense":
            operating_outflow += tx.amount
            op_expense_by_cat[cat_name] += tx.amount

    operating_net = operating_inflow - operating_outflow
    financing_net = financing_inflow - financing_outflow
    net_cash_flow = operating_net - investing_outflow + financing_net
    saving_rate_pct = (
        round((operating_net / operating_inflow) * 100, 1)
        if operating_inflow > 0
        else 0.0
    )

    return CashFlowSummary(
        operating_inflow=operating_inflow,
        operating_outflow=operating_outflow,
        operating_net=operating_net,
        investing_outflow=investing_outflow,
        financing_inflow=financing_inflow,
        financing_outflow=financing_outflow,
        financing_net=financing_net,
        net_cash_flow=net_cash_flow,
        saving_rate_pct=saving_rate_pct,
        operating_income_breakdown=_sorted_category_totals(op_income_by_cat, operating_inflow),
        operating_expense_breakdown=_sorted_category_totals(op_expense_by_cat, operating_outflow),
    )
