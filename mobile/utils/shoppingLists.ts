/** Pure helpers for grouping, budget progress, and default titles in shopping lists. */
import { ShoppingListItem } from '../types';

export interface ShoppingItemGroup {
  groupName: string;
  items: ShoppingListItem[];
  subtotal: number;
  checkedCount: number;
}

export interface ShoppingBudgetProgress {
  hasBudget: boolean;
  percent: number;
  overBudget: boolean;
  difference: number;
}

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
] as const;

export const DEFAULT_SHOPPING_GROUPS = [
  'Kebutuhan Dapur',
  'Kebutuhan Rumah',
  'Kebutuhan Pribadi',
] as const;

export function defaultMonthlyListTitle(now = new Date()): string {
  const month = MONTHS_ID[now.getMonth()] ?? '';
  return `List Belanja ${month} ${now.getFullYear()}`.trim();
}

export function groupShoppingItems(items: readonly ShoppingListItem[]): ShoppingItemGroup[] {
  const groups = new Map<string, ShoppingItemGroup>();

  for (const item of items) {
    const groupName = item.group_name?.trim() || 'Umum';
    let entry = groups.get(groupName);
    if (!entry) {
      entry = { groupName, items: [], subtotal: 0, checkedCount: 0 };
      groups.set(groupName, entry);
    }
    entry.items.push(item);
    entry.subtotal += item.price ?? 0;
    if (item.is_checked) {
      entry.checkedCount += 1;
    }
  }

  return Array.from(groups.values());
}

export function computeBudgetProgress(
  plannedTotal: number,
  budgetAmount?: number | null
): ShoppingBudgetProgress {
  if (!budgetAmount || budgetAmount <= 0) {
    return {
      hasBudget: false,
      percent: 0,
      overBudget: false,
      difference: 0,
    };
  }

  const ratio = plannedTotal / budgetAmount;
  return {
    hasBudget: true,
    percent: Math.min(100, Math.max(0, Math.round(ratio * 100))),
    overBudget: plannedTotal > budgetAmount,
    difference: Math.abs(budgetAmount - plannedTotal),
  };
}

export function parseOptionalAmountInput(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}
