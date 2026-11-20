/**
 * Pure rules for the transaction browser.
 *
 * The screen, the pagination strip, and the page-jump sheet all read these
 * helpers so an invalid jump or filter can never reach the API, and the numbered
 * controls stay identical wherever they render.
 */

import { TransactionBrowserFilters, TransactionPageQuery, TransactionSort, TransactionType } from '../types';
import { isValidIsoDate, parseTransactionAmount } from './transactions';

export const MAX_SEARCH_LENGTH = 200;

/** A page number, or one of the two ellipsis tokens the strip renders. */
export type PageToken = number | 'ellipsis-left' | 'ellipsis-right';

/** Editable state of the filter sheet. Amounts stay text until applied. */
export interface TransactionFilterDraft {
  q: string;
  startDate: string;
  endDate: string;
  type: TransactionType | '';
  categoryId: number | null;
  minAmount: string;
  maxAmount: string;
}

export const EMPTY_FILTER_DRAFT: TransactionFilterDraft = {
  q: '',
  startDate: '',
  endDate: '',
  type: '',
  categoryId: null,
  minAmount: '',
  maxAmount: '',
};

/**
 * Numbered tokens for a page strip.
 *
 * Up to seven pages every number fits. Beyond that show the first page, the last
 * page, and the current page with its neighbours, plus one extra neighbour near a
 * boundary so the strip never collapses to a single lonely number.
 */
export function buildPageTokens(currentPage: number, totalPages: number): PageToken[] {
  if (!Number.isFinite(totalPages) || totalPages < 1) {
    return [];
  }
  const last = Math.floor(totalPages);
  const current = Math.min(Math.max(1, Math.floor(currentPage) || 1), last);
  if (last <= 7) {
    return Array.from({ length: last }, (_, index) => index + 1);
  }

  const selected = new Set<number>([1, last, current - 1, current, current + 1]);
  if (current <= 2) selected.add(3);
  if (current >= last - 1) selected.add(last - 2);

  const pages = [...selected].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b);
  const tokens: PageToken[] = [];
  pages.forEach((page, index) => {
    if (index > 0) {
      const gap = page - pages[index - 1] - 1;
      if (gap === 1) {
        tokens.push(page - 1);
      } else if (gap > 1) {
        tokens.push(page - 1 < current ? 'ellipsis-left' : 'ellipsis-right');
      }
    }
    tokens.push(page);
  });
  return tokens;
}

/** Trimmed ASCII digits inside `1..totalPages`, otherwise null. */
export function parsePageJump(text: string, totalPages: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > Math.floor(totalPages)) {
    return null;
  }
  return value;
}

/** True when anything narrows the browser away from its default scope. */
export function hasActiveFilters(filters: TransactionBrowserFilters): boolean {
  return Boolean(
    filters.q?.trim() ||
      filters.start_date ||
      filters.end_date ||
      filters.type ||
      filters.category_id ||
      filters.min_amount !== undefined ||
      filters.max_amount !== undefined
  );
}

function parseAmountField(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const amount = parseTransactionAmount(trimmed);
  return Number.isSafeInteger(amount) && amount >= 1 ? amount : 'invalid';
}

/**
 * Field-keyed messages for the filter sheet, empty when the draft is usable.
 * Dates are inclusive; amounts are whole positive rupiah.
 */
export function validateFilterDraft(draft: TransactionFilterDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  if (draft.q.trim().length > MAX_SEARCH_LENGTH) {
    errors.q = `Pencarian maksimal ${MAX_SEARCH_LENGTH} karakter.`;
  }
  for (const field of ['startDate', 'endDate'] as const) {
    const value = draft[field].trim();
    if (value && !isValidIsoDate(value)) {
      errors[field] = 'Gunakan format tanggal YYYY-MM-DD.';
    }
  }
  const start = draft.startDate.trim();
  const end = draft.endDate.trim();
  if (!errors.startDate && !errors.endDate && start && end && start > end) {
    errors.endDate = 'Tanggal akhir tidak boleh sebelum tanggal awal.';
  }

  const minAmount = parseAmountField(draft.minAmount);
  const maxAmount = parseAmountField(draft.maxAmount);
  if (minAmount === 'invalid') errors.minAmount = 'Nominal minimum harus angka utuh di atas 0.';
  if (maxAmount === 'invalid') errors.maxAmount = 'Nominal maksimum harus angka utuh di atas 0.';
  if (typeof minAmount === 'number' && typeof maxAmount === 'number' && minAmount > maxAmount) {
    errors.maxAmount = 'Nominal maksimum tidak boleh kurang dari minimum.';
  }
  if (draft.categoryId !== null && (!Number.isSafeInteger(draft.categoryId) || draft.categoryId < 1)) {
    errors.categoryId = 'Kategori tidak valid.';
  }
  if (draft.type && !['income', 'expense', 'investment'].includes(draft.type)) {
    errors.type = 'Jenis transaksi tidak valid.';
  }

  return errors;
}

/**
 * Convert a validated draft into the applied filters. Empty fields are dropped so
 * the request only carries real constraints.
 */
export function draftToFilters(draft: TransactionFilterDraft): TransactionBrowserFilters {
  const filters: TransactionBrowserFilters = {};
  const q = draft.q.trim();
  if (q) filters.q = q;
  const start = draft.startDate.trim();
  if (start) filters.start_date = start;
  const end = draft.endDate.trim();
  if (end) filters.end_date = end;
  if (draft.type) filters.type = draft.type;
  if (draft.categoryId !== null) filters.category_id = draft.categoryId;
  const minAmount = parseAmountField(draft.minAmount);
  if (typeof minAmount === 'number') filters.min_amount = minAmount;
  const maxAmount = parseAmountField(draft.maxAmount);
  if (typeof maxAmount === 'number') filters.max_amount = maxAmount;
  return filters;
}

/** Applied filters back to editable draft state. */
export function filtersToDraft(filters: TransactionBrowserFilters): TransactionFilterDraft {
  return {
    q: filters.q ?? '',
    startDate: filters.start_date ?? '',
    endDate: filters.end_date ?? '',
    type: filters.type ?? '',
    categoryId: filters.category_id ?? null,
    minAmount: filters.min_amount === undefined ? '' : String(filters.min_amount),
    maxAmount: filters.max_amount === undefined ? '' : String(filters.max_amount),
  };
}

/** Request parameters with blanks removed, so Axios does not send `q=`. */
export function buildTransactionPageQuery(
  filters: TransactionBrowserFilters,
  sort: TransactionSort,
  page: number
): TransactionPageQuery {
  return { ...filters, sort, page };
}

/** Half-open description of the visible rows, for `Menampilkan 21-40 dari N`. */
export function describeResultRange(
  page: number,
  pageSize: number,
  total: number
): { from: number; to: number } {
  if (total <= 0) {
    return { from: 0, to: 0 };
  }
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = Math.min((safePage - 1) * pageSize + 1, total);
  const to = Math.min(safePage * pageSize, total);
  return { from, to };
}

export const SORT_OPTIONS: Array<{ key: TransactionSort; label: string }> = [
  { key: 'date_desc', label: 'Terbaru' },
  { key: 'date_asc', label: 'Terlama' },
  { key: 'amount_desc', label: 'Nominal terbesar' },
  { key: 'amount_asc', label: 'Nominal terkecil' },
];

export const TYPE_OPTIONS: Array<{ key: TransactionType | ''; label: string }> = [
  { key: '', label: 'Semua jenis' },
  { key: 'income', label: 'Pemasukan' },
  { key: 'expense', label: 'Pengeluaran' },
  { key: 'investment', label: 'Investasi' },
];
