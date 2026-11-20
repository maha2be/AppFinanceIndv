/**
 * Runtime regressions for asset_name rendering in TransactionCard and QuickInputBar.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

test('TransactionCard renders asset_name (e.g. XRP) alongside category and note without duplication', async () => {
  const renderCard = async (transaction) => {
    const harness = createHarness({
      componentPath: 'components/TransactionCard.tsx',
      exportName: 'TransactionCard',
      props: { transaction, onPress: () => {} },
      modules: {
        '../components/ui/Amount': { Amount: (props) => node('Amount', props) },
        './ui/Amount': { Amount: (props) => node('Amount', props) },
      },
    });
    await harness.mount();
    return harness;
  };

  const xrpOnly = await renderCard({
    id: 1,
    user_id: 1,
    type: 'investment',
    category_id: 10,
    category_name: 'Crypto',
    amount: 150000,
    note: null,
    asset_name: 'XRP',
    transaction_date: '2026-11-20',
  });
  assert.ok(xrpOnly.texts().includes('Crypto'));
  assert.ok(xrpOnly.texts().includes('XRP'));

  const xrpWithNote = await renderCard({
    id: 2,
    user_id: 1,
    type: 'investment',
    category_id: 10,
    category_name: 'Crypto',
    amount: 150000,
    note: 'dca mingguan',
    asset_name: 'XRP',
    transaction_date: '2026-11-20',
  });
  assert.ok(xrpWithNote.texts().includes('XRP · dca mingguan'));

  const assetWithoutCategory = await renderCard({
    id: 3,
    user_id: 1,
    type: 'investment',
    category_id: null,
    category_name: null,
    amount: 150000,
    note: null,
    asset_name: 'XRP',
    transaction_date: '2026-11-20',
  });
  assert.equal(assetWithoutCategory.texts().filter((t) => t === 'XRP').length, 1);
});

test('QuickInputBar preview displays asset_name (XRP) before saving', async () => {
  const harness = createHarness({
    componentPath: 'components/QuickInputBar.tsx',
    exportName: 'QuickInputBar',
    props: { onSuccess: () => {} },
    modules: {
      'react-native': { TextInput: 'TextInput' },
      '../services/transactions': {
        transactionApi: {
          previewQuickInput: async () => ({
            is_valid: true,
            type: 'investment',
            type_label: 'Investasi',
            category_name: 'Crypto',
            asset_name: 'XRP',
            note: '',
            amount: 50000,
          }),
          confirmQuickInput: async () => ({}),
        },
      },
      '../services/auth': { describeApiError: (_e, fallback) => fallback },
    },
  });
  await harness.mount();

  harness.change('Input cepat transaksi', 'crypto xrp 50000');
  await harness.settle();

  assert.ok(harness.texts().includes('Crypto'));
  assert.ok(harness.texts().includes('XRP'));
});
