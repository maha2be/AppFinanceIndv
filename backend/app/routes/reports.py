"""Financial reporting routes."""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from finance_core.db.transactions import list_transactions_in_range
from finance_core.db.users import AppUser
from finance_core.reports.aggregator import (
    aggregate_by_category,
    aggregate_daily_series,
    aggregate_investments,
    aggregate_transactions,
)
from finance_core.reports.date_ranges import (
    DateRange,
    month_range,
    today_range,
    week_range,
)
from finance_core.timezones import today_in

from ..auth.dependencies import get_current_user, get_db
from ..models.schemas import (
    CategoryBreakdownResponse,
    CategoryTotalItem,
    DailyFlowPointItem,
    InvestmentReportResponse,
    PeriodReportResponse,
)

router = APIRouter(prefix="/api/reports", tags=["Reports"])

_MONTH_NAMES_ID = (
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
)


def _build_period_report(
    db: sqlite3.Connection,
    user: AppUser,
    date_range: DateRange,
    title: str,
    *,
    timeline_range: DateRange | None = None,
) -> PeriodReportResponse:
    """Aggregate one date range into a period report."""

    start = date_range.start_date.isoformat()
    end = date_range.end_date.isoformat()
    transactions = list_transactions_in_range(
        db,
        user_id=user.id,
        start_date=start,
        end_date=end,
    )
    summary = aggregate_transactions(transactions)

    series_range = timeline_range or date_range
    series_transactions = (
        transactions
        if series_range == date_range
        else list_transactions_in_range(
            db,
            user_id=user.id,
            start_date=series_range.start_date.isoformat(),
            end_date=series_range.end_date.isoformat(),
        )
    )
    timeline = aggregate_daily_series(
        series_transactions,
        start_date=series_range.start_date,
        end_date=series_range.end_date,
    )

    return PeriodReportResponse(
        title=title,
        start_date=start,
        end_date=end,
        total_income=summary.total_income,
        total_expense=summary.total_expense,
        total_investment=summary.total_investment,
        net=summary.net,
        average_expense=summary.average_expense,
        investment_percentage=summary.investment_percentage,
        top_expense_categories=[
            CategoryTotalItem(name=item.name, amount=item.amount, percentage=item.percentage)
            for item in summary.top_expense_categories
        ],
        timeline=[
            DailyFlowPointItem(
                date=point.date,
                income=point.income,
                expense=point.expense,
                investment=point.investment,
                net=point.net,
                cumulative_net=point.cumulative_net,
            )
            for point in timeline
        ],
    )


def _default_range(user: AppUser) -> tuple[date, DateRange]:
    """Return the user's local today and the matching month range."""

    current = today_in(user.timezone)
    return current, month_range(current)


@router.get("/daily", response_model=PeriodReportResponse)
def get_daily_report(
    target_date: Optional[date] = Query(None, description="Defaults to the user's local today"),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> PeriodReportResponse:
    """Generate a daily financial summary with a 7-day stability curve."""

    reference = target_date or today_in(current_user.timezone)
    date_range = today_range(reference)
    curve_range = DateRange(start_date=reference - timedelta(days=6), end_date=reference)
    title = f"Laporan Harian ({reference.day} {_MONTH_NAMES_ID[reference.month - 1]} {reference.year})"
    return _build_period_report(db, current_user, date_range, title, timeline_range=curve_range)


@router.get("/weekly", response_model=PeriodReportResponse)
def get_weekly_report(
    target_date: Optional[date] = Query(None, description="Any date within the week"),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> PeriodReportResponse:
    """Generate a weekly financial summary."""

    reference = target_date or today_in(current_user.timezone)
    date_range = week_range(reference)
    start, end = date_range.start_date, date_range.end_date
    title = (
        f"Laporan Mingguan ({start.day} {_MONTH_NAMES_ID[start.month - 1]} - "
        f"{end.day} {_MONTH_NAMES_ID[end.month - 1]} {end.year})"
    )
    return _build_period_report(db, current_user, date_range, title)


@router.get("/monthly", response_model=PeriodReportResponse)
def get_monthly_report(
    year: Optional[int] = Query(None, ge=1970, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> PeriodReportResponse:
    """Generate a monthly financial summary."""

    reference = today_in(current_user.timezone)
    target_year = year or reference.year
    target_month = month or reference.month
    date_range = month_range(date(target_year, target_month, 1))
    title = f"Laporan Bulanan ({_MONTH_NAMES_ID[target_month - 1]} {target_year})"
    return _build_period_report(db, current_user, date_range, title)


@router.get("/category-breakdown", response_model=CategoryBreakdownResponse)
def get_category_breakdown(
    type: str = Query("expense", pattern="^(income|expense|investment)$"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> CategoryBreakdownResponse:
    """Get category breakdown with amounts and percentages for pie charts."""

    _, default_month = _default_range(current_user)
    start = (start_date or default_month.start_date).isoformat()
    end = (end_date or default_month.end_date).isoformat()

    transactions = list_transactions_in_range(
        db,
        user_id=current_user.id,
        start_date=start,
        end_date=end,
    )
    items, total = aggregate_by_category(
        transactions,
        category_type=type,
    )

    return CategoryBreakdownResponse(
        title=f"Breakdown Kategori {type.capitalize()}",
        type=type,
        categories=[
            CategoryTotalItem(name=item.name, amount=item.amount, percentage=item.percentage)
            for item in items
        ],
        total_amount=total,
    )


@router.get("/investment", response_model=InvestmentReportResponse)
def get_investment_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> InvestmentReportResponse:
    """Get investment allocations by asset and type."""

    _, default_month = _default_range(current_user)
    start = (start_date or default_month.start_date).isoformat()
    end = (end_date or default_month.end_date).isoformat()

    transactions = list_transactions_in_range(
        db,
        user_id=current_user.id,
        start_date=start,
        end_date=end,
    )
    by_type, by_asset, total_investment = aggregate_investments(transactions)
    total_income = sum(item.amount for item in transactions if item.type == "income")
    investment_percentage = (
        round(total_investment / total_income * 100, 2) if total_income > 0 else 0.0
    )

    return InvestmentReportResponse(
        title="Laporan Alokasi Investasi",
        total_investment=total_investment,
        investment_percentage=investment_percentage,
        by_type=[
            CategoryTotalItem(name=item.name, amount=item.amount, percentage=item.percentage)
            for item in by_type
        ],
        by_asset=[
            CategoryTotalItem(name=item.name, amount=item.amount, percentage=item.percentage)
            for item in by_asset
        ],
    )