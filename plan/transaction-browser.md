# Implementation Plan: Transaction Browser

## Objective

Keep Home and Reports readable with at most 10 transaction rows each. Add an
underlined `Seluruh Transaksi` action opening a dedicated searchable, filterable,
sortable transaction browser with 20 rows per page and numbered navigation.

This is one coupled backend/mobile workstream. Implement in a separate builder
session. This planning task does not authorize a push, deployment, or APK build.

## Scope

- Home: retain the existing latest-10 query and add the underlined action.
- Reports: reduce the transaction preview from 50 to 10 without truncating report
  totals or category breakdowns. Open the browser with the selected report dates.
- Browser: search notes, category names, and asset names; filter by inclusive date
  range, transaction type, category, and minimum/maximum amount. Sort by transaction
  date or amount, ascending or descending. Default: newest transaction date first.
- Fetch and display only one 20-row page. Provide first/last/current-neighbor
  page buttons, previous/next, and an ellipsis-triggered numeric jump popup.
- Preserve transaction detail/edit/delete behavior, debt-derived read-only rows,
  and access to `Riwayat perubahan`. Audit history is not the transaction browser.
- No schema migration, new dependency, financial calculation change, wallet
  feature, export, infinite scroll, or full-dataset client-side search.

## Context

### Stack and conventions

- Mobile: Expo 58, React Native 0.88.1, React 19.3, TypeScript, Expo Router,
  Axios, Yarn 1.22.22. Tests use Node's test runner and TypeScript transpilation.
- Backend: FastAPI/Pydantic with shared `finance_core` repositories, parameterized
  SQL, SQLite and a PostgreSQL compatibility adapter. Repositories do not commit.
- Follow `PRODUCT.md`, `DESIGN.md`, `docs/architecture.md`, and
  `docs/transaction-history.md`. The user explicitly approved these existing
  references plus their request instead of creating a separate API/UX spec first.
- Repository prose, comments, and test names are English. User-facing app copy
  remains Indonesian. Use existing warm-paper ledger tokens, hairline row rules,
  readable rupiah values, and Ionicons. No decorative card-stack redesign.
- Existing `Sheet` owns modal keyboard avoidance and app-lock coverage. Reuse it
  for filters, sorting, and page jumps. Do not introduce an uncovered native Modal
  or nested keyboard-avoidance wrappers.
- Targets are at least 44 by 44 pixels with 8-pixel gaps. Current page uses bold
  text plus a visible highlight and selected accessibility state, not color alone.

### Verified code evidence

| Area | Evidence at planning baseline |
|------|-------------------------------|
| Home preview | `mobile/app/(tabs)/index.tsx:41-48` already requests `limit: 10`; `:147-173` renders rows and links only to audit history |
| Reports preview | `mobile/app/(tabs)/reports.tsx:45-77` resolves report dates then requests `limit: 50`; `:140-164` displays loaded count as if it were the whole list |
| Mobile API | `mobile/services/transactions.ts:10-20` expects an array and supports dates/type/limit/offset only |
| Existing backend list | `backend/app/routes/transactions.py:169-190` returns an array, default 50, maximum 200 |
| Route ordering | Static `/history` precedes `/{transaction_id}` at `backend/app/routes/transactions.py:193-211`; the new static route must also precede the dynamic route |
| Repository | `finance_core/db/transactions.py:143-174` scopes to owner and orders by date descending, ID descending |
| Report independence | `finance_core/db/transactions.py:211-228` provides unbounded date-range rows for aggregation; leave this path unchanged |
| Shared modal | `mobile/components/ui/Sheet.tsx:33-122` already handles keyboard, Android dismissal, and lock coverage |
| Shared header | `mobile/components/ui/SectionHeader.tsx:5-28` supports one action but has no underline opt-in |

No `graphify-out/` exists in the inspected checkout. No extraction was performed
or authorized. Evidence above comes from direct source reads; do not claim graph
query/path/explain evidence. Ask before creating a graph if later needed.

### Alternatives and decision

1. **Selected: additive server-side page endpoint.** Exact filtered totals allow
   last-page buttons and direct page jumps. Existing installed APKs retain their
   array response. Small explicit SQL helpers avoid a pagination dependency.
2. **Rejected: download all rows and paginate locally.** Growing payloads and
   memory use defeat the requirement; searching only a capped subset is incorrect.
3. **Rejected: replace the existing array with an envelope.** Breaks installed
   APKs and existing callers. An opt-in envelope on the same URL adds unnecessary
   response-shape branching.
4. **Rejected: cursor/infinite-scroll pagination.** Good sequential browsing,
   but incompatible with arbitrary numbered page jumps and a visible last page.

Public API addition receives a high-impact verification check. The advisory
`verify` attempt failed with HTTP 404; no tier or `proceed`/`spec_fit`/`needs_human`
scores were returned. Manual assessment: medium implementation risk, additive
and reversible, no authentication or data-model change. Proceed with ownership,
compatibility, SQL safety, and cross-database regression gates described below.

## Dependencies

- Main at analysis time: `d2e0f65`. Required feature baseline:
  `feature/apk-device-fixes`, HEAD `a24489b`, six commits ahead of main. This
  baseline includes transaction detail/history, app lock, and deployment guards.
- Existing `.easignore` modification in the original checkout is unrelated and
  unreviewed. Leave it untouched and unstaged.
- Require no package/lockfile changes. Existing `mobile/node_modules` and root
  `.venv` can supply tooling without changing tracked dependency files.
- A new APK cannot use the browser API until its backend is deployed. Older APKs
  must continue working before and after deployment. No native compilation on
  the VPS; later APK builds belong on EAS.

## Files / Areas Likely Affected

| Path | Responsibility / owner |
|------|-------------------------|
| `finance_core/db/transactions.py` | Shared filter predicates, allowlisted ordering, count and page reads / builder |
| `backend/app/routes/transactions.py` | Additive authenticated page route / builder |
| `backend/app/models/schemas.py` | Page envelope response / builder |
| `tests/test_transactions_repository.py` | Repository filtering/count/order tests / builder |
| `backend/tests/test_api_transaction_browser.py` (new) | API contract and isolation / tester |
| `tests/test_postgres_portability.py` | New-query parity on isolated PostgreSQL / tester |
| `mobile/types/index.ts`, `mobile/services/transactions.ts` | Shared browser types and API method / builder |
| `mobile/utils/transactionBrowser.ts` (new) | Pure query validation, page-token and jump helpers / builder |
| `mobile/tests/transaction-browser.test.cjs` (new) | Pure helper and service contract tests / builder |
| `mobile/components/transactions/TransactionPagination.tsx` (new) | Accessible numbered controls and jump Sheet / designer |
| `mobile/components/transactions/TransactionFilters.tsx` (new) | Draft filter/sort Sheet, validation / designer |
| `mobile/app/transactions.tsx` (new) | Browser screen, lifecycle and query state / designer |
| `mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/reports.tsx` | Preview limits and navigation / designer |
| `mobile/app/_layout.tsx`, `mobile/components/ui/SectionHeader.tsx` | Route registration and opt-in underlined action / designer |
| `mobile/tests/transaction-browser-screen.test.cjs` (new) | Screen, popup, races, preview interactions / tester |
| `docs/transaction-history.md` | Brief distinction and browser API/acceptance documentation / builder |

## Implementation Steps

Use test-first changes, verify each step, and commit coherent checkpoints. Owners
and exact parallel boundaries are fixed in Delegation Strategy below.

### Step 1: Prepare the feature baseline and contracts

- [ ] **Owner: builder, inline.** Inspect status and prerequisite ancestry. Create
  `feature/transaction-browser` from `feature/apk-device-fixes` in its own worktree.
  Copy this committed plan from main into that branch and commit only the plan.
  Do not merge the prerequisite branch into main or disturb its working checkout.
- [ ] Record existing transaction and mobile test results before changing code.
  Confirm the old list still returns an array and reports still aggregate all
  rows. Read `mobile/tests/support/screen-harness.cjs` before extending tests.
- [ ] Freeze the following API/types before dispatching UI and API tests:
  `TransactionSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'`;
  `TransactionBrowserFilters` has optional `q`, `start_date`, `end_date`, `type`,
  `category_id`, `min_amount`, `max_amount`;
  `TransactionPage` has `items: Transaction[]`, `total: number`, `page: number`,
  `page_size: 20`, `total_pages: number`;
  `transactionApi.getTransactionPage(params)` accepts those filters plus `sort`
  and `page`, returning `Promise<TransactionPage>`. Keep `getTransactions` intact.

### Step 2: Implement owner-scoped server pagination

- [ ] **Owner: builder, inline.** Add `GET /api/transactions/page` before the
  dynamic transaction route. Keep all existing endpoints and response shapes.
  Use the existing auth and request-scoped DB dependencies.
- [ ] Page query: integer `page >= 1`, maximum 2,147,483,647, default 1. Fixed
  `page_size=20`, not a client-controlled limit. Optional text `q`, maximum 200
  characters, trim whitespace; empty text means no search. Type is strictly one
  of `income`, `expense`, `investment`. Category ID is positive. Dates must parse
  as ISO calendar dates with start <= end. Amount bounds are positive integer
  rupiah, at most 9,007,199,254,740,991, with minimum <= maximum. Invalid input
  returns 422. Defaults: no filters, `sort=date_desc`.
- [ ] Extend existing list repository with optional browser-only keyword filters
  and sort defaults, preserving its existing signature behavior and unlimited
  report/bot reads. Factor a private WHERE builder reused by page COUNT and rows.
  Add `count_transactions` and `list_transactions_page` repository helpers.
  The latter returns items, total, effective page, and total_pages for the route.
- [ ] Always apply `t.user_id = authenticated_user.id` to both rows and count.
  Group text OR clauses in parentheses. Search is case-insensitive substring
  matching over coalesced note, category name, asset name using `LOWER` and bound
  `LIKE` patterns. Escape `!`, `%`, `_` with `ESCAPE '!'`; they are literal user
  text, never wildcards. Do not search internal source keys. Do not promise full
  Unicode case folding beyond the database LOWER behavior.
- [ ] Use bound values for all filters. Category ID never bypasses owner scope;
  a foreign/missing category produces zero results, never another user's rows or
  category metadata. Apply combined filters with AND. Category and type mismatch
  also yields zero rows.
- [ ] ORDER BY comes only from a fixed map: date_desc=(date DESC,id DESC),
  date_asc=(date ASC,id ASC), amount_desc=(amount DESC,date DESC,id DESC),
  amount_asc=(amount ASC,date DESC,id DESC). Never interpolate user SQL.
- [ ] Count filtered results, compute ceil(total/20), clamp an excessive page to
  the final existing page, then SELECT at most 20 using LIMIT/OFFSET. With zero
  matches return items=[], total=0, page=1, page_size=20, total_pages=0.
  Count and list are live reads, not an immutable multi-page snapshot. If a
  concurrent deletion empties an otherwise nonempty requested page, recount and
  refetch once, then return the new effective page. No retry loop or write locks.
- [ ] Add failing then passing repository tests for limits, empty/clamped pages,
  owner isolation, combined filters, escaped text and all stable orderings.

### Step 3: Add mobile types and pure pagination rules

- [ ] **Owner: builder, inline.** Implement Step 1 types and Axios API method.
  Query serialization omits undefined and blank filters. Do not fetch all pages.
- [ ] Add pure helpers in `mobile/utils/transactionBrowser.ts`:
  `buildPageTokens(currentPage, totalPages)` returns ordered number or
  `'ellipsis-left'`/`'ellipsis-right'` tokens;
  `parsePageJump(text, totalPages)` returns a valid integer or null;
  `validateBrowserFilters(filters)` returns field-specific validation errors.
  Reuse existing strict ISO-date and rupiah parsing utilities where applicable.
- [ ] If totalPages <= 7, show every page. Otherwise select unique sorted pages
  {1,last,current-1,current,current+1}, bounded to valid pages. At current <= 2
  include 3; at current >= last-1 include last-2. Between selected pages, include
  the missing number when exactly one is absent, otherwise an ellipsis token.
  Hide previous at page 1 and next at the last page. With zero pages hide the
  pager; with one page a selected `1` is sufficient.
- [ ] Required examples for 99 pages: page 1 yields `1 2 3 ... 99 >`;
  page 5 yields `< 1 ... 4 5 6 ... 99 >`;
  page 99 yields `< 1 ... 97 98 99`. Bold/highlight only the current number.
- [ ] Jump accepts trimmed ASCII digits only and a safe integer in [1,totalPages].
  Reject empty, zero, negative, decimal, exponent, pasted mixed text and values
  above totalPages. Show inline `Masukkan halaman 1 sampai N.`. Same-page submit
  closes without refetch. Test both ellipsis tokens and small/near-boundary pages.

### Step 4: Build browser, controls, and previews

- [ ] **Owner: designer subagent, parallel batch A after Steps 2 and 3.** Own
  only the UI files listed above. Consume the frozen types/helpers without
  changing backend, service, helper, or test files. Give tester final control
  labels and component props before tester writes interaction assertions.
- [ ] Add `/transactions` as a stack screen, not another tab. Header: back,
  `Seluruh Transaksi`, and separate `Riwayat perubahan` link. Reuse
  `TransactionCard` with existing `/transaction/{id}` navigation.
- [ ] Layout: title; search input with clear control; Filter and Urutkan controls;
  applied filter summary including report dates; result range/count; up to 20
  ledger rows; page navigation. Use `Screen scroll={false} bottomInset` and one
  FlatList with list header/footer, avoiding a FlatList inside a ScrollView.
  Filter/sort Sheets have their own single scroll body if needed.
- [ ] Search placeholder: `Cari catatan, kategori, atau aset`. Debounce by 300 ms;
  keyboard search submits immediately. Clear invalidates outstanding requests
  immediately and resets to page 1. Filters use drafts and `Terapkan`/`Atur ulang`;
  cancelling preserves applied values. Changing type clears an incompatible
  category. Categories use existing owner-scoped categoryApi, not fixed labels.
  Failed category loading must not block browsing; show an explicit retry.
- [ ] Date filter supports all dates, incoming report dates, and editable start/
  end dates. Amount fields use rupiah numeric input and existing parsing rules.
  Sort options: `Terbaru`, `Terlama`, `Nominal terbesar`, `Nominal terkecil`.
  Applying any filter or sort resets page to 1. `Atur ulang` clears search,
  dates/type/category/amounts and restores newest-first, including report dates.
- [ ] Hold query/page state in this screen, not global storage. Opening from Home
  starts all dates; opening from Reports seeds exact returned report start/end
  dates, not device-local guesses. Use validated route parameters and ignore
  malformed external params. Back from detail retains query/page and refetches
  on focus; new browser entry starts from its own incoming scope.
- [ ] Maintain mounted/request-generation guards. Invalidate prior generations
  when search/filter/sort/page changes, not only when debounce fires. No response
  may overwrite a newer query or update an unfocused/unmounted screen. Show a
  skeleton or clear stale rows during a changed query rather than labeling old
  rows with new filters/page. Retry uses the failed query. Refresh refetches the
  current page; accept backend effective-page clamp after deletion. Successful
  page changes scroll to top. Disable duplicate page/jump submits while loading.
- [ ] Result label example: `Menampilkan 21-40 dari 1.980 transaksi` using locale
  number formatting. Empty account and no-match states differ; filtered empty
  state offers reset. Network failure never masquerades as zero transactions.
- [ ] Ellipsis opens existing `Sheet` titled `Ke halaman`, with numeric input,
  visible `1-N` bounds, cancel/close, and an Ionicons enter/return glyph button
  labelled accessibly `Ke halaman`. Keyboard submit shares the same validation.
  Open either ellipsis into the same jump flow. Do not depend on numeric keyboards
  providing an Enter key. Preserve Sheet app-lock coverage and Android back.
- [ ] Make pager fit small devices without shrinking touch targets: numbers and
  ellipses occupy a horizontally scrollable strip between previous/next controls;
  scroll the selected token into view. Use meaningful labels such as `Halaman 5`,
  `Halaman sebelumnya`, `Halaman berikutnya`, `Masukkan nomor halaman`.
- [ ] Home and Reports both expose `Seluruh Transaksi` with an actual underline.
  Add an optional `actionUnderlined` prop to SectionHeader, default false, rather
  than underlining every action in the app. Preserve audit-history access on the
  browser and existing detail/history routes. Reports requests limit10; remove
  the misleading loaded-length total or label it explicitly as a preview.
  Do not change reportApi aggregation. Fix Home's empty wording to avoid claiming
  an all-date latest list is limited to today.

### Step 5: Implement independent contract and interaction tests

- [ ] **Owner: tester subagent, parallel batch A with Step 4.** Own new browser
  screen/API tests and PostgreSQL portability additions only. Do not edit UI,
  services, helpers, schemas, or repository implementation. Use the existing Node
  screen harness; extend it only if required by list/Sheet mocks, avoiding unrelated
  behavior changes. Test real handlers, not source-text regex as primary evidence.
- [ ] API fixtures: two owners; 45 owned transactions with repeated dates/amounts;
  null category/note/asset; searchable asset/category; literal `%`, `_`, `!` text;
  another owner's transactions. Verify 20/20/5 pages, exact filtered totals,
  deterministic IDs with no overlap in an unchanged dataset, page clamp after
  deleting final rows, zero results, all sort orders, bounds and invalid input.
- [ ] Prove static `/page` is not parsed as transaction ID, unauthenticated reads
  are 401, foreign category filtering leaks no count/rows, injection-shaped query
  text is treated literally, and old list/history/detail endpoints retain shapes.
  Report totals must remain identical with more than 10 or 20 transactions.
- [ ] Mobile tests: Home/Reports max10 and underlined navigation; Reports passes
  exact dates; browser fetches page20 contract; page1/page5/page99 buttons; both
  ellipses open; jump valid/invalid/cancel/keyboard/glyph flows; current page
  highlighted; previous/next boundaries; zero/one page; draft filter cancellation;
  filter reset; detail-return refresh retaining query; error/retry; races from
  fast typing, slow old pages, blur/unmount, and repeated taps.
- [ ] Run SQL filter/order/count parity in temporary isolated PostgreSQL using the
  existing portability fixture, especially escaped LIKE patterns. Never use the
  hosted production database or private production backup as a test fixture.

### Step 6: Integrate, review, document, and verify

- [ ] **Owner: builder, inline, after batch A.** Integrate UI and tester patches,
  resolve disagreements against this contract, and run focused then full suites.
  No parallel agent self-merges. Review all changes and preserve unrelated edits.
- [ ] Document additive API parameters, fixed page size, search semantics, report
  scope, live-data pagination limits, and device acceptance in the existing
  transaction documentation. Avoid a new competing product specification.
- [ ] **Owner: reviewer, read-only subagent, after integration.** Check requirement
  fidelity, API compatibility, owner scoping in count/list/search, SQL allowlists,
  stale-response behavior, app-lock-covered Sheets and unchanged financial totals.
  Builder fixes findings inline, reruns affected tests, then requests recheck.
- [ ] Report verified automated results separately from unperformed device checks.
  Do not mark physical keyboard/visual acceptance complete from a mocked test.
  Commit feature changes on the feature branch. Do not push/deploy without a
  request. If the user later requests push, the standing release workflow also
  requires controlled backend update, backup, restart as needed and health checks.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 | builder | - | Inline: prerequisite branch and shared contract need current context |
| 2 | builder | - | Inline: coupled SQL/API change, ownership and compatibility decisions |
| 3 | builder | - | Inline: small shared contract and pure helpers unblock both workers |
| 4 | designer | A | Specialist UI work; UI-only files, consumes completed contract |
| 5 | tester | A | Independent API and screen tests; test-only files, same fixed contract |
| 6 integration/docs | builder | - | Inline: reconciliation, full verification and small documentation edit |
| 6 final review | reviewer | - | Read-only risk/spec audit after integration is green |

Batch A means dispatch Steps 4 and 5 together in one builder message. Both depend
on completed Steps 1-3. Tester may write API tests immediately and coordinate final
UI labels before completing screen tests. They must not edit the same files.
Designer cannot redesign service types; escalate mismatches to builder. If an
agent is unavailable, builder performs that ownership slice inline and records
the fallback. Any mechanical bulk change stays builder-inline in one script;
do not distribute repetitive edits to agents. Keep total workers at most 11,
and never run four heavy verification processes simultaneously.

## Acceptance Criteria

- Home and every Reports period render at most 10 transaction rows; financial
  totals and category sums still include every transaction in scope.
- Both surfaces show underlined `Seluruh Transaksi`. Home opens all-date browsing;
  Reports opens the report date range, which can be cleared explicitly.
- Search/filter/sort operate on the entire authenticated owner's matching dataset
  before pagination, not the currently downloaded page. Each page has at most20.
- Required 99-page examples match exactly; current number is bold/highlighted;
  previous/next change exactly one page; either ellipsis opens numeric direct jump
  with a visible Enter-symbol button. Invalid jump never triggers a request.
- No duplicate or missing rows across unchanged pages with tied dates/amounts;
  deleting the last page's rows clamps to a valid page on refresh. Concurrent
  writes may shift live offsets; do not advertise immutable snapshot pagination.
- Detail/edit/delete/read-only derived rows and audit history remain functional.
  No other-owner rows, counts, credentials, or internal source keys are exposed.
- Old APK list API remains array-shaped, zero-result/error states are honest,
  stale network responses cannot overwrite newer query/page state, and all popup
  interactions remain covered by existing app locking.

## Verification / Tests

Run in the feature worktree using available environments, with no production
credentials and no native compilation. Expected outcomes below are targets, not
already verified results.

1. Focused Python:
   `.venv/bin/python -m pytest tests/test_transactions_repository.py backend/tests/test_api_transaction_browser.py backend/tests/test_api_transactions.py backend/tests/test_api_transaction_history.py -q`
2. Full Python and lint:
   `.venv/bin/python -m pytest tests backend/tests -q`;
   `.venv/bin/ruff check finance_core/db/transactions.py backend/app/routes/transactions.py backend/app/models/schemas.py tests/test_transactions_repository.py backend/tests/test_api_transaction_browser.py tests/test_postgres_portability.py`.
   Reuse the original checkout's `.venv/bin` by absolute path if necessary, while
   keeping the working directory at the feature root.
3. From `mobile/`:
   `node --test --test-concurrency=2 tests/*.test.cjs`;
   `./node_modules/.bin/tsc --noEmit`.
   If Expo route types are stale, regenerate ignored route artifacts using the
   established `CI=1 EXPO_NO_DOTENV=1 expo customize tsconfig.json` workflow before
   rerunning. Never commit generated native projects or caches.
4. PostgreSQL: set `POSTGRES_TEST_URL` only for a disposable local test database,
   then run `tests/test_postgres_portability.py`. Record skips honestly if that
   database is unavailable. Do not substitute production SQLite copies.
5. Manual Android acceptance: use supported Expo Go/device testing or an external
   EAS build. Test a narrow screen, large text, SwiftKey input, all pager examples,
   Enter-symbol button above the keyboard, reset/back navigation, lock while a
   Sheet is open, offline retry, and report totals with more than20 rows. Finish
   with `git diff --check` and scoped status/diff inspection.

## Git (branch: feature/transaction-browser)

- Planning artifact is committed to main in the planning worktree. This does not
  merge or publish `feature/apk-device-fixes`.
- Builder branches from `a24489b` or a verified descendant containing that branch,
  then carries this plan over from main. If using `git worktree add -b`, choose a
  new feature worktree and leave `/root/project/financeapp` on its current branch.
- Use identity `Hans2Awesome <ziegharthans@gmail.com>`. Commit only owned files;
  leave the unrelated `.easignore` change and other plans untouched.
- No force push, branch merge to main, deployment, or EAS build during planning.
  After every step is green, single-workstream integration may follow builder
  policy with appropriate user authorization; remove this plan only at completion.
- A future explicit push request also includes production backend synchronization
  per the user's standing preference. Use the existing deployment runbook, inspect
  current state, never blindly rerun an old deployment script, and deploy the
  additive backend before shipping the APK that depends on it.

## Integration Notes

- One plan covers the API and UI because they share response types, query
  semantics, total counts, pagination behavior and end-to-end acceptance. Splitting
  them into independently merged plans would risk shipping an unusable screen.
- Required ancestry: current main, prerequisite `feature/apk-device-fixes`, then
  `feature/transaction-browser`. The feature branch already carries prerequisite
  commits; integration must inspect ancestry rather than duplicate cherry-picks.
  No prerequisite merge is authorized merely by writing this plan.
- Sibling `plan/android-keyboard-layout.md` may overlap `Screen`, `Sheet`, and
  report layouts; this plan reuses those primitives and should not rewrite them.
  Sibling `plan/google-auth-android.md` may overlap root layout and shared services.
  Preserve its auth configuration. Record any actual ordering dependency in both
  plans if those workstreams become active; no such execution is assumed here.
- Parallel feature branches never self-merge. If multiple branches are executed,
  user runs `/integrate` from a builder session in the main checkout after all are
  green; integrate prerequisite fixes first, then this feature, resolve overlaps,
  run full suites and remove completed plan files.
