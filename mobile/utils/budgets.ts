/** Pure helpers for personal budgets, alert summaries, and cash-flow formatting. */
import type {
  BudgetOverview,
  BudgetProgress,
  BudgetStatus,
  CashFlowReport,
} from '../types';

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
] as const;

export function formatMonthYearIndo(year: number, month: number): string {
  const name = MONTHS_ID[month - 1] ?? '';
  return `${name} ${year}`.trim();
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth };
}

export function budgetStatusLabel(status: BudgetStatus): string {
  if (status === 'exceeded') return 'Melebihi batas';
  if (status === 'warning') return 'Mendekati batas';
  return 'Aman';
}

export function clampedBudgetPercent(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

export interface BudgetAlertSummary {
  tone: 'warning' | 'exceeded';
  title: string;
  detail: string;
}

export function summarizeBudgetAlertBanner(
  overview: BudgetOverview | null | undefined,
  formatCurrency: (value: number) => string
): BudgetAlertSummary | null {
  if (!overview) return null;
  const items: BudgetProgress[] = [
    ...(overview.overall_budget ? [overview.overall_budget] : []),
    ...overview.category_budgets,
  ];
  const exceeded = items.filter((item) => item.status === 'exceeded');
  const warnings = items.filter((item) => item.status === 'warning');
  if (exceeded.length === 0 && warnings.length === 0) {
    return null;
  }

  const top = exceeded[0] ?? warnings[0];
  const label = top.category_name || 'Total bulanan';
  if (exceeded.length > 0) {
    return {
      tone: 'exceeded',
      title:
        exceeded.length > 1
          ? `${exceeded.length} anggaran melebihi batas`
          : `Anggaran ${label} melebihi batas`,
      detail: `Terpakai ${formatCurrency(top.spent)} dari batas ${formatCurrency(top.amount)} (${Math.round(top.percentage)}%).`,
    };
  }

  return {
    tone: 'warning',
    title:
      warnings.length > 1
        ? `${warnings.length} anggaran mendekati batas`
        : `Anggaran ${label} mendekati batas`,
    detail: `Terpakai ${Math.round(top.percentage)}% · sisa ${formatCurrency(Math.max(0, top.remaining))}.`,
  };
}

export function formatSignedCurrency(
  amount: number,
  formatCurrency: (value: number) => string
): string {
  if (amount > 0) return `+${formatCurrency(amount)}`;
  if (amount < 0) return `−${formatCurrency(Math.abs(amount))}`;
  return formatCurrency(0);
}

export function buildCashFlowShareText(
  report: CashFlowReport,
  formatCurrency: (value: number) => string
): string {
  const c = report.current;
  const lines = [
    `${report.title} (${report.start_date} s.d. ${report.end_date})`,
    '',
    `Arus Kas Operasional: ${formatSignedCurrency(c.operating_net, formatCurrency)}`,
    `  • Pemasukan: ${formatCurrency(c.operating_inflow)}`,
    `  • Pengeluaran: ${formatCurrency(c.operating_outflow)}`,
    `Arus Kas Investasi: −${formatCurrency(c.investing_outflow)}`,
    `Arus Kas Hutang & Piutang: ${formatSignedCurrency(c.financing_net, formatCurrency)}`,
    `  • Kas masuk cicilan/pinjaman: ${formatCurrency(c.financing_inflow)}`,
    `  • Kas keluar bayar/beri pinjaman: ${formatCurrency(c.financing_outflow)}`,
    '',
    `Total Arus Kas Bersih: ${formatSignedCurrency(c.net_cash_flow, formatCurrency)}`,
    `Rasio Tabungan Operasional: ${c.saving_rate_pct}%`,
    `Perbandingan vs ${report.previous_title}: ${formatSignedCurrency(report.comparison.net_delta, formatCurrency)}`,
  ];
  return lines.join('\n');
}
