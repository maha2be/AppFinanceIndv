"""Personal monthly budget routes."""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from finance_core.db.budgets import delete_budget, get_budget_overview, upsert_budget
from finance_core.db.connection import transaction
from finance_core.db.users import AppUser
from finance_core.timezones import today_in

from ..auth.dependencies import get_current_user, get_db
from ..models.schemas import (
    BudgetOverviewResponse,
    BudgetProgressResponse,
    BudgetResponse,
    BudgetUpsertRequest,
)

router = APIRouter(prefix="/api/budgets", tags=["Budgets"])


@router.get("", response_model=BudgetOverviewResponse)
def read_budget_overview(
    year: Optional[int] = Query(None, ge=1970, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> BudgetOverviewResponse:
    """Return configured budgets and spending progress for the requested month."""

    reference = today_in(current_user.timezone)
    target_year = year or reference.year
    target_month = month or reference.month
    overview = get_budget_overview(
        db,
        user_id=current_user.id,
        year=target_year,
        month=target_month,
    )
    return BudgetOverviewResponse(
        year=overview.year,
        month=overview.month,
        start_date=overview.start_date,
        end_date=overview.end_date,
        total_expense=overview.total_expense,
        overall_budget=(
            BudgetProgressResponse.model_validate(overview.overall_budget)
            if overview.overall_budget is not None
            else None
        ),
        category_budgets=[
            BudgetProgressResponse.model_validate(item)
            for item in overview.category_budgets
        ],
        allocated_category_total=overview.allocated_category_total,
        warning_count=overview.warning_count,
        exceeded_count=overview.exceeded_count,
    )


@router.put("", response_model=BudgetResponse)
def save_budget(
    payload: BudgetUpsertRequest,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> BudgetResponse:
    """Create or update an overall monthly budget or an expense category budget."""

    try:
        with transaction(db):
            budget = upsert_budget(
                db,
                user_id=current_user.id,
                category_id=payload.category_id,
                amount=payload.amount,
                alert_threshold=payload.alert_threshold,
            )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    return BudgetResponse.model_validate(budget)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_budget(
    budget_id: int,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> None:
    """Delete one configured budget."""

    with transaction(db):
        deleted = delete_budget(db, user_id=current_user.id, budget_id=budget_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Anggaran tidak ditemukan.",
        )
