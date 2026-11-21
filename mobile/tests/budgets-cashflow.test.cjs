/**
 * Unit and screen tests for Personal Budgets ("Anggaran pribadi")
 * and Personal Cash Flow Reports ("Arus kas pribadi").
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

const budgetUtils = loadTsModule(
  path.join(mobileRoot, 'utils/budgets.ts'),
  (name) => {
    throw new Error(`Unexpected import in utils/budgets.ts: ${name}`);
  }
);

const formatMoney = (value) => `Rp${Number(value || 0).toLocaleString('id-ID')}`;

test('budget helpers shift months, prioritize exceeded alerts, and build shareable cash-flow summaries', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(budgetUtils.shiftMonth(2026, 1, -1))), {
    year: 2025,
    month: 12,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(budgetUtils.shiftMonth(2026, 12, 1))), {
    year: 2027,
    month: 1,
  });
  assert.equal(budgetUtils.formatMonthYearIndo(2026, 11), 'November 2026');

  const alert = budgetUtils.summarizeBudgetAlertBanner(
    {
      year: 2026,
      month: 11,
      start_date: '2026-11-01',
      end_date: '2026-11-30',
      total_expense: 1_500_000,
      overall_budget: {
        id: 1,
        user_id: 1,
        category_id: null,
        category_name: null,
        amount: 2_000_000,
        spent: 1_700_000,
        remaining: 300_000,
        percentage: 85,
        alert_threshold: 80,
        status: 'warning',
      },
      category_budgets: [
        {
          id: 2,
          user_id: 1,
          category_id: 10,
          category_name: 'Transportasi',
          amount: 300_000,
          spent: 360_000,
          remaining: -60_000,
          percentage: 120,
          alert_threshold: 80,
          status: 'exceeded',
        },
      ],
      allocated_category_total: 300_000,
      warning_count: 1,
      exceeded_count: 1,
    },
    formatMoney
  );
  assert.equal(alert.tone, 'exceeded');
  assert.equal(alert.title, 'Anggaran Transportasi melebihi batas');

  const shareText = budgetUtils.buildCashFlowShareText(
    {
      title: 'Arus Kas November 2026',
      period: 'monthly',
      start_date: '2026-11-01',
      end_date: '2026-11-30',
      previous_title: 'Oktober 2026',
      previous_start_date: '2026-10-01',
      previous_end_date: '2026-10-31',
      current: {
        operating_inflow: 5_000_000,
        operating_outflow: 2_000_000,
        operating_net: 3_000_000,
        investing_outflow: 1_000_000,
        financing_inflow: 0,
        financing_outflow: 500_000,
        financing_net: -500_000,
        net_cash_flow: 1_500_000,
        saving_rate_pct: 60,
        operating_income_breakdown: [],
        operating_expense_breakdown: [],
      },
      previous: {
        operating_inflow: 4_000_000,
        operating_outflow: 2_000_000,
        operating_net: 2_000_000,
        investing_outflow: 500_000,
        financing_net: 0,
        net_cash_flow: 1_500_000,
      },
      comparison: {
        net_delta: 0,
        operating_net_delta: 1_000_000,
        operating_inflow_delta_pct: 25,
        operating_outflow_delta_pct: 0,
      },
    },
    formatMoney
  );
  assert.match(shareText, /Arus Kas Operasional:/);
  assert.match(shareText, /Rasio Tabungan Operasional: 60%/);
});

test('CashFlowStatementCard renders operating/investing/financing flows, expands details, and shares summary', async () => {
  const shares = [];
  const sample = {
    title: 'Arus Kas November 2026',
    period: 'monthly',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    previous_title: 'Oktober 2026',
    previous_start_date: '2026-10-01',
    previous_end_date: '2026-10-31',
    current: {
      operating_inflow: 5_000_000,
      operating_outflow: 1_500_000,
      operating_net: 3_500_000,
      investing_outflow: 1_000_000,
      financing_inflow: 600_000,
      financing_outflow: 200_000,
      financing_net: 400_000,
      net_cash_flow: 2_900_000,
      saving_rate_pct: 70,
      operating_income_breakdown: [{ name: 'Gaji', amount: 5_000_000, percentage: 100 }],
      operating_expense_breakdown: [{ name: 'Makan & Minum', amount: 1_500_000, percentage: 100 }],
    },
    previous: {
      operating_inflow: 4_000_000,
      operating_outflow: 1_500_000,
      operating_net: 2_500_000,
      investing_outflow: 500_000,
      financing_net: 0,
      net_cash_flow: 2_000_000,
    },
    comparison: {
      net_delta: 900_000,
      operating_net_delta: 1_000_000,
      operating_inflow_delta_pct: 25,
      operating_outflow_delta_pct: 0,
    },
  };

  const harness = createHarness({
    componentPath: 'components/reports/CashFlowStatementCard.tsx',
    exportName: 'CashFlowStatementCard',
    props: { report: sample },
    modules: {
      'react-native': {
        Share: { share: async (payload) => shares.push(payload) },
      },
      '../ui/Card': { Card: stub('Card') },
      '../ui/Skeleton': { Skeleton: stub('Skeleton') },
      '../../utils/budgets': budgetUtils,
    },
  });

  await harness.mount();
  assert.ok(harness.texts().includes('1. Arus kas operasional'));
  assert.ok(harness.texts().includes('2. Arus kas investasi'));
  assert.ok(harness.texts().includes('3. Arus kas hutang & piutang'));
  assert.ok(harness.texts().includes('Saving rate 70%'));

  await harness.press('Lihat rincian arus kas');
  assert.ok(harness.texts().includes('Gaji'));
  assert.ok(harness.texts().includes('Makan & Minum'));

  await harness.press('Bagikan laporan arus kas');
  assert.equal(shares.length, 1);
  assert.match(shares[0].message, /Arus Kas November 2026/);
});

test('BudgetsScreen displays overview, switches months, saves a budget, and deletes one', async () => {
  const calls = { upserts: [], deletes: [], alerts: [] };
  let overview = {
    year: 2026,
    month: 11,
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    total_expense: 1_100_000,
    overall_budget: {
      id: 1,
      user_id: 1,
      category_id: null,
      category_name: null,
      amount: 2_500_000,
      spent: 1_100_000,
      remaining: 1_400_000,
      percentage: 44,
      alert_threshold: 80,
      status: 'safe',
    },
    category_budgets: [
      {
        id: 2,
        user_id: 1,
        category_id: 10,
        category_name: 'Makan & Minum',
        amount: 1_000_000,
        spent: 850_000,
        remaining: 150_000,
        percentage: 85,
        alert_threshold: 80,
        status: 'warning',
      },
    ],
    allocated_category_total: 1_000_000,
    warning_count: 1,
    exceeded_count: 0,
  };

  const harness = createHarness({
    componentPath: 'app/budgets.tsx',
    modules: {
      'expo-router': {
        router: { push: () => {}, back: () => {}, replace: () => {} },
        useFocusEffect: (cb) => harness.React.useEffect(() => cb(), [cb]),
      },
      'react-native': { ScrollView: stub('ScrollView') },
      '../services/appAlert': {
        AppAlert: {
          alert: (title, message, buttons) => calls.alerts.push({ title, message, buttons }),
        },
      },
      '../services/auth': { describeApiError: (_e, f) => f },
      '../services/categories': {
        categoryApi: {
          getCategories: async () => [
            { id: 10, user_id: 1, type: 'expense', name: 'Makan & Minum', aliases: '', is_default: 1 },
            { id: 11, user_id: 1, type: 'expense', name: 'Transportasi', aliases: '', is_default: 1 },
          ],
        },
      },
      '../services/budgets': {
        budgetApi: {
          getOverview: async () => overview,
          upsert: async (payload) => {
            calls.upserts.push(payload);
            overview = {
              ...overview,
              category_budgets: [
                ...overview.category_budgets,
                {
                  id: 3,
                  user_id: 1,
                  category_id: 11,
                  category_name: 'Transportasi',
                  amount: payload.amount,
                  spent: 0,
                  remaining: payload.amount,
                  percentage: 0,
                  alert_threshold: payload.alert_threshold,
                  status: 'safe',
                },
              ],
            };
            return { id: 3, user_id: 1, ...payload };
          },
          remove: async (id) => {
            calls.deletes.push(id);
            overview = {
              ...overview,
              category_budgets: overview.category_budgets.filter((b) => b.id !== id),
            };
          },
        },
      },
      '../utils/budgets': budgetUtils,
      '../components/ui/Screen': {
        Screen: (props) => node('Screen', { ...props, children: [props.children, props.footer].flat() }),
      },
      '../components/ui/FadeIn': { FadeIn: stub('FadeIn') },
      '../components/ui/Card': { Card: stub('Card') },
      '../components/ui/Chip': {
        Chip: (props) =>
          node('Pressable', {
            ...props,
            accessibilityRole: 'button',
            accessibilityLabel: props.label,
            disabled: Boolean(props.disabled),
          }),
      },
      '../components/ui/Progress': { Progress: stub('Progress') },
      '../components/ui/Sheet': {
        Sheet: (props) =>
          props.visible
            ? node('Sheet', { ...props, children: [props.children, props.footer].flat() })
            : null,
      },
      '../components/ui/EmptyState': { EmptyState: stub('View') },
    },
  });

  await harness.mount();
  assert.ok(harness.texts().includes('Makan & Minum'));
  assert.ok(harness.texts().includes('Mendekati batas'));

  // Open sheet via footer CTA and save a new Transportasi budget.
  await harness.press('Atur anggaran');
  await harness.press('Transportasi');
  harness.change('Nominal batas anggaran', '400000');
  await harness.press('Simpan');

  assert.deepEqual(JSON.parse(JSON.stringify(calls.upserts)), [
    { category_id: 11, amount: 400_000, alert_threshold: 80 },
  ]);
  assert.ok(harness.texts().includes('Transportasi'));

  // Edit Makan & Minum and delete it.
  await harness.press('Edit anggaran Makan & Minum');
  await harness.press('Hapus anggaran');
  const confirmBtn = calls.alerts.at(-1).buttons.find((b) => b.text === 'Hapus');
  await confirmBtn.onPress();
  await harness.settle();

  assert.deepEqual(calls.deletes, [2]);
  assert.equal(harness.texts().includes('Makan & Minum'), false);
});
