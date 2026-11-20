/**
 * Runtime regressions for the Home report period cycle button
 * ("Hari" -> "Minggu" -> "Bulan" -> "Hari") and ReportSummaryCard rendering.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function makeReport(title, net) {
  return {
    title,
    start_date: '2026-11-16',
    end_date: '2026-11-22',
    total_income: net + 100_000,
    total_expense: 100_000,
    total_investment: 0,
    net,
    average_expense: 50_000,
    investment_percentage: 0,
    top_expense_categories: [],
  };
}

function createHomeHarness(options = {}) {
  const calls = { daily: 0, weekly: 0, monthly: 0 };
  const behavior = {
    getDailyReport: async () => makeReport('Laporan Harian (18 November 2026)', 200_000),
    getWeeklyReport: async () => makeReport('Laporan Mingguan (16 November - 22 November 2026)', 750_000),
    getMonthlyReport: async () => makeReport('Laporan Bulanan (November 2026)', 2_500_000),
    ...options.behavior,
  };

  const reportApi = {
    getDailyReport: () => {
      calls.daily += 1;
      return behavior.getDailyReport();
    },
    getWeeklyReport: () => {
      calls.weekly += 1;
      return behavior.getWeeklyReport();
    },
    getMonthlyReport: () => {
      calls.monthly += 1;
      return behavior.getMonthlyReport();
    },
  };

  const harness = createHarness({
    componentPath: 'app/(tabs)/index.tsx',
    modules: {
      'expo-router': {
        router: { push: () => {}, replace: () => {}, back: () => {} },
        useFocusEffect: (cb) => harness.React.useEffect(() => cb(), [cb]),
      },
    },
    moduleFallback: [
      [/components\/ui\/Screen$/, { Screen: stub('Screen') }],
      [/components\/ui\/FadeIn$/, { FadeIn: stub('View') }],
      [/components\/ui\/SectionHeader$/, { SectionHeader: stub('SectionHeader') }],
      [/components\/ui\/EmptyState$/, { EmptyState: stub('View') }],
      [/components\/ui\/ErrorState$/, { ErrorState: stub('ErrorState') }],
      [/components\/QuickInputBar$/, { QuickInputBar: (props) => node('QuickInputBar', props) }],
      [/components\/DebtSummaryCard$/, { DebtSummaryCard: stub('View') }],
      [/components\/TransactionCard$/, { TransactionCard: stub('View') }],
      [/components\/ReportSummaryCard$/, {
        ReportSummaryCard: (props) => node('ReportSummaryCard', {
          ...props,
          children: [
            props.report ? node('Text', { children: props.report.title }) : null,
            props.periodLabel
              ? node('Pressable', {
                  disabled: false,
                  accessibilityRole: 'button',
                  accessibilityLabel: `Periode laporan ${props.periodLabel}`,
                  onPress: props.onTogglePeriod,
                  children: [node('Text', { children: props.periodLabel })],
                })
              : null,
          ],
        }),
      }],
      [/services\/reports$/, { reportApi }],
      [/services\/transactions$/, { transactionApi: { getTransactions: async () => [] } }],
      [/services\/auth$/, {
        authApi: { getProfile: async () => ({ id: 1, first_name: 'Ayu', timezone: 'Asia/Jakarta', currency: 'IDR' }) },
        describeApiError: (_e, fallback) => fallback,
      }],
      [/services\/debts$/, { debtApi: { getSummary: async () => ({ total_debt_remaining: 0, total_receivable_remaining: 0 }) } }],
    ],
  });

  return { harness, calls, behavior };
}

test('home report cycles Hari -> Minggu -> Bulan -> Hari and updates report data', async () => {
  const { harness, calls } = createHomeHarness();
  await harness.mount();

  assert.equal(calls.daily, 1);
  assert.equal(calls.weekly, 0);
  assert.equal(calls.monthly, 0);
  assert.ok(harness.byLabel('Periode laporan Hari'));
  assert.ok(harness.texts().includes('Hari'));
  assert.ok(harness.texts().includes('Laporan Harian (18 November 2026)'));

  await harness.press('Periode laporan Hari');
  assert.equal(calls.weekly, 1);
  assert.ok(harness.byLabel('Periode laporan Minggu'));
  assert.ok(harness.texts().includes('Minggu'));
  assert.ok(harness.texts().includes('Laporan Mingguan (16 November - 22 November 2026)'));

  await harness.press('Periode laporan Minggu');
  assert.equal(calls.monthly, 1);
  assert.ok(harness.byLabel('Periode laporan Bulan'));
  assert.ok(harness.texts().includes('Bulan'));
  assert.ok(harness.texts().includes('Laporan Bulanan (November 2026)'));

  await harness.press('Periode laporan Bulan');
  assert.equal(calls.daily, 2);
  assert.ok(harness.byLabel('Periode laporan Hari'));
  assert.ok(harness.texts().includes('Laporan Harian (18 November 2026)'));
});

test('rapid taps ignore slow stale weekly report when monthly already succeeded', async () => {
  const slowWeekly = deferred();
  const { harness, calls } = createHomeHarness({
    behavior: {
      getWeeklyReport: () => slowWeekly.promise,
    },
  });
  await harness.mount();

  // Tap 1: Hari -> Minggu (stays pending)
  const firstTap = harness.byLabel('Periode laporan Hari').props.onPress();
  harness.flush();
  assert.equal(calls.weekly, 1);
  assert.ok(harness.byLabel('Periode laporan Minggu'));

  // Tap 2: Minggu -> Bulan (resolves immediately)
  await harness.press('Periode laporan Minggu');
  assert.equal(calls.monthly, 1);
  assert.ok(harness.byLabel('Periode laporan Bulan'));
  assert.ok(harness.texts().includes('Laporan Bulanan (November 2026)'));

  // Now the slow weekly response finally resolves; Bulan must stay displayed.
  slowWeekly.resolve(makeReport('Laporan Mingguan (Stale)', 111));
  await firstTap;
  await harness.settle();

  assert.ok(harness.byLabel('Periode laporan Bulan'));
  assert.ok(harness.texts().includes('Laporan Bulanan (November 2026)'));
  assert.equal(harness.texts().includes('Laporan Mingguan (Stale)'), false);
});

test('QuickInputBar success refreshes the currently selected period (Minggu)', async () => {
  const { harness, calls } = createHomeHarness();
  await harness.mount();

  await harness.press('Periode laporan Hari');
  assert.equal(calls.weekly, 1);
  assert.equal(calls.daily, 1);

  await harness.byType('QuickInputBar').props.onSuccess();
  await harness.settle();

  assert.equal(calls.weekly, 2);
  assert.equal(calls.daily, 1);
  assert.ok(harness.byLabel('Periode laporan Minggu'));
});

test('ReportSummaryCard renders period toggle only when provided', async () => {
  const mountCard = async (props) => {
    const harness = createHarness({
      componentPath: 'components/ReportSummaryCard.tsx',
      exportName: 'ReportSummaryCard',
      props,
      modules: {
        './ui/Card': { Card: stub('Card') },
        './ui/Amount': { Amount: stub('Amount') },
        './ui/Skeleton': { Skeleton: stub('Skeleton') },
      },
    });
    await harness.mount();
    return harness;
  };

  let toggled = 0;
  const withToggle = await mountCard({
    report: makeReport('Laporan Harian (20 November 2026)', 100_000),
    periodLabel: 'Hari',
    onTogglePeriod: () => { toggled += 1; },
  });
  assert.ok(withToggle.byLabel('Periode laporan Hari'));
  assert.ok(withToggle.texts().includes('Hari'));
  await withToggle.press('Periode laporan Hari');
  assert.equal(toggled, 1);

  const withoutToggle = await mountCard({
    report: makeReport('Laporan Bulanan', 100_000),
  });
  assert.equal(withoutToggle.byLabel('Periode laporan Hari'), undefined);
});
