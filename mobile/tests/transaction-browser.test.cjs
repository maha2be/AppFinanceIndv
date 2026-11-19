/** Dependency-free tests for the transaction browser rules. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');

function load(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require: (name) => {
      if (stubs[name]) return stubs[name];
      throw new Error(`unexpected require: ${name}`);
    },
  };
  vm.runInNewContext(javascript, sandbox);
  return sandbox.exports;
}

const transactions = load('utils/transactions.ts');
const browser = load('utils/transactionBrowser.ts', { './transactions': transactions });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('page strip matches the required 99-page examples', () => {
  assert.deepEqual(plain(browser.buildPageTokens(1, 99)), [1, 2, 3, 'ellipsis-right', 99]);
  assert.deepEqual(plain(browser.buildPageTokens(5, 99)), [
    1, 'ellipsis-left', 4, 5, 6, 'ellipsis-right', 99,
  ]);
  assert.deepEqual(plain(browser.buildPageTokens(99, 99)), [1, 'ellipsis-left', 97, 98, 99]);
});

test('page strip fills a single missing page and stays valid at boundaries', () => {
  assert.deepEqual(plain(browser.buildPageTokens(4, 9)), [1, 2, 3, 4, 5, 'ellipsis-right', 9]);
  assert.deepEqual(plain(browser.buildPageTokens(2, 12)), [1, 2, 3, 'ellipsis-right', 12]);
  assert.deepEqual(plain(browser.buildPageTokens(11, 12)), [1, 'ellipsis-left', 10, 11, 12]);
});

test('page strip shows every page when there are few and nothing when empty', () => {
  assert.deepEqual(plain(browser.buildPageTokens(3, 7)), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(plain(browser.buildPageTokens(1, 1)), [1]);
  assert.deepEqual(plain(browser.buildPageTokens(1, 0)), []);
  assert.deepEqual(plain(browser.buildPageTokens(4, 3)), [1, 2, 3]);
});

test('page jump accepts only digits inside the range', () => {
  assert.equal(browser.parsePageJump('12', 99), 12);
  assert.equal(browser.parsePageJump(' 1 ', 99), 1);
  assert.equal(browser.parsePageJump('99', 99), 99);
  for (const invalid of ['', '0', '-3', '1.5', '2e3', 'abc', '1 2', '100']) {
    assert.equal(browser.parsePageJump(invalid, 99), null, invalid);
  }
  assert.equal(browser.parsePageJump('2', 0), null);
});

test('filter draft validation reports each unusable field', () => {
  const valid = { ...browser.EMPTY_FILTER_DRAFT, q: 'kopi', minAmount: '1.000', maxAmount: '5000' };
  assert.deepEqual(plain(browser.validateFilterDraft(valid)), {});

  const invalid = browser.validateFilterDraft({
    ...browser.EMPTY_FILTER_DRAFT,
    startDate: '2026-03-01',
    endDate: '2026-02-01',
    minAmount: '9000',
    maxAmount: '10',
  });
  assert.equal(invalid.endDate, 'Tanggal akhir tidak boleh sebelum tanggal awal.');
  assert.equal(invalid.maxAmount, 'Nominal maksimum tidak boleh kurang dari minimum.');

  const brokenDate = browser.validateFilterDraft({
    ...browser.EMPTY_FILTER_DRAFT,
    startDate: '2026-02-30',
  });
  assert.ok(brokenDate.startDate);
});

test('filter draft rejects non-positive amounts and overlong search', () => {
  const invalid = browser.validateFilterDraft({
    ...browser.EMPTY_FILTER_DRAFT,
    q: 'x'.repeat(201),
    minAmount: '0',
    maxAmount: 'abc',
    categoryId: 0,
  });
  assert.ok(invalid.q);
  assert.ok(invalid.minAmount);
  assert.ok(invalid.maxAmount);
  assert.ok(invalid.categoryId);
});

test('applied filters drop blanks and round-trip through the draft', () => {
  const draft = {
    q: '  bensin  ',
    startDate: '2026-05-01',
    endDate: '',
    type: 'expense',
    categoryId: 4,
    minAmount: '2.500',
    maxAmount: '',
  };
  const filters = browser.draftToFilters(draft);
  assert.deepEqual(plain(filters), {
    q: 'bensin',
    start_date: '2026-05-01',
    type: 'expense',
    category_id: 4,
    min_amount: 2500,
  });
  assert.deepEqual(plain(browser.filtersToDraft(filters)), {
    q: 'bensin',
    startDate: '2026-05-01',
    endDate: '',
    type: 'expense',
    categoryId: 4,
    minAmount: '2500',
    maxAmount: '',
  });
  assert.equal(browser.hasActiveFilters(filters), true);
  assert.equal(browser.hasActiveFilters({}), false);
  assert.equal(browser.hasActiveFilters({ q: '   ' }), false);
});

test('page query always carries sort and page, even with no filters', () => {
  assert.deepEqual(plain(browser.buildTransactionPageQuery({}, 'date_desc', 1)), {
    sort: 'date_desc',
    page: 1,
  });
});

test('result range describes the visible rows and empty results', () => {
  assert.deepEqual(plain(browser.describeResultRange(1, 20, 1980)), { from: 1, to: 20 });
  assert.deepEqual(plain(browser.describeResultRange(2, 20, 1980)), { from: 21, to: 40 });
  assert.deepEqual(plain(browser.describeResultRange(99, 20, 1980)), { from: 1961, to: 1980 });
  assert.deepEqual(plain(browser.describeResultRange(1, 20, 0)), { from: 0, to: 0 });
});
