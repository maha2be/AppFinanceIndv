/** Pure scheduling and urgency helpers for installment payment reminders. */
import { Debt } from '../types';

export const DEFAULT_REMINDER_LEAD_DAYS = 3;
export const DEFAULT_REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_MINUTE = 0;

export type InstallmentUrgency = 'overdue' | 'today' | 'soon';

export interface UrgentInstallment {
  debt: Debt;
  remaining: number;
  dueDate: string;
  daysUntilDue: number;
  urgency: InstallmentUrgency;
  headline: string;
  detail: string;
}

export interface ScheduledInstallmentPlan {
  id: string;
  debtId: number;
  offsetDays: number;
  fireAtMs: number;
  title: string;
  body: string;
  dueDate: string;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHORT_MONTHS_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
] as const;

export function parseIsoDateParts(isoDate: string | null | undefined): {
  year: number;
  month: number;
  day: number;
} | null {
  if (!isoDate) return null;
  const match = ISO_DATE_RE.exec(isoDate.trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function diffIsoDays(targetIso: string, todayIso: string): number | null {
  const target = parseIsoDateParts(targetIso);
  const today = parseIsoDateParts(todayIso);
  if (!target || !today) return null;
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

export function formatReminderRupiah(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return `Rp${safe.toLocaleString('id-ID')}`;
}

export function formatReminderDate(isoDate: string): string {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return isoDate;
  return `${parts.day} ${SHORT_MONTHS_ID[parts.month - 1] ?? parts.month} ${parts.year}`;
}

export function findUrgentInstallments(
  debts: readonly Debt[],
  todayIso: string,
  leadDays = DEFAULT_REMINDER_LEAD_DAYS
): UrgentInstallment[] {
  const urgent: UrgentInstallment[] = [];

  for (const debt of debts) {
    if (debt.type !== 'debt' || debt.status !== 'active') continue;
    const remaining = Math.max(0, (debt.total_amount || 0) - (debt.paid_amount || 0));
    if (remaining <= 0 || !debt.due_date) continue;

    const daysUntilDue = diffIsoDays(debt.due_date, todayIso);
    if (daysUntilDue === null || daysUntilDue > leadDays) continue;

    const amountLabel = formatReminderRupiah(remaining);
    const dateLabel = formatReminderDate(debt.due_date);

    let urgency: InstallmentUrgency;
    let headline: string;
    let detail: string;

    if (daysUntilDue < 0) {
      urgency = 'overdue';
      const lateDays = Math.abs(daysUntilDue);
      headline = `Lewat ${lateDays} hari · ${debt.person_name}`;
      detail = `Cicilan ke ${debt.person_name} (${amountLabel}) lewat jatuh tempo ${dateLabel}.`;
    } else if (daysUntilDue === 0) {
      urgency = 'today';
      headline = `Jatuh tempo hari ini · ${debt.person_name}`;
      detail = `Segera bayar cicilan ke ${debt.person_name} sebesar ${amountLabel} hari ini.`;
    } else {
      urgency = 'soon';
      headline = `${daysUntilDue} hari lagi · ${debt.person_name}`;
      detail = `Cicilan ke ${debt.person_name} (${amountLabel}) jatuh tempo ${dateLabel}.`;
    }

    urgent.push({
      debt,
      remaining,
      dueDate: debt.due_date,
      daysUntilDue,
      urgency,
      headline,
      detail,
    });
  }

  urgent.sort((left, right) => {
    if (left.daysUntilDue !== right.daysUntilDue) {
      return left.daysUntilDue - right.daysUntilDue;
    }
    return right.remaining - left.remaining;
  });

  return urgent;
}

export function buildInstallmentNotificationPlans(
  debts: readonly Debt[],
  options: {
    now?: Date;
    hour?: number;
    minute?: number;
    offsets?: readonly number[];
  } = {}
): ScheduledInstallmentPlan[] {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const hour = options.hour ?? DEFAULT_REMINDER_HOUR;
  const minute = options.minute ?? DEFAULT_REMINDER_MINUTE;
  const offsets = options.offsets ?? [3, 1, 0];
  const plans: ScheduledInstallmentPlan[] = [];

  for (const debt of debts) {
    if (debt.type !== 'debt' || debt.status !== 'active') continue;
    const remaining = Math.max(0, (debt.total_amount || 0) - (debt.paid_amount || 0));
    if (remaining <= 0 || !debt.due_date) continue;

    const parts = parseIsoDateParts(debt.due_date);
    if (!parts) continue;

    const amountLabel = formatReminderRupiah(remaining);
    const dateLabel = formatReminderDate(debt.due_date);

    for (const offsetDays of offsets) {
      const fireDate = new Date(
        parts.year,
        parts.month - 1,
        parts.day - offsetDays,
        hour,
        minute,
        0,
        0
      );
      const fireAtMs = fireDate.getTime();
      if (!Number.isFinite(fireAtMs) || fireAtMs <= nowMs) {
        continue;
      }

      const title =
        offsetDays === 0
          ? 'Segera bayar cicilan hari ini'
          : offsetDays === 1
          ? 'Besok jatuh tempo cicilan'
          : `Pengingat cicilan H-${offsetDays}`;

      const body =
        offsetDays === 0
          ? `Hari ini jatuh tempo cicilan ke ${debt.person_name} (sisa ${amountLabel}).`
          : offsetDays === 1
          ? `Besok (${dateLabel}) jatuh tempo cicilan ke ${debt.person_name} (sisa ${amountLabel}).`
          : `${offsetDays} hari lagi (${dateLabel}) jatuh tempo cicilan ke ${debt.person_name} (sisa ${amountLabel}).`;

      plans.push({
        id: `installment:${debt.id}:${debt.due_date}:h-${offsetDays}`,
        debtId: debt.id,
        offsetDays,
        fireAtMs,
        title,
        body,
        dueDate: debt.due_date,
      });
    }
  }

  plans.sort((left, right) => left.fireAtMs - right.fireAtMs);
  return plans;
}
