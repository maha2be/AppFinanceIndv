/**
 * Boundary tests for the account deletion proof selector.
 *
 * Legacy profile responses omit `has_password` and `google_linked`. Those
 * profiles must fall back to password proof: only an explicit
 * `has_password: false` plus `google_linked: true` may use Google.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadDeletionHelper() {
  const file = path.join(__dirname, '..', 'utils/accountDeletion.ts');
  const source = fs.readFileSync(file, 'utf8');
  const sandbox = { exports: {}, module: { exports: {} }, console };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.require = (name) => {
    throw new Error(`Unexpected module in account deletion helper: ${name}`);
  };
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false },
  }).outputText;
  vm.runInNewContext(javascript, sandbox, { filename: file });
  return Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.exports;
}

const { getAccountDeletionMethod } = loadDeletionHelper();

test('password-only profiles use password proof', () => {
  assert.equal(
    getAccountDeletionMethod({ has_password: true, google_linked: false }),
    'password',
  );
});

test('password profiles with a linked Google account still use password proof', () => {
  assert.equal(
    getAccountDeletionMethod({ has_password: true, google_linked: true }),
    'password',
    'a linked Google account is not the sole sign-in method',
  );
});

test('only explicit no-password plus linked Google selects Google proof', () => {
  assert.equal(
    getAccountDeletionMethod({ has_password: false, google_linked: true }),
    'google',
  );
  assert.equal(
    getAccountDeletionMethod({ has_password: false, google_linked: false }),
    'password',
    'no password capability without a Google link must not use Google',
  );
});

test('legacy profiles without capability flags default to password proof', () => {
  for (const user of [
    {},
    { has_password: undefined, google_linked: true },
    { has_password: null, google_linked: true },
    { has_password: undefined, google_linked: undefined },
    { google_linked: true },
  ]) {
    assert.equal(
      getAccountDeletionMethod(user),
      'password',
      `legacy profile ${JSON.stringify(user)} must not require Google`,
    );
  }
});

test('missing Google link never selects Google even with an explicit no-password flag', () => {
  for (const googleLinked of [undefined, null, false]) {
    assert.equal(
      getAccountDeletionMethod({ has_password: false, google_linked: googleLinked }),
      'password',
      `google_linked=${String(googleLinked)} must fall back to password`,
    );
  }
});