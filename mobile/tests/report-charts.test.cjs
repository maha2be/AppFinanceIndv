/**
 * Unit and component regressions for the financial stability curve and donut
 * breakdown in the Reports tab.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

const chartsMath = loadTsModule(
  path.join(mobileRoot, 'utils/reportCharts.ts'),
  (name) => {
    throw new Error(`Unexpected import in reportCharts.ts: ${name}`);
  }
);

function sampleReport(overrides = {}) {
  return {
    title: 'Laporan Bulanan (November 2026)',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    total_income: 5_000_000,
    total_expense: 2_000_000,
    total_investment: 1_000_000,
    net: 2_000_000,
    average_expense: 400_000,
    investment_percentage: 20,
    top_expense_categories: [
      { name: 'Makan & Minum', amount: 1_200_000, percentage: 60 },
      { name: 'Transportasi', amount: 800_000, percentage: 40 },
    ],
    timeline: [
      { date: '2026-11-01', income: 5_000_000, expense: 0, investment: 0, net: 5_000_000, cumulative_net: 5_000_000 },
      { date: '2026-11-02', income: 0, expense: 1_200_000, investment: 0, net: -1_200_000, cumulative_net: 3_800_000 },
      { date: '2026-11-03', income: 0, expense: 800_000, investment: 1_000_000, net: -1_800_000, cumulative_net: 2_000_000 },
    ],
    ...overrides,
  };
}

test('assessFinancialStability classifies surplus, balanced, deficit, and empty periods accurately', () => {
  const healthy = chartsMath.assessFinancialStability(sampleReport());
  assert.equal(healthy.tone, 'income');
  assert.equal(healthy.status, 'Stabil · Surplus sehat');
  assert.equal(healthy.retentionPercent, 60);

  const balanced = chartsMath.assessFinancialStability(sampleReport({
    total_income: 1_000_000,
    total_expense: 900_000,
    total_investment: 50_000,
    net: 50_000,
  }));
  assert.equal(balanced.status, 'Terjaga · Seimbang');
  assert.equal(balanced.retentionPercent, 10);

  const deficit = chartsMath.assessFinancialStability(sampleReport({
    total_income: 1_000_000,
    total_expense: 1_200_000,
    total_investment: 0,
    net: -200_000,
  }));
  assert.equal(deficit.tone, 'expense');
  assert.equal(deficit.status, 'Defisit · Perlu perhatian');

  const empty = chartsMath.assessFinancialStability(sampleReport({
    total_income: 0,
    total_expense: 0,
    total_investment: 0,
    net: 0,
  }));
  assert.equal(empty.tone, 'neutral');
  assert.equal(empty.status, 'Belum ada data');
});

test('buildCurveGeometry builds smooth cumulative and cashflow paths including negative baselines', () => {
  const timeline = [
    { date: '2026-11-01', income: 0, expense: 300_000, investment: 0, net: -300_000, cumulative_net: -300_000 },
    { date: '2026-11-02', income: 600_000, expense: 100_000, investment: 0, net: 500_000, cumulative_net: 200_000 },
  ];

  const cumulative = chartsMath.buildCurveGeometry(timeline, 'cumulative', { width: 200, height: 120 });
  assert.equal(cumulative.hasData, true);
  assert.equal(cumulative.hasActivity, true);
  assert.equal(cumulative.minValue, -300_000);
  assert.equal(cumulative.maxValue, 200_000);
  assert.ok(cumulative.zeroY > 14 && cumulative.zeroY < 106);
  assert.match(cumulative.primaryPath, /^M .* C /);
  assert.match(cumulative.areaPath, /Z$/);
  assert.equal(cumulative.xLabels.start, '1 Nov');
  assert.equal(cumulative.xLabels.end, '2 Nov');

  const cashflow = chartsMath.buildCurveGeometry(timeline, 'cashflow', { width: 200, height: 120 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(cashflow.primaryPoints.map((p) => p.value))),
    [0, 600_000]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(cashflow.secondaryPoints.map((p) => p.value))),
    [300_000, 100_000]
  );
  assert.match(cashflow.secondaryPath, /^M .* C /);
});

test('buildDonutBreakdown computes valid flow and category slices including 100% single-slice fallback', () => {
  const flow = chartsMath.buildDonutBreakdown(sampleReport(), 'flow');
  assert.equal(flow.hasData, true);
  assert.equal(flow.centerLabel, 'Simpan');
  assert.equal(flow.centerValue, '60%');
  assert.deepEqual(
    JSON.parse(JSON.stringify(flow.slices.map((s) => s.label))),
    ['Pengeluaran', 'Investasi', 'Surplus bersih']
  );

  const singleCategory = chartsMath.buildDonutBreakdown(
    sampleReport({
      top_expense_categories: [{ name: 'Makan & Minum', amount: 500_000, percentage: 100 }],
    }),
    'categories'
  );
  assert.equal(singleCategory.slices.length, 1);
  assert.equal(singleCategory.slices[0].isFullCircle, true);

  const manyCategories = chartsMath.buildDonutBreakdown(
    sampleReport({
      top_expense_categories: [
        { name: 'A', amount: 100, percentage: 20 },
        { name: 'B', amount: 90, percentage: 18 },
        { name: 'C', amount: 80, percentage: 16 },
        { name: 'D', amount: 70, percentage: 14 },
        { name: 'E', amount: 60, percentage: 12 },
        { name: 'F', amount: 50, percentage: 10 },
        { name: 'G', amount: 50, percentage: 10 },
      ],
    }),
    'categories'
  );
  assert.equal(manyCategories.slices.length, 6);
  assert.equal(manyCategories.slices[5].label, 'Kategori lain');
  assert.equal(manyCategories.slices[5].amount, 100);
});

test('FinancialStabilityCharts renders curve and donut and switches modes interactively', async () => {
  const dimensions = { width: 390, fontScale: 1 };
  const harness = createHarness({
    componentPath: 'components/reports/FinancialStabilityCharts.tsx',
    exportName: 'FinancialStabilityCharts',
    props: { report: sampleReport() },
    modules: {
      'react-native': { useWindowDimensions: () => dimensions },
      'react-native-svg': {
        default: (props) => node('Svg', props),
        Svg: (props) => node('Svg', props),
        Path: (props) => node('Path', props),
        Line: (props) => node('Line', props),
        Circle: (props) => node('Circle', props),
        Defs: (props) => node('Defs', props),
        LinearGradient: (props) => node('LinearGradient', props),
        Stop: (props) => node('Stop', props),
      },
      '../ui/Card': { Card: stub('Card') },
      '../ui/EmptyState': { EmptyState: (props) => node('EmptyState', props) },
      '../ui/Skeleton': { Skeleton: stub('Skeleton') },
    },
  });

  await harness.mount();

  assert.ok(harness.texts().includes('Kurva kestabilan'));
  assert.ok(harness.texts().includes('Stabil · Surplus sehat'));
  assert.ok(harness.texts().includes('Saldo bersih kumulatif'));
  assert.ok(harness.texts().includes('Diagram lingkaran'));
  assert.ok(harness.texts().includes('Surplus bersih'));
  assert.ok(harness.allByType('Svg').length >= 2);
  assert.ok(harness.allByType('Path').length >= 4);

  // Switch curve from Saldo -> Arus
  await harness.press('Kurva Arus');
  assert.ok(harness.texts().includes('Pemasukan'));
  assert.ok(harness.texts().includes('Pengeluaran & investasi'));

  // Switch donut from Arus -> Kategori
  await harness.press('Diagram Kategori');
  assert.ok(harness.texts().includes('Makan & Minum'));
  assert.ok(harness.texts().includes('Transportasi'));

  // Loading skeleton state
  harness.update({ report: null });
  assert.ok(harness.allByType('Skeleton').length > 0);
});
