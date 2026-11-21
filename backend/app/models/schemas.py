"""Pydantic schemas for request validation and response serialization."""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

TransactionTypeValue = Literal["income", "expense", "investment"]
TransactionSortValue = Literal["date_desc", "date_asc", "amount_desc", "amount_asc"]
DebtTypeValue = Literal["debt", "receivable"]
DebtStatusValue = Literal["active", "settled"]


# --- Auth Schemas ---


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    first_name: Optional[str] = Field(None, max_length=80)
    timezone: str = "Asia/Jakarta"
    currency: str = Field("IDR", min_length=3, max_length=3)

    @field_validator("password")
    @classmethod
    def _password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Kata sandi maksimal 72 byte.")
        return value


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class NewPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _new_password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes.")
        return value


class ChangePasswordRequest(NewPasswordRequest):
    current_password: str = Field(..., min_length=1, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(NewPasswordRequest):
    request_id: str = Field(..., min_length=1, max_length=128)
    code: str = Field(..., pattern=r"^[0-9]{6}$")


class ForgotPasswordResponse(BaseModel):
    message: str
    request_id: str
    expires_in: int = 600


class MessageResponse(BaseModel):
    message: str


class DeleteAccountRequest(BaseModel):
    confirmation: Literal["DELETE"]
    password: Optional[str] = Field(None, min_length=1, max_length=128)
    id_token: Optional[str] = Field(None, min_length=1, max_length=16384)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(..., min_length=1, max_length=16384)


class GoogleLinkRequest(GoogleAuthRequest):
    password: str = Field(..., min_length=1, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: Optional[str] = None
    first_name: Optional[str] = None
    avatar_url: Optional[str] = None
    timezone: str = "Asia/Jakarta"
    currency: str = "IDR"
    created_at: Optional[str] = None
    telegram_linked: bool = False
    google_linked: bool = False
    has_password: bool = False


class UpdateProfileRequest(BaseModel):
    first_name: Optional[str] = Field(None, max_length=120)
    avatar_url: Optional[str] = Field(None, max_length=410_000)

    @field_validator("first_name")
    @classmethod
    def _validate_first_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        from finance_core.db.users import validate_first_name

        return validate_first_name(value)

    @field_validator("avatar_url")
    @classmethod
    def _validate_avatar_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        from finance_core.db.users import validate_avatar_data_uri

        return validate_avatar_data_uri(value)

    @model_validator(mode="after")
    def _require_any_change(self) -> "UpdateProfileRequest":
        if "first_name" not in self.model_fields_set and "avatar_url" not in self.model_fields_set:
            raise ValueError("Minimal satu kolom profil harus diisi.")
        if "first_name" in self.model_fields_set and self.first_name is None:
            raise ValueError("Nama tidak boleh kosong.")
        return self


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


# --- Category Schemas ---


class CategoryCreate(BaseModel):
    type: TransactionTypeValue
    name: str = Field(..., min_length=1, max_length=80)
    aliases: str = ""


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    name: str
    aliases: str = ""
    is_default: int = 0


# --- Transaction Schemas ---


class TransactionCreate(BaseModel):
    type: TransactionTypeValue
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: int = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=500)
    asset_name: Optional[str] = Field(None, max_length=80)
    transaction_date: date


class TransactionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Optional[int] = Field(None, gt=0)
    category_id: Optional[int] = None
    transaction_date: Optional[date] = None
    note: Optional[str] = Field(None, max_length=500)
    asset_name: Optional[str] = Field(None, max_length=80)

    @field_validator("amount", "transaction_date")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("Field cannot be null; omit it to keep the current value.")
        return value


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: int
    note: Optional[str] = None
    asset_name: Optional[str] = None
    transaction_date: str
    can_edit: bool
    can_delete: bool


class TransactionPageResponse(BaseModel):
    """One page of the transaction browser.

    ``page`` is the effective page after clamping, so a client that asked for a
    page that no longer exists still receives real rows and its real number.
    """

    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class TransactionSnapshot(BaseModel):
    id: int
    type: str
    category_id: Optional[int]
    category_name: Optional[str]
    amount: int
    note: Optional[str]
    asset_name: Optional[str]
    transaction_date: str
    source_key: Optional[str]


class TransactionHistoryResponse(BaseModel):
    id: int
    transaction_id: int
    action: Literal["update", "delete"]
    source: Literal["api", "telegram", "system"]
    reason: Literal["direct", "debt_sync", "debt_delete", "payment_delete"]
    before: TransactionSnapshot
    after: Optional[TransactionSnapshot]
    created_at: str


class QuickInputRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    reference_date: Optional[date] = None


class QuickInputPreviewResponse(BaseModel):
    type: Optional[str] = None
    type_label: Optional[str] = None
    category_name: Optional[str] = None
    amount: Optional[int] = None
    note: Optional[str] = None
    asset_name: Optional[str] = None
    transaction_date: Optional[str] = None
    is_valid: bool
    error: Optional[str] = None


# --- Report Schemas ---


class CategoryTotalItem(BaseModel):
    name: str
    amount: int
    percentage: float = 0.0


class DailyFlowPointItem(BaseModel):
    date: str
    income: int
    expense: int
    investment: int
    net: int
    cumulative_net: int


class PeriodReportResponse(BaseModel):
    title: str
    start_date: str
    end_date: str
    total_income: int
    total_expense: int
    total_investment: int
    net: int
    average_expense: int
    investment_percentage: float
    top_expense_categories: list[CategoryTotalItem]
    timeline: list[DailyFlowPointItem] = []


class CategoryBreakdownResponse(BaseModel):
    title: str
    type: str
    categories: list[CategoryTotalItem]
    total_amount: int


class InvestmentReportResponse(BaseModel):
    title: str
    total_investment: int
    investment_percentage: float
    by_type: list[CategoryTotalItem]
    by_asset: list[CategoryTotalItem]


class CashFlowSummaryItem(BaseModel):
    operating_inflow: int
    operating_outflow: int
    operating_net: int
    investing_outflow: int
    financing_inflow: int
    financing_outflow: int
    financing_net: int
    net_cash_flow: int
    saving_rate_pct: float
    operating_income_breakdown: list[CategoryTotalItem] = []
    operating_expense_breakdown: list[CategoryTotalItem] = []


class CashFlowSnapshotItem(BaseModel):
    operating_inflow: int
    operating_outflow: int
    operating_net: int
    investing_outflow: int
    financing_net: int
    net_cash_flow: int


class CashFlowComparisonItem(BaseModel):
    net_delta: int
    operating_net_delta: int
    operating_inflow_delta_pct: Optional[float] = None
    operating_outflow_delta_pct: Optional[float] = None


class CashFlowReportResponse(BaseModel):
    title: str
    period: Literal["daily", "weekly", "monthly"]
    start_date: str
    end_date: str
    previous_title: str
    previous_start_date: str
    previous_end_date: str
    current: CashFlowSummaryItem
    previous: CashFlowSnapshotItem
    comparison: CashFlowComparisonItem


# --- Recurring Transaction Schemas ---


class RecurringCreate(BaseModel):
    type: TransactionTypeValue
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: int = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=500)
    asset_name: Optional[str] = Field(None, max_length=80)
    frequency: Literal["weekly", "monthly"]
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    start_date: date
    is_active: bool = True

    @model_validator(mode="after")
    def _validate_schedule(self) -> "RecurringCreate":
        from finance_core.recurring import validate_schedule

        validate_schedule(self.frequency, self.day_of_week, self.day_of_month)
        return self


class RecurringUpdate(BaseModel):
    type: Optional[TransactionTypeValue] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: Optional[int] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=500)
    asset_name: Optional[str] = Field(None, max_length=80)
    frequency: Optional[Literal["weekly", "monthly"]] = None
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    start_date: Optional[date] = None
    is_active: Optional[bool] = None


class RecurringResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: int
    note: Optional[str] = None
    asset_name: Optional[str] = None
    frequency: str
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    start_date: str
    next_run_date: str
    last_run_date: Optional[str] = None
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

# --- Debt Schemas ---


class DebtCreate(BaseModel):
    type: DebtTypeValue
    person_name: str = Field(..., min_length=1, max_length=120)
    total_amount: int = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=500)
    due_date: Optional[date] = None
    # Post the cash movement (borrow = income, lend = expense) immediately.
    sync_cash: bool = False


class DebtUpdate(BaseModel):
    person_name: Optional[str] = Field(None, min_length=1, max_length=120)
    total_amount: Optional[int] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=500)
    due_date: Optional[date] = None
    status: Optional[DebtStatusValue] = None


class DebtResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    person_name: str
    total_amount: int
    paid_amount: int
    note: Optional[str] = None
    due_date: Optional[str] = None
    status: str
    cash_synced: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class DebtPaymentCreate(BaseModel):
    amount: int = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=500)
    payment_date: date


class DebtPaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    debt_id: int
    amount: int
    note: Optional[str] = None
    payment_date: str
    created_at: Optional[str] = None


class DebtSummaryResponse(BaseModel):
    total_debt_remaining: int
    total_receivable_remaining: int
    active_debt_count: int
    active_receivable_count: int
    due_soon_count: int


# --- Shopping List Schemas ---


class ShoppingListItemCreate(BaseModel):
    group_name: Optional[str] = Field("Umum", max_length=60)
    name: str = Field(..., min_length=1, max_length=120)
    price: Optional[int] = Field(None, ge=0)
    is_checked: bool = False


class ShoppingListItemUpdate(BaseModel):
    group_name: Optional[str] = Field(None, max_length=60)
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    price: Optional[int] = Field(None, ge=0)
    is_checked: Optional[bool] = None

    @model_validator(mode="after")
    def _require_any_field(self) -> "ShoppingListItemUpdate":
        if not (self.model_fields_set & {"group_name", "name", "price", "is_checked"}):
            raise ValueError("Minimal satu kolom item harus diisi.")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Nama item tidak boleh kosong.")
        if "is_checked" in self.model_fields_set and self.is_checked is None:
            raise ValueError("Status centang tidak valid.")
        return self


class ShoppingListCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    budget_amount: Optional[int] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=1000)
    items: list[ShoppingListItemCreate] = Field(default_factory=list, max_length=200)


class ShoppingListUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    budget_amount: Optional[int] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=1000)

    @model_validator(mode="after")
    def _require_any_field(self) -> "ShoppingListUpdate":
        if not (self.model_fields_set & {"title", "budget_amount", "notes"}):
            raise ValueError("Minimal satu kolom daftar harus diisi.")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("Judul daftar belanja tidak boleh kosong.")
        return self


class ShoppingListDuplicateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)


class ShoppingListRecordExpenseRequest(BaseModel):
    transaction_date: Optional[date] = None


class ShoppingListItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    user_id: int
    group_name: str
    name: str
    price: Optional[int] = None
    is_checked: bool
    transaction_id: Optional[int] = None
    position: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ShoppingListSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    budget_amount: Optional[int] = None
    notes: Optional[str] = None
    item_count: int
    checked_count: int
    planned_total: int
    checked_total: int
    unrecorded_checked_total: int
    recorded_total: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ShoppingListDetailResponse(ShoppingListSummaryResponse):
    items: list[ShoppingListItemResponse] = Field(default_factory=list)


class ShoppingListRecordExpenseResponse(BaseModel):
    transaction: TransactionResponse
    shopping_list: ShoppingListDetailResponse


# --- Budget Schemas ---


class BudgetUpsertRequest(BaseModel):
    category_id: Optional[int] = Field(None, gt=0)
    amount: int = Field(..., gt=0)
    alert_threshold: int = Field(80, ge=1, le=100)


class BudgetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: int
    alert_threshold: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BudgetProgressResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    amount: int
    spent: int
    remaining: int
    percentage: float
    alert_threshold: int
    status: Literal["safe", "warning", "exceeded"]


class BudgetOverviewResponse(BaseModel):
    year: int
    month: int
    start_date: str
    end_date: str
    total_expense: int
    overall_budget: Optional[BudgetProgressResponse] = None
    category_budgets: list[BudgetProgressResponse] = Field(default_factory=list)
    allocated_category_total: int
    warning_count: int
    exceeded_count: int
