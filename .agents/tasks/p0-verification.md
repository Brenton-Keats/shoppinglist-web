# P0 Reorder Fix — Verification Note

Branch/worktree: `fix/reorder-p0` at `.worktrees/fix-reorder-p0`
Node: v24.19.0 (project engines require >=24; nvm `v24.19.0` used for all commands)

## Scope implemented
Both P0 items only. P1 data migration NOT implemented (explicitly out of scope).
No lambda/server code touched. The `"a0"` normalize fallback constant was not changed.

## P0 Item 1 — resilient reorder + stop swallowing failures — DONE
- New pure, unit-tested helpers in `src/lib/utils/ordering.ts`:
  - `keysAreDegenerate(before, after)` — true when both neighbours are real keys
    and not strictly increasing (the `generateKeyBetween` `a0 >= a0` throw case).
  - `groupIsHealthy(ordered)` — true only when every key is present and strictly
    increasing; a drifted group (duplicate/empty keys) is NOT healthy.
  - `planReorder(ordered, movingId, newIndex)` — happy path returns a single
    `{id, sort_order}` write; when the group is unhealthy or neighbours are
    degenerate (or key generation throws) it REBALANCES the whole group with a
    fresh evenly-spaced key set (`generateInitialKeys`) preserving the intended
    post-move order, and returns the full set of changed-row writes. Returns `[]`
    for a true no-op.
- Reorder handlers now route through this logic, each wrapped in try/catch that
  logs and raises a user-visible toast on failure:
  - `src/routes/+page.svelte` `moveProductUp`/`moveProductDown` (the reported
    screen) — new `applyProductReorder` applies the plan in a single Dexie
    transaction over products + listItems + changes, mirroring the key onto any
    matching ListItem. Siblings sorted by `compareSortKeys` with a stable
    (name, id) tiebreak so a degenerate group has a deterministic order.
  - `src/lib/drag-drop/ordering.ts` `moveWithinOrdered` — now plans + writes in a
    single Dexie transaction (`db.table(table)` + `db.changes`), records each
    changed row via `recordChange`.
  - `src/lib/components/SectionManager.svelte` and `StoreManager.svelte`
    `moveUp`/`moveDown`/drag-end — delegate to `reorderSections`/`reorderStores`
    (resilient path) inside try/catch + toast.
- User-visible error surface: no toast mechanism existed, so added a minimal one:
  `src/lib/stores/toast.svelte.ts` + `src/lib/components/ToastHost.svelte`
  (mounted in `+layout.svelte`). All reorder catch blocks also `console.error`.
- Global unhandled-rejection handler added in `src/routes/+layout.svelte`,
  guarded by `browser` from `$app/environment`, logging `event.reason`.

## P0 Item 2 — guarantee unique keys on initialisation — DONE
- `src/lib/db/operations.ts`: new `createEntityAtEnd` reads the current MAX key of
  the group (by `compareSortKeys`, active rows only) and writes the new row with
  `sortKeyAfter(max)` **inside a single Dexie `rw` transaction** that also records
  the sync change — so two concurrent creates against an apparently-empty group
  cannot both read null and both emit `"a0"`. Typed wrappers: `createProductAtEnd`,
  `createListItemAtEnd`, `createSectionAtEnd`, `createStoreAtEnd`.
- Callers switched off array-position key derivation to the atomic group-max path:
  `list.svelte.ts` (`addItem`, `addNewProductAndItem`), `+page.svelte`
  (`addNewProduct` — removed the now-redundant position-based `updateProduct`
  override, `createNewSection`, `createNewStore`), `SectionManager.handleAdd`,
  `StoreManager.handleAdd`.
- `sort_order` kept as an opaque string throughout; never coerced to number.

## Commands run & results
- `npm install` (node v24.19.0): OK.
- `npm run build`: PASS — `vite build` compiled with no errors.
- `npm run check` (svelte-check): 20 errors / 7 warnings — IDENTICAL to the clean
  baseline (verified via `git stash`); ALL are pre-existing and out of scope
  (sync/engine.ts casts, unused imports, BottomNav route typing, the `orderA -
  orderB` P2 section-sort bug). ZERO errors in any file I changed (grep-confirmed).
- `npm test` (vitest run): PASS — 83/83 (was 75/75; +8 new).

## Degenerate-key verification (unit tests in src/tests/ordering.test.ts)
- all-`"a0"` group: `planReorder` does NOT throw, rebalances to distinct strictly
  increasing keys, and produces the intended post-move order.
- all-`""` (empty) group: `planReorder` does NOT no-op, rebalances to distinct
  non-empty keys in the intended order.
- `keysAreDegenerate` and happy-path/no-op cases covered.

## Not verified (cannot be, here)
- Live IndexedDB behaviour in a real browser (actual Dexie transaction commit,
  toast rendering, unhandledrejection firing) — tests exercise the pure planner;
  the DB-coupled wrappers are reviewed-by-inspection and type-checked only.
- True concurrency of two simultaneous creates (single-threaded test env); the
  fix relies on Dexie `rw` transaction isolation, asserted by construction.
