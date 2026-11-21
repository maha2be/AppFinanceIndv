/**
 * TypeScript definitions for the Finance Mobile App.
 */

export type TransactionType = 'income' | 'expense' | 'investment';
export type TransactionSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export interface User {
  id: number;
  email?: string | null;
  first_name?: string | null;
  avatar_url?: string | null;
  timezone: string;
  currency: string;
  created_at?: string;
  telegram_linked?: boolean;
  google_linked?: boolean;
  has_password?: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface ForgotPasswordResponse {
  message: string;
  request_id: string;
  expires_in: number;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface Category {
  id: number;
  user_id: number;
  type: TransactionType;
  name: string;
  aliases: string;
  is_default: number;
}

export interface Transaction {
  id: number;
  user_id: number;
  type: TransactionType;
  category_id?: number | null;
  category_name?: string | null;
  amount: number;
  note?: string | null;
  asset_name?: string | null;
  transaction_date: string; // YYYY-MM-DD
  can_edit?: boolean;
  can_delete?: boolean;
}

export interface TransactionBrowserFilters {
  q?: string;
  start_date?: string;
  end_date?: string;
  type?: TransactionType;
  category_id?: number;
  min_amount?: number;
  max_amount?: number;
}

export interface TransactionPageQuery extends TransactionBrowserFilters {
  sort?: TransactionSort;
  page?: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type TransactionAuditAction = 'update' | 'delete';
export type TransactionAuditSource = 'api' | 'telegram' | 'system';
export type TransactionAuditReason =
  | 'direct'
  | 'debt_sync'
  | 'debt_delete'
  | 'payment_delete';

export interface TransactionSnapshot {
  id: number;
  type: TransactionType;
  category_id?: number | null;
  category_name?: string | null;
  amount: number;
  note?: string | null;
  asset_name?: string | null;
  transaction_date: string;
  source_key?: string | null;
}

export interface TransactionHistoryEntry {
  id: number;
  transaction_id: number;
  action: TransactionAuditAction;
  source: TransactionAuditSource;
  reason: TransactionAuditReason;
  before: TransactionSnapshot;
  after: TransactionSnapshot | null;
  created_at: string; // ISO UTC
}

export interface TransactionUpdatePayload {
  amount?: number;
  category_id?: number | null;
  note?: string | null;
  asset_name?: string | null;
  transaction_date?: string;
}

export interface QuickInputPreview {
  type?: TransactionType | null;
  type_label?: string | null;
  category_name?: string | null;
  amount?: number | null;
  note?: string | null;
  asset_name?: string | null;
  transaction_date?: string | null;
  is_valid: boolean;
  error?: string | null;
}

export interface CategoryTotalItem {
  name: string;
  amount: number;
  percentage: number;
}

export interface DailyFlowPoint {
  date: string;
  income: number;
  expense: number;
  investment: number;
  net: number;
  cumulative_net: number;
}

export interface PeriodReport {
  title: string;
  start_date: string;
  end_date: string;
  total_income: number;
  total_expense: number;
  total_investment: number;
  net: number;
  average_expense: number;
  investment_percentage: number;
  top_expense_categories: CategoryTotalItem[];
  timeline?: DailyFlowPoint[];
}

export interface CategoryBreakdown {
  title: string;
  type: string;
  categories: CategoryTotalItem[];
  total_amount: number;
}

export interface InvestmentReport {
  title: string;
  total_investment: number;
  investment_percentage: number;
  by_type: CategoryTotalItem[];
  by_asset: CategoryTotalItem[];
}

export interface CashFlowSummary {
  operating_inflow: number;
  operating_outflow: number;
  operating_net: number;
  investing_outflow: number;
  financing_inflow: number;
  financing_outflow: number;
  financing_net: number;
  net_cash_flow: number;
  saving_rate_pct: number;
  operating_income_breakdown: CategoryTotalItem[];
  operating_expense_breakdown: CategoryTotalItem[];
}

export interface CashFlowSnapshot {
  operating_inflow: number;
  operating_outflow: number;
  operating_net: number;
  investing_outflow: number;
  financing_net: number;
  net_cash_flow: number;
}

export interface CashFlowComparison {
  net_delta: number;
  operating_net_delta: number;
  operating_inflow_delta_pct?: number | null;
  operating_outflow_delta_pct?: number | null;
}

export interface CashFlowReport {
  title: string;
  period: 'daily' | 'weekly' | 'monthly';
  start_date: string;
  end_date: string;
  previous_title: string;
  previous_start_date: string;
  previous_end_date: string;
  current: CashFlowSummary;
  previous: CashFlowSnapshot;
  comparison: CashFlowComparison;
}

// --- Debt / Receivable Types ---

export type DebtType = 'debt' | 'receivable';
export type DebtStatus = 'active' | 'settled';

export interface Debt {
  id: number;
  user_id: number;
  type: DebtType;
  person_name: string;
  total_amount: number;
  paid_amount: number;
  note?: string | null;
  due_date?: string | null; // YYYY-MM-DD
  status: DebtStatus;
  cash_synced?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DebtPayment {
  id: number;
  debt_id: number;
  amount: number;
  note?: string | null;
  payment_date: string;
  created_at?: string | null;
}

export interface DebtSummary {
  total_debt_remaining: number;
  total_receivable_remaining: number;
  active_debt_count: number;
  active_receivable_count: number;
  due_soon_count: number;
}

// --- Recurring Transaction Types ---

export type RecurringFrequency = 'weekly' | 'monthly';

export interface RecurringTransaction {
  id: number;
  user_id: number;
  type: TransactionType;
  category_id?: number | null;
  category_name?: string | null;
  amount: number;
  note?: string | null;
  asset_name?: string | null;
  frequency: RecurringFrequency;
  day_of_week?: number | null; // 0 = Monday, 6 = Sunday
  day_of_month?: number | null;
  start_date: string; // YYYY-MM-DD
  next_run_date: string; // YYYY-MM-DD
  last_run_date?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RecurringPayload {
  type: TransactionType;
  category_id?: number | null;
  category_name?: string;
  amount: number;
  note?: string;
  asset_name?: string;
  frequency: RecurringFrequency;
  day_of_week?: number | null;
  day_of_month?: number | null;
  start_date: string;
  is_active?: boolean;
}

// --- Shopping List Types ---

export interface ShoppingListItem {
  id: number;
  list_id: number;
  user_id: number;
  group_name: string;
  name: string;
  price?: number | null;
  is_checked: boolean;
  transaction_id?: number | null;
  position: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ShoppingListSummary {
  id: number;
  user_id: number;
  title: string;
  budget_amount?: number | null;
  notes?: string | null;
  item_count: number;
  checked_count: number;
  planned_total: number;
  checked_total: number;
  unrecorded_checked_total: number;
  recorded_total: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ShoppingListDetail extends ShoppingListSummary {
  items: ShoppingListItem[];
}

export interface ShoppingListRecordExpenseResult {
  transaction: Transaction;
  shopping_list: ShoppingListDetail;
}

// --- Budget Types ---

export type BudgetStatus = 'safe' | 'warning' | 'exceeded';

export interface Budget {
  id: number;
  user_id: number;
  category_id?: number | null;
  category_name?: string | null;
  amount: number;
  alert_threshold: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BudgetProgress {
  id: number;
  user_id: number;
  category_id?: number | null;
  category_name?: string | null;
  amount: number;
  spent: number;
  remaining: number;
  percentage: number;
  alert_threshold: number;
  status: BudgetStatus;
}

export interface BudgetOverview {
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  total_expense: number;
  overall_budget?: BudgetProgress | null;
  category_budgets: BudgetProgress[];
  allocated_category_total: number;
  warning_count: number;
  exceeded_count: number;
}

