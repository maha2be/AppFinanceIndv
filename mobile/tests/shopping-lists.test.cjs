/**
 * Unit and screen regressions for the Shopping Lists feature ("Daftar belanja").
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot, tokenProxy } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

const shoppingMath = loadTsModule(
  path.join(mobileRoot, 'utils/shoppingLists.ts'),
  (name) => {
    throw new Error(`Unexpected import in shoppingLists.ts: ${name}`);
  }
);

test('groupShoppingItems preserves group order, computes subtotals, and counts checked items', () => {
  const groups = shoppingMath.groupShoppingItems([
    { id: 1, list_id: 1, user_id: 1, group_name: 'Kebutuhan Dapur', name: 'Beras 10 kg', price: 120_000, is_checked: true, transaction_id: null, position: 0 },
    { id: 2, list_id: 1, user_id: 1, group_name: 'Kebutuhan Rumah', name: 'Detergen', price: 15_000, is_checked: false, transaction_id: null, position: 1 },
    { id: 3, list_id: 1, user_id: 1, group_name: 'Kebutuhan Dapur', name: 'Gula Pasir', price: 27_000, is_checked: false, transaction_id: null, position: 2 },
    { id: 4, list_id: 1, user_id: 1, group_name: 'Kebutuhan Ibu', name: 'Moisturizer', price: null, is_checked: false, transaction_id: null, position: 3 },
  ]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(groups.map((g) => ({ name: g.groupName, subtotal: g.subtotal, checked: g.checkedCount, count: g.items.length })))),
    [
      { name: 'Kebutuhan Dapur', subtotal: 147_000, checked: 1, count: 2 },
      { name: 'Kebutuhan Rumah', subtotal: 15_000, checked: 0, count: 1 },
      { name: 'Kebutuhan Ibu', subtotal: 0, checked: 0, count: 1 },
    ]
  );
});

test('computeBudgetProgress detects remaining and over-budget states accurately', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(shoppingMath.computeBudgetProgress(486_000, 500_000))), {
    hasBudget: true,
    percent: 97,
    overBudget: false,
    difference: 14_000,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(shoppingMath.computeBudgetProgress(550_000, 500_000))), {
    hasBudget: true,
    percent: 100,
    overBudget: true,
    difference: 50_000,
  });
  assert.equal(shoppingMath.parseOptionalAmountInput('Rp 120.000'), 120_000);
  assert.equal(shoppingMath.parseOptionalAmountInput(''), null);
});

test('ShoppingListsScreen lists plans, duplicates a list, and creates a new list', async () => {
  const pushes = [];
  const calls = { create: [], duplicate: [] };
  const sampleLists = [
    {
      id: 10,
      user_id: 1,
      title: 'List Belanja Februari',
      budget_amount: 500_000,
      notes: 'Budget 500k di luar beras',
      item_count: 12,
      checked_count: 5,
      planned_total: 486_000,
      checked_total: 200_000,
      unrecorded_checked_total: 200_000,
      recorded_total: 0,
    },
  ];

  const harness = createHarness({
    componentPath: 'app/shopping-lists.tsx',
    modules: {
      'expo-router': {
        router: { push: (r) => pushes.push(r), back: () => {}, replace: () => {} },
        useFocusEffect: (cb) => harness.React.useEffect(() => cb(), [cb]),
      },
      'react-native': { ScrollView: stub('ScrollView') },
      '../services/appAlert': { AppAlert: { alert() {} } },
      '../services/auth': { describeApiError: (_e, f) => f },
      '../services/shoppingLists': {
        shoppingListApi: {
          list: async () => sampleLists,
          create: async (payload) => {
            calls.create.push(payload);
            return { ...sampleLists[0], id: 20, title: payload.title, items: [] };
          },
          duplicate: async (id) => {
            calls.duplicate.push(id);
            return { ...sampleLists[0], id: 21, title: 'List Belanja Februari (Salinan)', items: [] };
          },
        },
      },
      '../components/ui/Screen': { Screen: (props) => node('Screen', { ...props, children: [props.children, props.footer].flat() }) },
      '../components/ui/FadeIn': { FadeIn: stub('FadeIn') },
      '../components/ui/Card': { Card: stub('Card') },
      '../components/ui/Progress': { Progress: stub('Progress') },
      '../components/ui/Sheet': {
        Sheet: (props) => (props.visible ? node('Sheet', { ...props, children: [props.children, props.footer].flat() }) : null),
      },
      '../components/ui/EmptyState': { EmptyState: stub('View') },
    },
  });

  await harness.mount();
  assert.ok(harness.texts().includes('List Belanja Februari'));
  assert.ok(harness.textMatching(/5\/12 item dibeli/));

  await harness.press('Salin List Belanja Februari');
  assert.deepEqual(calls.duplicate, [10]);
  assert.deepEqual(pushes, ['/shopping-list/21']);

  await harness.press('Buat daftar belanja');
  harness.change('Judul daftar belanja', 'Belanja Maret');
  harness.change('Target budget', '600000');
  await harness.press('Buat daftar');

  assert.deepEqual(JSON.parse(JSON.stringify(calls.create)), [
    { title: 'Belanja Maret', budget_amount: 600_000, notes: null },
  ]);
  assert.deepEqual(pushes, ['/shopping-list/21', '/shopping-list/20']);
});

test('ShoppingListDetailScreen toggles items, adds an item, and records checked items into expenses', async () => {
  const calls = { toggles: [], added: [], recorded: [], alerts: [] };
  let currentDetail = {
    id: 10,
    user_id: 1,
    title: 'List Belanja Februari',
    budget_amount: 500_000,
    notes: 'Masih ada: deodorant',
    item_count: 2,
    checked_count: 1,
    planned_total: 151_500,
    checked_total: 120_000,
    unrecorded_checked_total: 120_000,
    recorded_total: 0,
    items: [
      { id: 1, list_id: 10, user_id: 1, group_name: 'Kebutuhan Dapur', name: 'Beras 10 kg', price: 120_000, is_checked: true, transaction_id: null, position: 0 },
      { id: 2, list_id: 10, user_id: 1, group_name: 'Kebutuhan Ibu', name: 'Moisturizer', price: null, is_checked: false, transaction_id: null, position: 1 },
    ],
  };

  const harness = createHarness({
    componentPath: 'app/shopping-list/[id].tsx',
    modules: {
      'expo-router': {
        router: { push: () => {}, back: () => {}, replace: () => {} },
        useLocalSearchParams: () => ({ id: '10' }),
        useFocusEffect: (cb) => harness.React.useEffect(() => cb(), [cb]),
      },
      'react-native': { ScrollView: stub('ScrollView') },
      '../../utils/theme': { Colors: tokenProxy(), Fonts: tokenProxy(), Radius: tokenProxy(), Space: tokenProxy(), Type: tokenProxy() },
      '../../services/appAlert': {
        AppAlert: {
          alert: (title, message, buttons) => calls.alerts.push({ title, message, buttons }),
        },
      },
      '../../services/auth': { describeApiError: (_e, f) => f },
      '../../services/shoppingLists': {
        shoppingListApi: {
          get: async () => currentDetail,
          updateItem: async (_listId, itemId, payload) => {
            calls.toggles.push({ itemId, payload });
            currentDetail = {
              ...currentDetail,
              items: currentDetail.items.map((it) => (it.id === itemId ? { ...it, ...payload } : it)),
            };
            return currentDetail.items.find((it) => it.id === itemId);
          },
          addItem: async (_listId, payload) => {
            calls.added.push(payload);
            const next = { id: 3, list_id: 10, user_id: 1, transaction_id: null, position: 2, is_checked: false, ...payload };
            currentDetail = { ...currentDetail, items: [...currentDetail.items, next] };
            return next;
          },
          recordExpense: async (listId, date) => {
            calls.recorded.push({ listId, date });
            currentDetail = {
              ...currentDetail,
              unrecorded_checked_total: 0,
              recorded_total: 120_000,
              items: currentDetail.items.map((it) => (it.id === 1 ? { ...it, transaction_id: 99 } : it)),
            };
            return {
              transaction: { id: 99, amount: 120_000 },
              shopping_list: currentDetail,
            };
          },
        },
      },
      '../../components/ui/Screen': { Screen: (props) => node('Screen', { ...props, children: [props.children, props.footer].flat() }) },
      '../../components/ui/Input': { Input: stub('Input') },
      '../../components/ui/Button': {
        Button: (props) => node('Pressable', {
          ...props,
          accessibilityRole: 'button',
          accessibilityLabel: props.title,
          disabled: Boolean(props.disabled || props.loading),
        }),
      },
      '../../components/ui/FadeIn': { FadeIn: stub('FadeIn') },
      '../../components/ui/ErrorState': { ErrorState: stub('ErrorState') },
      '../../components/ui/Card': { Card: stub('Card') },
      '../../components/ui/Chip': { Chip: stub('Chip') },
      '../../components/ui/Progress': { Progress: stub('Progress') },
      '../../components/ui/Sheet': {
        Sheet: (props) => (props.visible ? node('Sheet', { ...props, children: [props.children, props.footer].flat() }) : null),
      },
      '../../components/ui/EmptyState': { EmptyState: stub('View') },
      '../../components/ui/Skeleton': { SkeletonRows: stub('View') },
    },
  });

  await harness.mount();
  assert.ok(harness.texts().includes('Kebutuhan Dapur'));
  assert.ok(harness.texts().includes('Beras 10 kg'));
  assert.ok(harness.texts().includes('Rp -'));

  // Toggle Moisturizer checked
  await harness.press('Centang Moisturizer');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.toggles)), [{ itemId: 2, payload: { is_checked: true } }]);

  // Add a new item
  await harness.press('Tambah item');
  harness.change('Nama item belanja', 'Detergen');
  harness.change('Harga item belanja', '15000');
  await harness.press('Simpan');
  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].name, 'Detergen');
  assert.equal(calls.added[0].price, 15_000);

  // Convert checked items to expense
  const cta = harness.elements().find((el) => el.type === 'Pressable' && String(el.props.accessibilityLabel || '').startsWith('Catat ke pengeluaran'));
  assert.ok(cta);
  await cta.props.onPress();
  const confirmBtn = calls.alerts.at(-1).buttons.find((b) => b.text === 'Catat sekarang');
  await confirmBtn.onPress();
  await harness.settle();

  assert.equal(calls.recorded.length, 1);
  assert.ok(harness.texts().includes('Tercatat'));
});
