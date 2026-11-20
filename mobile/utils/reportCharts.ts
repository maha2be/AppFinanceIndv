/** Pure geometry and financial-stability calculations for report charts. */
import { DailyFlowPoint, PeriodReport } from '../types';

export type CurveMetric = 'cumulative' | 'cashflow';
export type DonutMode = 'flow' | 'categories';
export type StabilityTone = 'income' | 'expense' | 'neutral';
export type ChartColorKey =
  | 'income'
  | 'expense'
  | 'investment'
  | 'debt'
  | 'receivable'
  | 'inkSoft';

export interface StabilityAssessment {
  status: string;
  tone: StabilityTone;
  detail: string;
  retentionPercent: number;
}

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  date: string;
}

export interface CurveGeometry {
  hasData: boolean;
  hasActivity: boolean;
  minValue: number;
  maxValue: number;
  zeroY: number;
  primaryPath: string;
  areaPath: string;
  secondaryPath: string;
  primaryPoints: ChartPoint[];
  secondaryPoints: ChartPoint[];
  xLabels: { start: string; middle: string; end: string };
  yLabels: { max: string; zero: string; min: string };
}

export interface DonutSlice {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  colorKey: ChartColorKey;
  path: string;
  isFullCircle: boolean;
}

export interface DonutBreakdown {
  hasData: boolean;
  total: number;
  centerLabel: string;
  centerValue: string;
  slices: DonutSlice[];
}

const SHORT_MONTHS_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
] as const;

const CATEGORY_COLOR_KEYS: readonly ChartColorKey[] = [
  'expense',
  'debt',
  'investment',
  'receivable',
  'income',
  'inkSoft',
];

export function formatShortDateLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const monthLabel = SHORT_MONTHS_ID[month - 1] ?? match[2];
  return `${day} ${monthLabel}`;
}

export function formatCompactRupiah(value: number): string {
  if (!Number.isFinite(value) || value === 0) return 'Rp0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    const scaled = (abs / 1_000_000_000).toFixed(abs % 1_000_000_000 === 0 ? 0 : 1);
    return `${sign}Rp${scaled.replace('.', ',')}M`;
  }
  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1);
    return `${sign}Rp${scaled.replace('.', ',')}jt`;
  }
  if (abs >= 1_000) {
    const scaled = Math.round(abs / 1_000);
    return `${sign}Rp${scaled}rb`;
  }
  return `${sign}Rp${Math.round(abs)}`;
}

export function assessFinancialStability(report: PeriodReport): StabilityAssessment {
  const income = Math.max(0, report.total_income || 0);
  const expense = Math.max(0, report.total_expense || 0);
  const investment = Math.max(0, report.total_investment || 0);
  const net = report.net ?? income - expense - investment;

  if (income === 0 && expense === 0 && investment === 0) {
    return {
      status: 'Belum ada data',
      tone: 'neutral',
      detail: 'Catat pemasukan atau pengeluaran untuk melihat kurva kestabilan.',
      retentionPercent: 0,
    };
  }

  if (income === 0) {
    return {
      status: 'Belum ada pemasukan',
      tone: 'expense',
      detail: 'Periode ini hanya memiliki arus keluar dan investasi.',
      retentionPercent: 0,
    };
  }

  const retained = Math.max(0, net + investment);
  const retentionPercent = Math.round((retained / income) * 100);

  if (net < 0) {
    return {
      status: 'Defisit · Perlu perhatian',
      tone: 'expense',
      detail: `Pengeluaran dan investasi melebihi pemasukan sebesar ${formatCompactRupiah(Math.abs(net))}.`,
      retentionPercent,
    };
  }

  if (retentionPercent >= 20) {
    return {
      status: 'Stabil · Surplus sehat',
      tone: 'income',
      detail: `Rasio simpan & investasi ${retentionPercent}% dari pemasukan.`,
      retentionPercent,
    };
  }

  return {
    status: 'Terjaga · Seimbang',
    tone: 'income',
    detail: `Arus kas positif dengan rasio simpan & investasi ${retentionPercent}% dari pemasukan.`,
    retentionPercent,
  };
}

function buildSmoothPath(points: readonly ChartPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = ((current.x + next.x) / 2).toFixed(2);
    path += ` C ${midX} ${current.y.toFixed(2)}, ${midX} ${next.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

export function buildCurveGeometry(
  timeline: readonly DailyFlowPoint[],
  metric: CurveMetric,
  options: { width: number; height: number; padX?: number; padTop?: number; padBottom?: number }
): CurveGeometry {
  const { width, height, padX = 10, padTop = 14, padBottom = 14 } = options;
  const emptyLabels = { start: '', middle: '', end: '' };

  if (!timeline || timeline.length === 0) {
    const midY = height / 2;
    return {
      hasData: false,
      hasActivity: false,
      minValue: 0,
      maxValue: 0,
      zeroY: midY,
      primaryPath: '',
      areaPath: '',
      secondaryPath: '',
      primaryPoints: [],
      secondaryPoints: [],
      xLabels: emptyLabels,
      yLabels: { max: 'Rp0', zero: 'Rp0', min: 'Rp0' },
    };
  }

  const primaryValues =
    metric === 'cumulative'
      ? timeline.map((point) => point.cumulative_net)
      : timeline.map((point) => point.income);
  const secondaryValues =
    metric === 'cashflow'
      ? timeline.map((point) => point.expense + point.investment)
      : [];

  const hasActivity = timeline.some(
    (point) => point.income > 0 || point.expense > 0 || point.investment > 0
  );

  const allValues = [0, ...primaryValues, ...secondaryValues];
  let minValue = Math.min(...allValues);
  let maxValue = Math.max(...allValues);
  if (minValue === maxValue) {
    maxValue = minValue + 1;
  }

  const plotWidth = Math.max(1, width - padX * 2);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const valueSpan = maxValue - minValue;

  const toX = (index: number) =>
    timeline.length === 1
      ? padX + plotWidth / 2
      : padX + (index / (timeline.length - 1)) * plotWidth;
  const toY = (value: number) =>
    padTop + ((maxValue - value) / valueSpan) * plotHeight;

  const zeroY = toY(0);
  const primaryPoints: ChartPoint[] = primaryValues.map((value, index) => ({
    x: toX(index),
    y: toY(value),
    value,
    date: timeline[index].date,
  }));
  const secondaryPoints: ChartPoint[] = secondaryValues.map((value, index) => ({
    x: toX(index),
    y: toY(value),
    value,
    date: timeline[index].date,
  }));

  const primaryPath = buildSmoothPath(primaryPoints);
  const secondaryPath = buildSmoothPath(secondaryPoints);

  let areaPath = '';
  if (metric === 'cumulative' && primaryPoints.length >= 2) {
    const first = primaryPoints[0];
    const last = primaryPoints[primaryPoints.length - 1];
    areaPath = `${primaryPath} L ${last.x.toFixed(2)} ${zeroY.toFixed(2)} L ${first.x.toFixed(2)} ${zeroY.toFixed(2)} Z`;
  }

  const midIndex = Math.floor((timeline.length - 1) / 2);
  const xLabels = {
    start: formatShortDateLabel(timeline[0].date),
    middle: timeline.length >= 3 ? formatShortDateLabel(timeline[midIndex].date) : '',
    end: timeline.length >= 2 ? formatShortDateLabel(timeline[timeline.length - 1].date) : '',
  };

  return {
    hasData: true,
    hasActivity,
    minValue,
    maxValue,
    zeroY,
    primaryPath,
    areaPath,
    secondaryPath,
    primaryPoints,
    secondaryPoints,
    xLabels,
    yLabels: {
      max: formatCompactRupiah(maxValue),
      zero: 'Rp0',
      min: minValue < 0 ? formatCompactRupiah(minValue) : 'Rp0',
    },
  };
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

export function describeDonutArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    'M', outerStart.x.toFixed(2), outerStart.y.toFixed(2),
    'A', outerR.toFixed(2), outerR.toFixed(2), 0, largeArc, 0, outerEnd.x.toFixed(2), outerEnd.y.toFixed(2),
    'L', innerEnd.x.toFixed(2), innerEnd.y.toFixed(2),
    'A', innerR.toFixed(2), innerR.toFixed(2), 0, largeArc, 1, innerStart.x.toFixed(2), innerStart.y.toFixed(2),
    'Z',
  ].join(' ');
}

export function buildDonutBreakdown(
  report: PeriodReport,
  mode: DonutMode,
  options: { size?: number; outerRadius?: number; innerRadius?: number } = {}
): DonutBreakdown {
  const size = options.size ?? 148;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = options.outerRadius ?? 64;
  const innerR = options.innerRadius ?? 42;

  const rawEntries: Array<{ key: string; label: string; amount: number; colorKey: ChartColorKey }> = [];

  if (mode === 'flow') {
    const income = Math.max(0, report.total_income || 0);
    const expense = Math.max(0, report.total_expense || 0);
    const investment = Math.max(0, report.total_investment || 0);
    const outflow = expense + investment;

    if (income > 0 && outflow <= income) {
      const surplus = income - outflow;
      if (expense > 0) rawEntries.push({ key: 'expense', label: 'Pengeluaran', amount: expense, colorKey: 'expense' });
      if (investment > 0) rawEntries.push({ key: 'investment', label: 'Investasi', amount: investment, colorKey: 'investment' });
      if (surplus > 0) rawEntries.push({ key: 'surplus', label: 'Surplus bersih', amount: surplus, colorKey: 'income' });
    } else {
      if (income > 0) rawEntries.push({ key: 'income', label: 'Pemasukan', amount: income, colorKey: 'income' });
      if (expense > 0) rawEntries.push({ key: 'expense', label: 'Pengeluaran', amount: expense, colorKey: 'expense' });
      if (investment > 0) rawEntries.push({ key: 'investment', label: 'Investasi', amount: investment, colorKey: 'investment' });
    }
  } else {
    const categories = (report.top_expense_categories || []).filter((item) => item.amount > 0);
    const top = categories.slice(0, 5);
    const rest = categories.slice(5);
    top.forEach((item, index) => {
      rawEntries.push({
        key: `cat-${index}-${item.name}`,
        label: item.name,
        amount: item.amount,
        colorKey: CATEGORY_COLOR_KEYS[index % CATEGORY_COLOR_KEYS.length],
      });
    });
    if (rest.length > 0) {
      const restAmount = rest.reduce((sum, item) => sum + item.amount, 0);
      if (restAmount > 0) {
        rawEntries.push({
          key: 'cat-other',
          label: 'Kategori lain',
          amount: restAmount,
          colorKey: 'inkSoft',
        });
      }
    }
  }

  const total = rawEntries.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0 || rawEntries.length === 0) {
    return {
      hasData: false,
      total: 0,
      centerLabel: mode === 'flow' ? 'Arus kas' : 'Pengeluaran',
      centerValue: 'Rp0',
      slices: [],
    };
  }

  const slices: DonutSlice[] = [];
  let cursorAngle = 0;

  rawEntries.forEach((entry, index) => {
    const fraction = entry.amount / total;
    const percentage = Math.round(fraction * 1000) / 10;
    const isLast = index === rawEntries.length - 1;
    const sweep = isLast ? 360 - cursorAngle : fraction * 360;
    const isFullCircle = rawEntries.length === 1 || sweep >= 359.9;
    const path = isFullCircle
      ? ''
      : describeDonutArc(cx, cy, outerR, innerR, cursorAngle, cursorAngle + sweep);

    slices.push({
      key: entry.key,
      label: entry.label,
      amount: entry.amount,
      percentage,
      colorKey: entry.colorKey,
      path,
      isFullCircle,
    });
    cursorAngle += sweep;
  });

  let centerLabel = 'Total keluar';
  let centerValue = formatCompactRupiah(total);
  if (mode === 'flow') {
    const stability = assessFinancialStability(report);
    if (report.total_income > 0 && report.net >= 0) {
      centerLabel = 'Simpan';
      centerValue = `${stability.retentionPercent}%`;
    } else if (report.net < 0) {
      centerLabel = 'Defisit';
      centerValue = formatCompactRupiah(Math.abs(report.net));
    } else {
      centerLabel = 'Total arus';
      centerValue = formatCompactRupiah(total);
    }
  }

  return {
    hasData: true,
    total,
    centerLabel,
    centerValue,
    slices,
  };
}
