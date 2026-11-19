/**
 * Screen-level wiring tests for the transaction browser and its Home/Reports
 * entry points.
 *
 * The real pure helpers from `utils/` and the real SectionHeader are loaded by
 * the harness. The pagination child is replaced by a minimal contract double
 * that only exposes page buttons calling `onSelectPage`; strip tokens and the
 * jump sheet are covered by `transaction-pagination.test.cjs`.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createHarness,
  loadComponentModule,
} = require('./support/screen-harness.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BROWSER_PATH = 'app/transactions.tsx';

function node(type, props = {}) {
  const children = props.children === undefined
    ? []
    : (Array.isArray(props.children) ? props.children : [props.children]);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

function pageBody({ page = 1, total = 45, total_pages = 3, items = [] } = {}) {
  return { items, total, page, page_size: 20, total_pages };
}

function transaction(id) {
  return {
    id,
    user_id: 1,
    type: 'expense',
    category_id: null,
    category_name: null,
    amount: 10_000,
    note: `transaksi ${id}`,
    asset_name: null,
    transaction_date: '2026-01-01',
    can_edit: true,
    can_delete: true,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * FlatList stub mirroring the real render path: the screen now supplies
 * ListHeaderComponent/ListEmptyComponent/ListFooterComponent and renderItem
 * instead of JSX children.
 */
function FlatListStub(props = {}) {
  const renderComponent = (component) => {
    if (component === undefined || component === null) return null;
    return typeof component === 'function' ? component() : component;
  };
  const header = renderComponent(props.ListHeaderComponent);
  const body = Array.isArray(props.data) && props.data.length > 0
    ? props.data.map((item, index) => (
        typeof props.renderItem === 'function' ? props.renderItem({ item, index }) : null
      ))
    : renderComponent(props.ListEmptyComponent);
  const footer = renderComponent(props.ListFooterComponent);
  return node('FlatList', { testID: props.testID, children: [header, body, footer] });
}

/**
 * Minimal pagination contract double. No token selection, no jump sheet: only
 * prev/next and the current neighbours, each calling `onSelectPage`.
 */
function PaginationDouble(props = {}) {
  const currentPage = Number(props.currentPage) || 1;
  const totalPages = Number(props.totalPages) || 0;
  const disabled = Boolean(props.disabled);
  const onSelectPage = typeof props.onSelectPage === 'function'
    ? props.onSelectPage
    : () => {};
  if (totalPages < 1) return null;

  const pages = [...new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);

  const controls = [
    node('Pressable', {
      testID: 'page-prev',
      disabled: disabled || currentPage <= 1,
      accessibilityRole: 'button',
      accessibilityState: { disabled: disabled || currentPage <= 1 },
      onPress: () => onSelectPage(currentPage - 1),
    }),
    ...pages.map((page) => node('Pressable', {
      testID: `page-${page}`,
      disabled,
      accessibilityRole: 'button',
      accessibilityLabel: `Halaman ${page}`,
      accessibilityState: { selected: page === currentPage, disabled },
      onPress: () => onSelectPage(page),
    })),
    node('Pressable', {
      testID: 'page-next',
      disabled: disabled || currentPage >= totalPages,
      accessibilityState: { disabled: disabled || currentPage >= totalPages },
      onPress: () => onSelectPage(currentPage + 1),
    }),
  ];

  return node('View', { children: controls });
}

// The production SectionHeader, so the underline assertion is not a regex.
const RealSectionHeader = loadComponentModule('components/ui/SectionHeader.tsx', {
  modules: {
    react: {},
    'react-native': {
      Pressable: 'Pressable',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (styles) => styles },
    },
  },
  exportName: 'SectionHeader',
});

function flattenStyle(style) {
  if (Array.isArray(style)) {
    return style.reduce(
      (merged, entry) => ({ ...merged, ...flattenStyle(entry) }),
      {}
    );
  }
  return style && typeof style === 'object' ? style : {};
}

function createBrowserHarness({ handler }) {
  const calls = [];
  const pushes = [];
  const transactionApi = {
    getTransactionPage(params) {
      calls.push(params);
      return handler(params, calls.length);
    },
    getTransactions: async () => [],
  };
  const categoryApi = {
    getCategories: async () => [],
    listCategories: async () => [],
  };
  const router = {
    push: (...args) => pushes.push(args),
    replace: () => {},
    back: () => {},
  };

  const modules = {
    'expo-router': { router, useLocalSearchParams: () => ({}) },
    'react-native': {
      FlatList: FlatListStub,
      ScrollView: stub('ScrollView'),
      ActivityIndicator: stub('ActivityIndicator'),
      TextInput: stub('TextInput'),
    },
  };

  const fallback = [
    [/components\/ui\/Screen$/, { Screen: stub('View') }],
    [/components\/ui\/Input$/, { Input: stub('Input') }],
    [/components\/ui\/Button$/, { Button: stub('Pressable') }],
    [/components\/ui\/SectionHeader$/, { SectionHeader: RealSectionHeader }],
    [/components\/ui\/Sheet$/, {
      Sheet: (props = {}) => (props.visible ? node('View', props) : null),
    }],
    [/components\/ui\/EmptyState$/, { EmptyState: (props = {}) => node('EmptyState', props) }],
    [/components\/ui\/ErrorState$/, { ErrorState: stub('View') }],
    [/components\/ui\/Skeleton$/, { SkeletonRows: stub('View'), Skeleton: stub('View') }],
    [/components\/ui\/Progress$/, { Progress: stub('View') }],
    [/components\/ui\/Amount$/, { Amount: stub('View') }],
    [/components\/ui\/FadeIn$/, { FadeIn: stub('View') }],
    [/components\/TransactionCard$/, {
      TransactionCard: (props = {}) => node('TransactionCard', {
        transaction: props.transaction,
      }),
    }],
    [/components\/transactions\/TransactionFilters$/, {
      // Filter-sheet double: exposes one control that applies a fixed draft so
      // the screen's apply wiring can be exercised without the real sheet.
      TransactionFilters: (props = {}) => (props.visible
        ? node('View', {
            children: [
              node('Pressable', {
                testID: 'test-apply-filter',
                disabled: false,
                onPress: () => props.onApply({
                  q: 'kopi',
                  start_date: '2026-01-01',
                  end_date: '2026-01-31',
                }),
              }),
            ],
          })
        : null),
    }],
    [/components\/transactions\/TransactionPagination$/, {
      TransactionPagination: PaginationDouble,
    }],
    [/services\/transactions$/, { transactionApi }],
    [/services\/categories$/, { categoryApi }],
    [/services\/auth$/, { describeApiError: () => 'Gagal memuat data.' }],
  ];

  const harness = createHarness({
    componentPath: BROWSER_PATH,
    modules,
    moduleFallback: fallback,
  });

  return { harness, calls, pushes, router, transactionApi };
}

async function mountBrowser(options) {
  const bundle = createBrowserHarness(options);
  await bundle.harness.mount();
  return bundle;
}

function assertProp(testID, harness, key, expected) {
  const control = harness.byTestID(testID);
  assert.ok(control, `${testID} must be rendered`);
  assert.deepEqual(control.props[key], expected, `${testID}.${key}`);
}

/* ------------------------------------------------------------------ */
/* Home and Reports entry points                                       */
/* ------------------------------------------------------------------ */

function reportFixture(startDate = '2026-01-01', endDate = '2026-01-31') {
  return {
    title: 'Laporan Bulanan',
    start_date: startDate,
    end_date: endDate,
    total_income: 1_000_000,
    total_expense: 250_000,
    total_investment: 100_000,
    net: 650_000,
    average_expense: 10_000,
    investment_percentage: 10,
    top_expense_categories: [],
  };
}

function createTabsHarness({ componentPath, transactions, report, handlers = {} }) {
  const pushes = [];
  const transactionCalls = [];
  const rows = transactions || Array.from({ length: 11 }, (_, index) => transaction(index + 1));

  const transactionApi = {
    // Faithful server stub: it only ever returns the requested limit, so a
    // screen that drops `limit` renders all 11 fixture rows and fails.
    getTransactions: async (params = {}) => {
      transactionCalls.push(params);
      const limit = typeof params.limit === 'number' ? params.limit : rows.length;
      return rows.slice(0, limit);
    },
  };
  const reportApi = {
    getDailyReport: async () => report || reportFixture(),
    getWeeklyReport: async () => report || reportFixture(),
    getMonthlyReport: async () => report || reportFixture(),
  };
  const authApi = {
    getProfile: async () => ({ id: 1, first_name: 'Tester', timezone: 'Asia/Jakarta', currency: 'IDR' }),
  };
  const debtApi = {
    getSummary: async () => ({ total_debt: 0, total_receivable: 0 }),
  };
  const router = {
    push: (...args) => pushes.push(args),
    replace: () => {},
    back: () => {},
  };

  const modules = {
    'expo-router': { router, useLocalSearchParams: () => ({}) },
  };

  const fallback = [
    [/components\/ui\/Screen$/, { Screen: stub('View') }],
    [/components\/ui\/FadeIn$/, { FadeIn: stub('View') }],
    [/components\/ui\/SectionHeader$/, { SectionHeader: RealSectionHeader }],
    [/components\/ui\/Segmented$/, { Segmented: stub('View') }],
    [/components\/ui\/Progress$/, { Progress: stub('View') }],
    [/components\/ui\/Amount$/, { Amount: stub('View') }],
    [/components\/ui\/Skeleton$/, { Skeleton: stub('View'), SkeletonRows: stub('View') }],
    [/components\/ui\/EmptyState$/, { EmptyState: (props = {}) => node('EmptyState', props) }],
    [/components\/ui\/ErrorState$/, { ErrorState: stub('View') }],
    [/components\/ReportSummaryCard$/, { ReportSummaryCard: stub('View') }],
    [/components\/QuickInputBar$/, { QuickInputBar: stub('View') }],
    [/components\/DebtSummaryCard$/, { DebtSummaryCard: stub('View') }],
    [/components\/TransactionCard$/, {
      TransactionCard: (props = {}) => node('TransactionCard', {
        transaction: props.transaction,
      }),
    }],
    [/services\/reports$/, { reportApi }],
    [/services\/transactions$/, { transactionApi }],
    [/services\/auth$/, { authApi, describeApiError: () => 'Gagal memuat data.' }],
    [/services\/debts$/, { debtApi }],
  ];

  const harness = createHarness({ componentPath, modules, moduleFallback: fallback });
  return { harness, pushes, router, transactionCalls, rows };
}

function renderedTransactions(harness) {
  return harness
    .elements()
    .filter((element) => element.type === 'TransactionCard')
    .map((element) => element.props.transaction);
}

function underlineOfAction(harness, label) {
  const action = harness.byLabel(label);
  assert.ok(action, `${label} action must render`);
  const text = (action.children || []).find((child) => child && child.type === 'Text');
  assert.ok(text, `${label} action must render a text label`);
  return flattenStyle(text.props.style).textDecorationLine;
}

function pressSectionAction(harness, label) {
  const action = harness.byLabel(label);
  assert.ok(action, `${label} action must render`);
  assert.equal(typeof action.props.onPress, 'function');
  action.props.onPress();
}

test('home requests ten rows, renders ten of eleven and opens the all-date browser', async () => {
  const { harness, pushes, transactionCalls } = createTabsHarness({
    componentPath: 'app/(tabs)/index.tsx',
  });
  await harness.mount();

  assert.equal(transactionCalls.length >= 1, true);
  assert.equal(transactionCalls[0].limit, 10);
  const rows = renderedTransactions(harness);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(underlineOfAction(harness, 'Seluruh Transaksi'), 'underline');

  pressSectionAction(harness, 'Seluruh Transaksi');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0][0], '/transactions');
});

test('reports requests ten rows for the report dates and opens that scope', async () => {
  const report = reportFixture('2026-02-01', '2026-02-28');
  const { harness, pushes, transactionCalls } = createTabsHarness({
    componentPath: 'app/(tabs)/reports.tsx',
    report,
  });
  await harness.mount();

  assert.deepEqual(
    JSON.parse(JSON.stringify(transactionCalls[0])),
    { start_date: '2026-02-01', end_date: '2026-02-28', limit: 10 }
  );
  assert.equal(renderedTransactions(harness).length, 10);
  assert.equal(underlineOfAction(harness, 'Seluruh Transaksi'), 'underline');

  pressSectionAction(harness, 'Seluruh Transaksi');
  assert.equal(pushes.length, 1);
  const payload = pushes[0][0];
  assert.equal(payload.pathname, '/transactions');
  assert.equal(payload.params.start_date, '2026-02-01');
  assert.equal(payload.params.end_date, '2026-02-28');
});

/* ------------------------------------------------------------------ */
/* Browser contract                                                    */
/* ------------------------------------------------------------------ */

test('browser requests page one with the fixed twenty-row contract', async () => {
  const items = Array.from({ length: 20 }, (_, index) => transaction(index + 1));
  const { harness, calls } = await mountBrowser({
    handler: () => pageBody({ items }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].page, 1);
  assert.equal(calls[0].sort, 'date_desc');
  assert.equal('page_size' in calls[0], false);
  assert.equal('limit' in calls[0], false);
  assert.equal('offset' in calls[0], false);
  assert.ok(harness.byTestID('transaction-search'));
  assert.ok(harness.byTestID('open-filters'));
  assert.ok(harness.byTestID('open-sort'));
  assert.ok(harness.byTestID('result-range'));
  assert.ok(harness.byTestID('transaction-list'));
  assertProp('page-1', harness, 'accessibilityState', { selected: true, disabled: false });
  const rendered = renderedTransactions(harness);
  assert.equal(rendered.length, 20);
  assert.equal(rendered[0].id, 1);
  const label = harness.texts().join(' ');
  assert.match(label, /Menampilkan 1-20 dari 45 transaksi/);
});

test('pagination child page selection fetches that page', async () => {
  const { harness, calls } = await mountBrowser({
    handler: (params) => pageBody({
      page: params.page,
      total: 45,
      total_pages: 3,
      items: [transaction(params.page * 100)],
    }),
  });
  await harness.pressTestID('page-next');
  assert.equal(calls.at(-1).page, 2);
  assertProp('page-2', harness, 'accessibilityState', { selected: true, disabled: false });
  assert.equal(renderedTransactions(harness)[0].id, 200);

  await harness.pressTestID('page-prev');
  assert.equal(calls.at(-1).page, 1);

  await harness.pressTestID('page-3');
  assert.equal(calls.at(-1).page, 3);
  assertProp('page-next', harness, 'disabled', true);
});

test('sort change resets to page one', async () => {
  const { harness, calls } = await mountBrowser({
    handler: (params) => pageBody({ page: params.page, total: 45, total_pages: 3 }),
  });
  await harness.pressTestID('page-next');
  assert.equal(calls.at(-1).page, 2);

  await harness.pressTestID('open-sort');
  assert.ok(harness.byTestID('sort-amount_desc'));
  await harness.pressTestID('sort-amount_desc');
  assert.equal(calls.at(-1).page, 1);
  assert.equal(calls.at(-1).sort, 'amount_desc');
  assertProp('page-1', harness, 'accessibilityState', { selected: true, disabled: false });
});

test('applying a filter resets to page one with the new scope', async () => {
  const { harness, calls } = await mountBrowser({
    handler: (params) => pageBody({ page: params.page, total: 45, total_pages: 3 }),
  });
  await harness.pressTestID('page-next');
  assert.equal(calls.at(-1).page, 2);

  await harness.pressTestID('open-filters');
  await harness.pressTestID('test-apply-filter');
  assert.equal(calls.at(-1).page, 1);
  assert.equal(calls.at(-1).q, 'kopi');
  assert.equal(calls.at(-1).start_date, '2026-01-01');
  assert.equal(calls.at(-1).end_date, '2026-01-31');
  assert.ok(harness.byTestID('reset-filters'));
});

test('filtered reset-filters clears the query and returns to page one', async () => {
  const { harness, calls } = await mountBrowser({
    handler: (params) => pageBody({ page: params.page, total: 45, total_pages: 3 }),
  });
  const initial = calls.length;

  harness.changeTestID('transaction-search', 'kopi');
  await sleep(350);
  harness.flush();
  await harness.settle();
  assert.equal(calls.at(-1).q, 'kopi');
  assert.equal(calls.at(-1).page, 1);
  assert.ok(harness.byTestID('reset-filters'), 'active filters expose the reset action');

  await harness.pressTestID('reset-filters');
  assert.equal(calls.at(-1).page, 1);
  assert.equal('q' in calls.at(-1), false);
  assert.ok(calls.length > initial);
  assert.equal(harness.byTestID('reset-filters'), undefined);
});

test('newer search results cannot be overwritten by a slow older request', async () => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  const { harness } = await mountBrowser({
    handler: () => {
      count += 1;
      return count === 1 ? first.promise : second.promise;
    },
  });

  harness.changeTestID('transaction-search', 'kopi');
  await sleep(350);
  harness.flush();
  await sleep(10);
  assert.equal(count, 2, 'debounced search must issue a newer request');

  second.resolve(pageBody({ total: 2, total_pages: 1 }));
  await harness.settle();
  assert.match(harness.texts().join(' '), /2 transaksi/);

  first.resolve(pageBody({ total: 45, total_pages: 3 }));
  await harness.settle();
  assert.doesNotMatch(harness.texts().join(' '), /45 transaksi/);
});

test('detail return refetches and retains query and page', async () => {
  const { harness, calls } = await mountBrowser({
    handler: (params) => pageBody({ page: params.page, total: 45, total_pages: 3 }),
  });

  harness.changeTestID('transaction-search', 'kopi');
  await sleep(350);
  harness.flush();
  await harness.settle();
  await harness.pressTestID('page-next');
  const before = calls.length;
  const lastParams = { ...calls.at(-1) };
  assert.equal(lastParams.page, 2);
  assert.equal(lastParams.q, 'kopi');

  await harness.focus();
  assert.ok(calls.length > before, 'returning from detail must refetch');
  // The query object is built inside the VM by the real helper, so compare its
  // serialized shape rather than its cross-realm prototype.
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(lastParams));
});

test('repeated next taps dedupe while a page request is in flight', async () => {
  const pending = deferred();
  let count = 0;
  const { harness, calls } = await mountBrowser({
    handler: () => {
      count += 1;
      if (count === 1) return pageBody();
      return pending.promise;
    },
  });
  const before = calls.length;
  const next = harness.byTestID('page-next');
  assert.ok(next);
  next.props.onPress();
  next.props.onPress();
  assert.equal(calls.length, before + 1, 'second tap while loading must be ignored');

  pending.resolve(pageBody({ page: 2, total: 45, total_pages: 3 }));
  await harness.settle();
  assert.equal(calls.at(-1).page, 2);
});

test('empty result keeps the honest zero label, empty state and no pager', async () => {
  const { harness } = await mountBrowser({
    handler: () => pageBody({ total: 0, total_pages: 0, page: 1 }),
  });
  assert.match(harness.texts().join(' '), /Menampilkan 0 dari 0 transaksi/);
  assert.equal(renderedTransactions(harness).length, 0);
  assert.ok(harness.byType('EmptyState'), 'the empty state must render');
  assert.equal(harness.byTestID('page-prev'), undefined);
  assert.equal(harness.byTestID('page-next'), undefined);
});