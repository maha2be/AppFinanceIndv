"""Shopping list management routes."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, status

from finance_core.db.connection import transaction
from finance_core.db.shopping_lists import (
    _UNSET,
    add_shopping_list_item,
    create_shopping_list,
    delete_shopping_list,
    delete_shopping_list_item,
    duplicate_shopping_list,
    get_shopping_list_detail,
    list_shopping_lists,
    record_shopping_list_expense,
    update_shopping_list,
    update_shopping_list_item,
)
from finance_core.db.users import AppUser
from finance_core.timezones import today_in

from ..auth.dependencies import get_current_user, get_db
from ..models.schemas import (
    ShoppingListCreate,
    ShoppingListDetailResponse,
    ShoppingListDuplicateRequest,
    ShoppingListItemCreate,
    ShoppingListItemResponse,
    ShoppingListItemUpdate,
    ShoppingListRecordExpenseRequest,
    ShoppingListRecordExpenseResponse,
    ShoppingListSummaryResponse,
    ShoppingListUpdate,
    TransactionResponse,
)

router = APIRouter(prefix="/api/shopping-lists", tags=["Shopping Lists"])

NOT_FOUND_LIST = "Daftar belanja tidak ditemukan."
NOT_FOUND_ITEM = "Item daftar belanja tidak ditemukan."


def _detail_response(summary, items) -> ShoppingListDetailResponse:
    base = ShoppingListSummaryResponse.model_validate(summary).model_dump()
    return ShoppingListDetailResponse(
        **base,
        items=[ShoppingListItemResponse.model_validate(item) for item in items],
    )


@router.get("", response_model=list[ShoppingListSummaryResponse])
def get_shopping_lists(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> list[ShoppingListSummaryResponse]:
    """List the user's shopping lists ordered newest first."""

    rows = list_shopping_lists(db, user_id=current_user.id, limit=limit, offset=offset)
    return [ShoppingListSummaryResponse.model_validate(row) for row in rows]


@router.post("", response_model=ShoppingListDetailResponse, status_code=status.HTTP_201_CREATED)
def create_new_shopping_list(
    payload: ShoppingListCreate,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListDetailResponse:
    """Create a shopping list with optional initial items."""

    try:
        with transaction(db):
            summary, items = create_shopping_list(
                db,
                user_id=current_user.id,
                title=payload.title,
                budget_amount=payload.budget_amount,
                notes=payload.notes,
                items=[item.model_dump() for item in payload.items],
            )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    return _detail_response(summary, items)


@router.get("/{list_id}", response_model=ShoppingListDetailResponse)
def get_one_shopping_list(
    list_id: int,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListDetailResponse:
    """Fetch one shopping list with all of its items."""

    detail = get_shopping_list_detail(db, user_id=current_user.id, list_id=list_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_LIST)
    return _detail_response(*detail)


@router.put("/{list_id}", response_model=ShoppingListDetailResponse)
def update_one_shopping_list(
    list_id: int,
    payload: ShoppingListUpdate,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListDetailResponse:
    """Update title, budget, or notes of an owned shopping list."""

    fields = payload.model_fields_set
    try:
        with transaction(db):
            updated = update_shopping_list(
                db,
                user_id=current_user.id,
                list_id=list_id,
                title=payload.title if "title" in fields else _UNSET,
                budget_amount=payload.budget_amount if "budget_amount" in fields else _UNSET,
                notes=payload.notes if "notes" in fields else _UNSET,
            )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_LIST)
    return _detail_response(*updated)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_one_shopping_list(
    list_id: int,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> None:
    """Delete an owned shopping list without deleting past cash transactions."""

    with transaction(db):
        deleted = delete_shopping_list(db, user_id=current_user.id, list_id=list_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_LIST)


@router.post(
    "/{list_id}/duplicate",
    response_model=ShoppingListDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_one_shopping_list(
    list_id: int,
    payload: ShoppingListDuplicateRequest | None = None,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListDetailResponse:
    """Copy an existing shopping list with all items unchecked and unlinked."""

    try:
        with transaction(db):
            duplicated = duplicate_shopping_list(
                db,
                user_id=current_user.id,
                list_id=list_id,
                title=payload.title if payload is not None else None,
            )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    if duplicated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_LIST)
    return _detail_response(*duplicated)


@router.post(
    "/{list_id}/items",
    response_model=ShoppingListItemResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_item_to_shopping_list(
    list_id: int,
    payload: ShoppingListItemCreate,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListItemResponse:
    """Add an item to an owned shopping list."""

    try:
        with transaction(db):
            item = add_shopping_list_item(
                db,
                user_id=current_user.id,
                list_id=list_id,
                group_name=payload.group_name,
                name=payload.name,
                price=payload.price,
                is_checked=payload.is_checked,
            )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_LIST)
    return ShoppingListItemResponse.model_validate(item)


@router.patch("/{list_id}/items/{item_id}", response_model=ShoppingListItemResponse)
def update_item_in_shopping_list(
    list_id: int,
    item_id: int,
    payload: ShoppingListItemUpdate,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListItemResponse:
    """Toggle checked state or edit group/name/price of an owned item."""

    fields = payload.model_fields_set
    try:
        with transaction(db):
            updated = update_shopping_list_item(
                db,
                user_id=current_user.id,
                list_id=list_id,
                item_id=item_id,
                group_name=payload.group_name if "group_name" in fields else _UNSET,
                name=payload.name if "name" in fields else _UNSET,
                price=payload.price if "price" in fields else _UNSET,
                is_checked=payload.is_checked if "is_checked" in fields else _UNSET,
            )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_ITEM)
    return ShoppingListItemResponse.model_validate(updated)


@router.delete("/{list_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item_from_shopping_list(
    list_id: int,
    item_id: int,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> None:
    """Delete one item from an owned shopping list."""

    with transaction(db):
        deleted = delete_shopping_list_item(
            db, user_id=current_user.id, list_id=list_id, item_id=item_id
        )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_ITEM)


@router.post("/{list_id}/record-expense", response_model=ShoppingListRecordExpenseResponse)
def record_checked_items_as_expense(
    list_id: int,
    payload: ShoppingListRecordExpenseRequest | None = None,
    current_user: AppUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ShoppingListRecordExpenseResponse:
    """Atomically record checked, unlinked shopping items as one Belanja expense."""

    tx_date = (
        payload.transaction_date.isoformat()
        if payload is not None and payload.transaction_date is not None
        else today_in(current_user.timezone).isoformat()
    )
    try:
        with transaction(db):
            recorded = record_shopping_list_expense(
                db,
                user_id=current_user.id,
                list_id=list_id,
                transaction_date=tx_date,
            )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    if recorded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_LIST)

    tx, summary, items = recorded
    return ShoppingListRecordExpenseResponse(
        transaction=TransactionResponse.model_validate(tx),
        shopping_list=_detail_response(summary, items),
    )
